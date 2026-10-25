import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { nanoid } from "nanoid";

/**
 * Persistent shells.
 *
 * A one-shot command loses everything it set up: the current directory, the
 * exported variables, the background process. A terminal keeps them, so the
 * model can build on the last command instead of repeating the setup.
 *
 * Each terminal is a real bash process with a pipe on each side. A command is
 * followed by a unique marker, and the send waits for that marker to come back
 * — which is how the model learns that the command finished rather than
 * guessing.
 */

export interface TerminalInfo {
  id: string;
  cwd: string;
  createdAt: number;
  lastUsedAt: number;
  running: boolean;
  exitCode?: number;
  /** The command that is running or ran last. */
  lastCommand?: string;
}

interface Terminal extends TerminalInfo {
  proc: ChildProcessWithoutNullStreams;
  buffer: string;
  /** Everything written to the terminal, for the scrollback. */
  history: string[];
  pending: { marker: string; resolve: () => void } | null;
}

const MAX_TERMINALS = 8;
const MAX_BUFFER = 64 * 1024;
const MAX_HISTORY = 50;
const DEFAULT_TIMEOUT_MS = 120_000;

const terminals = new Map<string, Terminal>();

type RefCountable = { unref?: () => void; ref?: () => void };

function unrefStreams(proc: ChildProcessWithoutNullStreams): void {
  const streams = [proc.stdin, proc.stdout, proc.stderr] as unknown as RefCountable[];
  for (const stream of streams) stream.unref?.();
}

function refStreams(proc: ChildProcessWithoutNullStreams): void {
  const streams = [proc.stdin, proc.stdout, proc.stderr] as unknown as RefCountable[];
  for (const stream of streams) stream.ref?.();
}

function attach(term: Terminal): void {
  // A command that ends the shell (an `exit`, a fatal signal) leaves the next
  // write pointing at a closed pipe: the EPIPE is expected, not a failure.
  term.proc.stdin.on("error", () => {});
  term.proc.stdout.on("error", () => {});
  term.proc.stderr.on("error", () => {});

  const onData = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    term.buffer += text;
    if (term.buffer.length > MAX_BUFFER) term.buffer = term.buffer.slice(-MAX_BUFFER);
    term.history.push(text);
    if (term.history.length > MAX_HISTORY) term.history.shift();
    // The marker means the command finished; release whoever is waiting. It
    // has to be the whole line: a marker that also appeared inside the
    // command itself would end the wait early.
    if (term.pending && term.buffer.split("\n").some((line) => line.trim() === term.pending?.marker)) {
      const pending = term.pending;
      term.pending = null;
      pending.resolve();
    }
  };
  term.proc.stdout.on("data", onData);
  term.proc.stderr.on("data", onData);
  term.proc.on("exit", (code) => {
    term.running = false;
    term.exitCode = code ?? undefined;
    if (term.pending) {
      const pending = term.pending;
      term.pending = null;
      // The pipes can still hold the tail of the output; let them drain
      // before the waiter looks at the buffer. This timer keeps the loop
      // alive: the waiter is waiting on it.
      setTimeout(() => pending.resolve(), 50);
    }
  });
  term.proc.on("error", () => {
    term.running = false;
    if (term.pending) {
      const pending = term.pending;
      term.pending = null;
      pending.resolve();
    }
  });
}

