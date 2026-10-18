import "server-only";

import { spawn, type ChildProcess } from "child_process";
import { nanoid } from "nanoid";

export interface TerminalSession {
  id: string;
  cwd: string;
  process: ChildProcess;
  buffer: string;
  lastActivity: number;
}

const sessions = new Map<string, TerminalSession>();
const MAX_SESSION_AGE_MS = 30 * 60 * 1000; // 30 min idle

function cleanup(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActivity > MAX_SESSION_AGE_MS) {
      s.process.kill();
      sessions.delete(id);
    }
  }
}

setInterval(cleanup, 60_000).unref();

export function listTerminalSessions(): Array<{ id: string; cwd: string; buffer: string; lastActivity: number }> {
  cleanup();
  return Array.from(sessions.values()).map((s) => ({
    id: s.id,
    cwd: s.cwd,
    buffer: s.buffer,
    lastActivity: s.lastActivity,
  }));
}

export function openTerminal(cwd: string): string {
  cleanup();
  const id = nanoid(8);
  const child = spawn("bash", [], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TERM: "dumb" },
  });

  const session: TerminalSession = {
    id,
    cwd,
    process: child,
    buffer: "",
    lastActivity: Date.now(),
  };

  child.stdout?.on("data", (data: Buffer) => {
    session.buffer += data.toString("utf8");
    session.lastActivity = Date.now();
  });
  child.stderr?.on("data", (data: Buffer) => {
    session.buffer += data.toString("utf8");
    session.lastActivity = Date.now();
  });

  child.on("exit", () => {
    sessions.delete(id);
  });

  sessions.set(id, session);
  // Send a prompt so the session is ready.
  child.stdin?.write("echo 'TERMINAL_READY'\n");
  return id;
}

export function sendToTerminal(id: string, input: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.process.stdin?.write(input);
  session.lastActivity = Date.now();
  return true;
}

export function readFromTerminal(id: string, clear = false): { output: string; exited: boolean } {
  const session = sessions.get(id);
  if (!session) return { output: "", exited: true };
  const output = session.buffer;
  if (clear) session.buffer = "";
  session.lastActivity = Date.now();
  return { output, exited: session.process.killed || session.process.exitCode !== null };
}

export function closeTerminal(id: string, signal?: NodeJS.Signals): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.process.kill(signal || "SIGTERM");
  sessions.delete(id);
  return true;
}

export function signalTerminal(id: string, signal: NodeJS.Signals): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.process.kill(signal);
  session.lastActivity = Date.now();
  return true;
}
