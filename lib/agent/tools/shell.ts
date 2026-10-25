import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs";

import {
  closeTerminal,
  listTerminals,
  openTerminal,
  readTerminal,
  runInTerminal,
  sendToTerminal,
  signalTerminal,
} from "@/lib/agent/terminals";
import type { SessionDirectory } from "@/lib/agent/session-dir";
import { collectShellEnv } from "@/lib/agent/shell-env";

/**
 * The shell tools.
 *
 * `shell_bash` is the convenient one: a command that runs and returns its
 * output. It keeps a shell alive between calls, so the working directory and
 * the exported variables survive. The `terminal_*` tools are the same shell
 * with the seams showing: open one, send to it, read it, signal it.
 *
 * Every shell starts in the session's working directory, and
 * `working_directory` moves the session — the whole tool set follows.
 */

export function buildShellTools(ctx: {
  sessionDir: SessionDirectory;
  cwd?: string;
  /** The session the shell runs for; it names the DSH_SESSION_ID fact. */
  sessionId?: string;
  /** Called when the model moves the session to another directory. */
  onCwdChange?: (dir: string) => void;
}) {
  const defaultCwd = () => ctx.sessionDir.cwd;
  // The managed DSH_* facts, collected for each shell that opens.
  const managedEnv = (cwd: string): NodeJS.ProcessEnv =>
    collectShellEnv({ sessionId: ctx.sessionId, cwd }) as NodeJS.ProcessEnv;

  return {
    working_directory: tool({
      description:
        "Read or change the directory this session works in. A relative path resolves against the current " +
        "directory. The change is durable: it applies to the shells opened afterwards and to every other " +
        "file tool in this session, and it survives the next turn.",
      inputSchema: z.object({
        path: z.string().optional().describe("The directory to move to. Omit to read the current one."),
      }),
      execute: async ({ path }) => {
        if (!path) return ctx.sessionDir.read();
        const result = ctx.sessionDir.set(path);
        if ("cwd" in result) ctx.onCwdChange?.(result.cwd);
        return result;
      },
    }),

    shell_bash: tool({
      description:
        "Run a shell command and return its output. The shell is persistent: the working directory, exported " +
        "variables and background jobs survive between calls, so `cd` once and then work relative to it. " +
        "The command runs in the attached workspace when there is one.",
      inputSchema: z.object({
        command: z.string().describe("The command to run, e.g. 'ls -la' or 'npm test'"),
        cwd: z.string().optional().describe("Directory to run in. Defaults to the attached workspace."),
        timeout_ms: z
          .number()
          .int()
          .min(1000)
          .max(600_000)
          .optional()
          .describe("How long to wait (default 120000)."),
        session: z.string().optional().describe("Reuse an existing shell by its id."),
      }),
      execute: async ({ command, cwd, timeout_ms, session }) => {
        try {
          const term = session
            ? listTerminals().find((t) => t.id === session)
            : undefined;
          const start = cwd ?? defaultCwd();
          const target =
            term?.id ??
            openTerminal(start, "bash", managedEnv(start)).id;
          const result = await runInTerminal(target, command, timeout_ms ?? 120_000);
          return {
            terminal: target,
            output: result.output,
            timed_out: result.timedOut,
            running: result.running,
          };
        } catch (e) {
          return { error: (e as Error).message || "The command could not be run." };
        }
      },
    }),

    terminal_open: tool({
      description: "Open a shell that stays alive, and return its id.",
      inputSchema: z.object({
        cwd: z.string().optional().describe("Directory to open the shell in."),
      }),
      execute: async ({ cwd }) => {
        try {
          const start = cwd ?? defaultCwd();
          return openTerminal(start, "bash", managedEnv(start));
        } catch (e) {
          return { error: (e as Error).message || "The terminal could not be opened." };
        }
      },
    }),

    terminal_send: tool({
      description:
        "Write to a terminal without waiting for the command to finish. Use it for interactive programs.",
      inputSchema: z.object({
        terminal: z.string().describe("The terminal id"),
        data: z.string().describe("The text to write, including the newline if you want it executed"),
      }),
      execute: async ({ terminal, data }) => {
        const ok = sendToTerminal(terminal, data);
        return ok ? { terminal, sent: true } : { error: `No live terminal called "${terminal}".` };
      },
    }),

    terminal_read: tool({
      description: "Read what a terminal has produced so far.",
      inputSchema: z.object({
        terminal: z.string().describe("The terminal id"),
        since: z.number().int().min(0).optional().describe("Read from this character offset."),
      }),
      execute: async ({ terminal, since }) => {
        const result = readTerminal(terminal, since ?? 0);
        if (!result.output && !listTerminals().some((t) => t.id === terminal)) {
          return { error: `There is no terminal called "${terminal}".` };
        }
        return { terminal, output: result.output, truncated: result.truncated };
      },
    }),

    terminal_signal: tool({
      description: "Send a signal to a terminal's process, e.g. SIGINT to interrupt it.",
      inputSchema: z.object({
        terminal: z.string().describe("The terminal id"),
        signal: z
          .enum(["SIGINT", "SIGTERM", "SIGHUP", "SIGKILL"])
          .optional()
          .describe("The signal to send (default SIGINT)."),
      }),
      execute: async ({ terminal, signal }) => {
        const ok = signalTerminal(terminal, (signal ?? "SIGINT") as NodeJS.Signals);
        return ok ? { terminal, signalled: true } : { error: `No live terminal called "${terminal}".` };
      },
    }),

    terminal_close: tool({
      description: "Close a terminal and end its process.",
      inputSchema: z.object({
        terminal: z.string().describe("The terminal id"),
      }),
      execute: async ({ terminal }) => {
        const ok = closeTerminal(terminal);
        return ok ? { terminal, closed: true } : { error: `There is no terminal called "${terminal}".` };
      },
    }),

    terminal_list: tool({
      description: "List the open terminals, with their ids, working directories and last command.",
      inputSchema: z.object({}),
      execute: async () => {
        const terminals = listTerminals();
        return { count: terminals.length, terminals };
      },
    }),
  };
}
