import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * A small language-server client.
 *
 * The server is a separate process that speaks LSP over stdio. The app owns
 * the lifecycle: it starts the server, opens the file the model is asking
 * about, asks the question, and shuts the server down again.
 *
 * Which server answers is the user's choice: the configuration maps a file
 * extension to a command. When nothing is configured the tool says so instead
 * of guessing.
 */

export interface LspServerConfig {
  /** The command to run, e.g. "typescript-language-server". */
  command: string;
  /** Its arguments, e.g. ["--stdio"]. */
  args?: string[];
  /** Extra environment for the server. */
  env?: Record<string, string>;
}

export interface LspLocation {
  file: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
  text?: string;
}

export type LspOperation =
  | "goToDefinition"
  | "findReferences"
  | "goToImplementation"
  | "hover";

export const LSP_OPERATIONS: LspOperation[] = [
  "goToDefinition",
  "findReferences",
  "goToImplementation",
  "hover",
];

/** How many locations a result may hold. */
export const MAX_LOCATIONS = 100;
/** How many characters of a result may come back. */
export const MAX_RESULT_CHARS = 20_000;
/** How long a single question may take. */
export const TIMEOUT_MS = 15_000;

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** The server for one file, by its extension. */
export function serverFor(
  servers: Record<string, LspServerConfig>,
  filePath: string,
): LspServerConfig | undefined {
  const extension = path.extname(filePath).replace(/^\./, "").toLowerCase();
  return servers[extension] ?? servers[filePath.toLowerCase()];
}

export class LspClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private ready: Promise<void> | null = null;
  private opened = new Set<string>();

  constructor(
    private readonly config: LspServerConfig,
    private readonly root: string,
  ) {}

  /** Start the server and complete the initialize handshake. */
  async start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.initialize();
    return this.ready;
  }

  private initialize(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proc = spawn(this.config.command, this.config.args ?? [], {
        cwd: this.root,
        env: { ...process.env, ...(this.config.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
      this.proc = proc;
      proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
      proc.on("error", (err) => {
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(err);
        }
        this.pending.clear();
        reject(err);
      });
      proc.on("exit", () => {
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("The language server stopped."));
        }
        this.pending.clear();
      });

      void this.request("initialize", {
        processId: process.pid,
        rootUri: `file://${this.root}`,
        rootPath: this.root,
        capabilities: {
          textDocument: {
            definition: { dynamicRegistration: false },
            implementation: { dynamicRegistration: false },
            references: { dynamicRegistration: false },
            hover: { dynamicRegistration: false, contentFormat: ["plaintext", "markdown"] },
          },
        },
        workspaceFolders: [{ uri: `file://${this.root}`, name: path.basename(this.root) }],
      })
        .then(() => {
          this.notify("initialized", {});
          resolve();
        })
        .catch(reject);
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      try {
        const message = JSON.parse(body);
        if (message && typeof message.id === "number") {
          const pending = this.pending.get(message.id);
          if (pending) {
            this.pending.delete(message.id);
            clearTimeout(pending.timer);
            if (message.error) {
              pending.reject(new Error(message.error.message ?? "The server refused the request."));
            } else {
              pending.resolve(message.result);
            }
          }
        }
      } catch {
        // A frame we cannot read is not worth stopping the server for.
      }
    }
  }

  private write(message: unknown): void {
    const body = JSON.stringify(message);
    this.proc?.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The language server did not answer ${method} in time.`));
      }, TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** Open the file so the server can answer questions about it. */
  private async open(filePath: string): Promise<string> {
    const resolved = path.resolve(filePath);
    if (!this.opened.has(resolved)) {
      const text = fs.readFileSync(resolved, "utf8");
      this.notify("textDocument/didOpen", {
        textDocument: { uri: `file://${resolved}`, languageId: "plaintext", version: 1, text },
      });
      this.opened.add(resolved);
    }
    return resolved;
  }

  /** Ask the server one question about a position in a file. */
  async query(
    operation: LspOperation,
    filePath: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    await this.start();
    const resolved = await this.open(filePath);
    const position = { line: Math.max(0, line - 1), character: Math.max(0, character - 1) };
    const uri = `file://${resolved}`;

    if (operation === "hover") {
      const result = await this.request("textDocument/hover", {
        textDocument: { uri },
        position,
      });
      const text = result?.contents?.value ?? result?.contents?.[0]?.value ?? "";
      if (!text) return [];
      return [{ file: resolved, line: line, character: character, text: String(text) }];
    }

    const method =
      operation === "findReferences"
        ? "textDocument/references"
        : operation === "goToImplementation"
          ? "textDocument/implementation"
          : "textDocument/definition";
    const params: Record<string, unknown> = { textDocument: { uri }, position };
    if (operation === "findReferences") params.context = { includeDeclaration: true };

    const result = await this.request(method, params);
    const raw = Array.isArray(result) ? result : result ? [result] : [];
    return raw.slice(0, MAX_LOCATIONS).map((entry: any) => ({
      file: entry?.uri ? decodeURI(entry.uri.replace("file://", "")) : resolved,
      line: (entry?.range?.start?.line ?? 0) + 1,
      character: (entry?.range?.start?.character ?? 0) + 1,
      endLine: entry?.range?.end ? entry.range.end.line + 1 : undefined,
      endCharacter: entry?.range?.end ? entry.range.end.character + 1 : undefined,
    }));
  }

  /** Stop the server. */
  async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      this.proc.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    this.proc = null;
    this.ready = null;
  }
}
