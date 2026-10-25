import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Run a program against the tool set.
 *
 * The model writes a small TypeScript program that calls tools as if they were
 * functions. The program runs in its own process; every tool call travels back
 * to this one over the IPC channel, so the tools keep their own permissions and
 * their own context (a workspace root, a conversation id).
 *
 * The program is a module whose default export receives the tools:
 *
 *   export default async function ({ tools }) {
 *     const files = await tools.ws_glob({ pattern: "**\/*.ts" });
 *     return files;
 *   }
 */

const CHILD = `
import { pathToFileURL } from "node:url";

let nextId = 1;
const pending = new Map();

function call(name, args) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    process.send({ type: "call", id, name, args });
  });
}

const tools = new Proxy(
  {},
  {
    get(_target, name) {
      if (typeof name !== "string") return undefined;
      return (args) => call(name, args ?? {});
    },
  },
);

process.on("message", (msg) => {
  const entry = pending.get(msg.id);
  if (!entry) return;
  pending.delete(msg.id);
  if (msg.type === "error") entry.reject(new Error(msg.message));
  else entry.resolve(msg.value);
});

const programPath = process.argv[2];
const mod = await import(pathToFileURL(programPath).href);
const fn = mod.default ?? mod.run;
if (typeof fn !== "function") {
  process.send({ type: "fatal", message: "The program must export a default function." });
} else {
  try {
    const value = await fn({ tools });
    process.send({ type: "done", value });
  } catch (err) {
    process.send({ type: "fatal", message: String(err?.stack ?? err) });
  }
}
`;

export interface CodeRunOptions {
  /** The tools the program may call. */
  tools: Record<string, { execute?: (input: any, options: any) => unknown }>;
  cwd?: string;
  timeoutMs?: number;
}

export interface CodeRunResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  /** The tool calls the program made, in order. */
  calls: Array<{ name: string; args: unknown; ok: boolean; error?: string }>;
  durationMs: number;
}

/**
 * Run a TypeScript program with the tool set in reach.
 *
 * Type stripping is done by Node itself, so a program only needs types that
 * erase — no enums, no namespaces, no decorators.
 */
export async function runCode(source: string, opts: CodeRunOptions): Promise<CodeRunResult> {
  const started = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omnia-code-"));
  const programPath = path.join(dir, "program.ts");
  const childPath = path.join(dir, "runner.mjs");
  const calls: CodeRunResult["calls"] = [];

  fs.writeFileSync(programPath, source, "utf8");
  fs.writeFileSync(childPath, CHILD, "utf8");

  return new Promise<CodeRunResult>((resolve) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", childPath, programPath],
      {
        cwd: opts.cwd ?? process.cwd(),
        env: { ...process.env, NODE_OPTIONS: "" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );

    let stderr = "";
    let settled = false;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

    const finish = (result: Omit<CodeRunResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      resolve({ ...result, durationMs: Date.now() - started });
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: "The program did not finish in time.", calls });
    }, opts.timeoutMs ?? 60_000);
    timer.unref?.();

    child.on("message", (msg: any) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "call") {
        const tool = opts.tools[msg.name];
        if (!tool?.execute) {
          const message = `There is no tool called "${msg.name}".`;
          calls.push({ name: msg.name, args: msg.args, ok: false, error: message });
          child.send({ type: "error", id: msg.id, message });
          return;
        }
        void Promise.resolve(tool.execute(msg.args, { toolCallId: `code-${msg.id}` }))
          .then((value) => {
            calls.push({ name: msg.name, args: msg.args, ok: true });
            child.send({ type: "result", id: msg.id, value: safeJson(value) });
          })
          .catch((err) => {
            const message = String(err?.message ?? err);
            calls.push({ name: msg.name, args: msg.args, ok: false, error: message });
            child.send({ type: "error", id: msg.id, message });
          });
        return;
      }
      if (msg.type === "done") {
        finish({ ok: true, result: safeJson(msg.value), calls });
      } else if (msg.type === "fatal") {
        finish({ ok: false, error: String(msg.message ?? "The program failed."), calls });
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });

    child.on("exit", (code) => {
      if (settled) return;
      finish({
        ok: false,
        error: `The program exited with code ${code}.${stderr ? `\n${stderr.trim()}` : ""}`,
        calls,
      });
    });

    child.on("error", (err) => {
      finish({ ok: false, error: err.message, calls });
    });
  });
}

/** Keep a value that the IPC channel can carry. */
function safeJson(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
