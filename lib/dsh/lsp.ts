import "server-only";

import { spawn, type ChildProcess } from "child_process";

export interface LspServerInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  pid: number;
  ready: boolean;
}

export interface LspServer extends LspServerInfo {
  process: ChildProcess;
}

export function listLspServers(): LspServerInfo[] {
  cleanupLspServers();
  return Array.from(servers.values()).map((s) => ({
    id: s.id,
    name: s.name,
    command: s.command,
    args: s.args,
    cwd: s.cwd,
    pid: s.pid,
    ready: s.ready,
  }));
}

const servers = new Map<string, LspServer>();
const pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

const LANGUAGE_SERVERS: Record<string, { command: string; args: string[] }> = {
  javascript: { command: "typescript-language-server", args: ["--stdio"] },
  python: { command: "pylsp", args: [] },
  rust: { command: "rust-analyzer", args: [] },
  go: { command: "gopls", args: ["stdio"] },
  json: { command: "vscode-json-languageserver", args: ["--stdio"] },
  yaml: { command: "yaml-language-server", args: ["--stdio"] },
  bash: { command: "bash-language-server", args: ["start"] },
  docker: { command: "docker-langserver", args: ["--stdio"] },
};

let msgSeq = 0;

function readHeader(line: string): number | null {
  const m = /^Content-Length:\s*(\d+)/i.exec(line);
  return m ? parseInt(m[1], 10) : null;
}

function attachStdioHandlers(server: LspServer): void {
  const proc = server.process;
  let buffer = "";
  let expectedLength: number | null = null;

  const flush = (): void => {
    while (true) {
      if (expectedLength === null) {
        const crlfIdx = buffer.indexOf("\r\n");
        if (crlfIdx === -1) return; // need more data for header
        const headerLine = buffer.slice(0, crlfIdx);
        const contentLength = readHeader(headerLine);
        if (contentLength !== null) {
          expectedLength = contentLength;
          buffer = buffer.slice(crlfIdx + 2);
          // Skip remaining headers (blank line terminator)
          const blankIdx = buffer.indexOf("\r\n");
          if (blankIdx !== -1) {
            buffer = buffer.slice(blankIdx + 2);
          }
        } else {
          buffer = buffer.slice(crlfIdx + 2);
        }
      }
      if (expectedLength !== null && buffer.length >= expectedLength) {
        const body = buffer.slice(0, expectedLength);
        buffer = buffer.slice(expectedLength);
        expectedLength = null;
        try {
          const msg = JSON.parse(body) as { id?: number; method?: string; result?: unknown; error?: { code: number; message: string } };
          if (typeof msg.id === "number") {
            const pending = pendingRequests.get(msg.id);
            if (pending) {
              clearTimeout(pending.timer);
              pendingRequests.delete(msg.id);
              if (msg.error) pending.reject(new Error(msg.error.message));
              else pending.resolve(msg.result);
            }
          }
        } catch {
          // Ignore parse errors on partial data
        }
      } else {
        return;
      }
    }
  };

  proc.stdout?.on("data", (data: Buffer) => {
    buffer += data.toString("utf8");
    flush();
  });
  proc.stderr?.on("data", () => {});
}

function cleanupLspServers(): void {
  const now = Date.now();
  for (const [id, s] of servers) {
    if (s.process.killed || s.process.exitCode !== null) {
      servers.delete(id);
    }
  }
}

export async function attachLspServer(language: string, cwd: string): Promise<{ id: string; name: string; ready: boolean }> {
  const spec = LANGUAGE_SERVERS[language];
  if (!spec) throw new Error(`No language server configured for: ${language}. Supported: ${Object.keys(LANGUAGE_SERVERS).join(", ")}`);

  const id = `${language}-${Date.now()}`;
  const proc = spawn(spec.command, spec.args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const server: LspServer = {
    id,
    name: spec.command,
    command: spec.command,
    args: spec.args,
    cwd,
    process: proc,
    pid: proc.pid ?? 0,
    ready: false,
  };

  attachStdioHandlers(server);
  servers.set(id, server);

  // Send initialize request
  const reqId = ++msgSeq;
  const initParams = {
    processId: process.pid,
    rootUri: `file://${cwd}`,
    capabilities: {
      textDocument: {
        completion: { completionItem: { snippetSupport: true } },
        definition: {},
        references: {},
        diagnostics: {},
      },
    },
  };

  const sendResult = await sendLspMessage(server, "initialize", initParams, reqId);
  server.ready = true;

  // Send initialized notification
  const initMsg = JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} });
  const initBuf = Buffer.from(`Content-Length: ${Buffer.byteLength(initMsg)}\r\n\r\n${initMsg}`, "utf8");
  server.process.stdin?.write(initBuf);

  return { id, name: spec.command, ready: true };
}

function sendLspMessage(server: LspServer, method: string, params: unknown, id: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const buf = Buffer.from(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`, "utf8");

    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`LSP request timed out: ${method}`));
    }, 30_000);

    pendingRequests.set(id, { resolve, reject, timer });
    server.process.stdin?.write(buf, (err) => {
      if (err) {
        clearTimeout(timer);
        pendingRequests.delete(id);
        reject(err);
      }
    });
  });
}

export async function sendLspRequest(id: string, method: string, params?: string): Promise<unknown> {
  const server = servers.get(id);
  if (!server) throw new Error(`LSP server not found: ${id}. Use lsp_attach first.`);
  if (!server.ready) throw new Error(`LSP server ${id} is not ready yet.`);

  const parsedParams = params ? JSON.parse(params) : {};
  const reqId = ++msgSeq;
  return sendLspMessage(server, method, parsedParams, reqId);
}

export async function detachLspServer(id: string): Promise<boolean> {
  const server = servers.get(id);
  if (!server) return false;
  server.process.kill();
  servers.delete(id);
  return true;
}
