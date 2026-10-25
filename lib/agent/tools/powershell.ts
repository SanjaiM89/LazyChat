import { tool } from "ai";
import { z } from "zod";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { openTerminal, runInTerminal } from "@/lib/agent/terminals";
import { collectShellEnv } from "@/lib/agent/shell-env";
import type { SessionDirectory } from "@/lib/agent/session-dir";

/**
 * The PowerShell tools.
 *
 * `pwsh` runs one command and answers with its output; `pwsh_persistent`
 * keeps a shell alive between calls, the way `shell_bash` does. A host
 * without PowerShell says so plainly rather than failing obscurely.
 */

const POWERSHELL = "pwsh";

/** The PowerShell executable, when the host has one. */
export function powershellPath(): string | null {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, POWERSHELL);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

const MISSING = {
  error:
    "This machine has no PowerShell. Install it (https://aka.ms/powershell) and the pwsh tools will work; " +
    "the bash tools are the alternative.",
};

export function buildPowershellTools(ctx: { sessionDir: SessionDirectory; sessionId?: string }) {
  const managedEnv = (cwd: string): NodeJS.ProcessEnv =>
    collectShellEnv({ sessionId: ctx.sessionId, cwd }) as NodeJS.ProcessEnv;

  return {
    pwsh: tool({
      description:
        "Run one PowerShell command and return its output. The command runs in the session's working " +
        "directory. Use it for Windows-shaped work: registry paths, $env: variables, cmdlets.",
      inputSchema: z.object({
        command: z.string().describe("The PowerShell command to run"),
        timeout_ms: z
          .number()
          .int()
          .min(1000)
          .max(600_000)
          .optional()
          .describe("How long to wait (default 120000)."),
      }),
      execute: async ({ command, timeout_ms }) => {
        const shell = powershellPath();
        if (!shell) return MISSING;
        try {
          const result = await new Promise<{ code: number; out: string }>((resolve) => {
            execFile(
              shell,
              ["-NoProfile", "-NonInteractive", "-Command", command],
              {
                cwd: ctx.sessionDir.cwd,
                timeout: timeout_ms ?? 120_000,
                maxBuffer: 4 * 1024 * 1024,
                env: { ...process.env, ...managedEnv(ctx.sessionDir.cwd) },
              },
              (err, stdout, stderr) => {
                const code =
                  err && typeof (err as { code?: unknown }).code === "number"
                    ? ((err as { code: number }).code as number)
                    : err
                      ? 1
                      : 0;
                resolve({
                  code,
                  out: (stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : ""),
                });
              },
            );
          });
          return { exit_code: result.code, output: result.out };
        } catch (e) {
          return { error: (e as Error).message || "The command could not be run." };
        }
      },
    }),

    pwsh_persistent: tool({
      description:
        "Open a PowerShell shell that stays alive, and return its id. The working directory and the exported " +
        "variables survive between calls, so `cd` once and then work relative to it.",
      inputSchema: z.object({
        cwd: z.string().optional().describe("The directory to open the shell in."),
      }),
      execute: async ({ cwd }) => {
        const shell = powershellPath();
        if (!shell) return MISSING;
        const start = cwd ?? ctx.sessionDir.cwd;
        try {
          const terminal = openTerminal(start, shell, managedEnv(start));
          return { terminal: terminal.id, cwd: start };
        } catch (e) {
          return { error: (e as Error).message || "The shell could not be opened." };
        }
      },
    }),

    pwsh_run: tool({
      description:
        "Run a command in an open PowerShell shell and return its output. Use it after pwsh_persistent.",
      inputSchema: z.object({
        terminal: z.string().describe("The terminal id"),
        command: z.string().describe("The command to run"),
        timeout_ms: z
          .number()
          .int()
          .min(1000)
          .max(600_000)
          .optional()
          .describe("How long to wait (default 120000)."),
      }),
      execute: async ({ terminal, command, timeout_ms }) => {
        const shell = powershellPath();
        if (!shell) return MISSING;
        try {
          const result = await runInTerminal(terminal, command, timeout_ms ?? 120_000);
          return {
            terminal,
            output: result.output,
            timed_out: result.timedOut,
            running: result.running,
          };
        } catch (e) {
          return { error: (e as Error).message || "The command could not be run." };
        }
      },
    }),
  };
}