/** Open a new terminal in a directory. */
export function openTerminal(cwd: string, shell = "bash", extraEnv?: NodeJS.ProcessEnv): TerminalInfo {
  reapTerminals(30 * 60 * 1000);
  if (terminals.size >= MAX_TERMINALS) {
    // Drop the oldest idle terminal rather than refusing to work.
    const oldest = [...terminals.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (oldest) closeTerminal(oldest.id);
  }
  const proc = spawn(shell, ["--norc", "--noprofile"], {
    cwd,
    // The managed DSH_* facts are collected for this shell; the rest of the
    // environment is the process's own.
    env: { ...process.env, ...extraEnv, PS1: "", TERM: "dumb", OMNIA: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  // An idle terminal must not keep the server (or a test run) alive on its
  // own: the process is reaped by the registry, not by the event loop. While a
  // command is in flight the streams are referenced again, so the loop stays
  // alive until the answer arrives.
  proc.unref();
  unrefStreams(proc);
  const id = `term-${nanoid(8)}`;
  const term: Terminal = {
    id,
    cwd,
    proc,
    buffer: "",
    history: [],
    pending: null,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    running: true,
  };
  terminals.set(id, term);
  attach(term);
  return info(term);
}

function info(term: Terminal): TerminalInfo {
  return {
    id: term.id,
    cwd: term.cwd,
    createdAt: term.createdAt,
    lastUsedAt: term.lastUsedAt,
    running: term.running,
    exitCode: term.exitCode,
    lastCommand: term.lastCommand,
  };
}

export function getTerminal(id: string): Terminal | undefined {
  return terminals.get(id);
}

export function listTerminals(): TerminalInfo[] {
  return [...terminals.values()].map(info);
}

/**
 * Run a command in a terminal and wait for it to finish.
 *
 * @param timeoutMs how long to wait before giving up on the marker.
 * @returns the output produced by the command.
 */
export async function runInTerminal(
  id: string,
  command: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ output: string; timedOut: boolean; running: boolean }> {
  const term = terminals.get(id);
  if (!term) return { output: "", timedOut: false, running: false };
  if (!term.running) return { output: term.buffer, timedOut: false, running: false };

  const marker = `__OMNIA_${nanoid(10)}__`;
  term.buffer = "";
  term.lastCommand = command;
  term.lastUsedAt = Date.now();
  refStreams(term.proc);
  // A command that ends the shell (an `exit`, a fatal signal) closes the pipes
  // before the exit event is delivered, which can leave the loop with nothing
  // to wait for. The heartbeat keeps the loop alive until the command settles.
  const keepAlive = setInterval(() => {}, 250);

  const done = new Promise<void>((resolve) => {
    term.pending = { marker, resolve };
  });

  term.proc.stdin.write(`${command}\n`);
  term.proc.stdin.write(`echo ${marker}\n`);

  let timedOut = false;
  await Promise.race([
    done,
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        // Nobody is waiting for the marker any more.
        term.pending = null;
        resolve();
      }, timeoutMs);
      timer.unref?.();
    }),
  ]);

  // The marker itself is noise; the command's output is what matters.
  const output = term.buffer.split(marker)[0] ?? term.buffer;
  clearInterval(keepAlive);
  unrefStreams(term.proc);
  return { output: output.trimEnd(), timedOut, running: term.running };
}

/** Send raw text to a terminal, without waiting for a command to finish. */
export function sendToTerminal(id: string, data: string): boolean {
  const term = terminals.get(id);
  if (!term || !term.running) return false;
  term.proc.stdin.write(data);
  term.lastUsedAt = Date.now();
  return true;
}

/** Read what a terminal has produced so far. */
export function readTerminal(id: string, since = 0): { output: string; truncated: boolean } {
  const term = terminals.get(id);
  if (!term) return { output: "", truncated: false };
  const output = term.buffer.slice(since);
  return { output, truncated: term.buffer.length >= MAX_BUFFER };
}

/** Send a signal to a terminal's process. */
export function signalTerminal(id: string, signal: NodeJS.Signals = "SIGINT"): boolean {
  const term = terminals.get(id);
  if (!term || !term.running) return false;
  try {
    term.proc.kill(signal);
    return true;
  } catch {
    return false;
  }
}

/** Close a terminal and end its process. */
export function closeTerminal(id: string): boolean {
  const term = terminals.get(id);
  if (!term) return false;
  try {
    term.proc.kill("SIGTERM");
  } catch {
    // Already gone.
  }
  terminals.delete(id);
  return true;
}

/** Close terminals that have been idle for too long. */
export function reapTerminals(maxAgeMs = 30 * 60 * 1000): number {
  const now = Date.now();
  let removed = 0;
  for (const term of [...terminals.values()]) {
    if (!term.running || now - term.lastUsedAt > maxAgeMs) {
      try {
        term.proc.kill("SIGTERM");
      } catch {
        // Already gone.
      }
      terminals.delete(term.id);
      removed++;
    }
  }
  return removed;
}
