import { tool } from "ai";
import { z } from "zod";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createWorktree, listWorktrees } from "@/lib/agent/worktree";
import type { SessionDirectory } from "@/lib/agent/session-dir";

/**
 * The worktree and dependency tools.
 *
 * `create_worktree` gives the session another checkout of the same
 * repository — a new branch, its own directory — and moves the session into
 * it. `load_workspace_dependencies` reports the runtimes and the libraries
 * this machine has, so a program knows where to look for them.
 */

function which(command: string): string | null {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function version(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : String(stdout ?? "").trim().split("\n")[0] ?? null);
    });
  });
}

export function buildWorktreeTools(ctx: { sessionDir: SessionDirectory }) {
  return {
    create_worktree: tool({
      description:
        "Create a new Git branch and worktree from a local commit, branch or tag, then move this session's " +
        "working directory into it. Defaults to HEAD and a generated name. Uncommitted files stay in the source " +
        "checkout. An existing name fails. Use working_directory to leave; the checkout and the branch remain.",
      inputSchema: z.object({
        name: z.string().optional().describe("The new branch name; it is also the checkout directory name."),
        from: z
          .string()
          .optional()
          .describe("A local commit, branch or tag to start from. Defaults to HEAD; nothing is fetched."),
      }),
      execute: async ({ name, from }) => {
        try {
          const result = await createWorktree({
            cwd: ctx.sessionDir.cwd,
            name,
            from,
          });
          // The session moves into the new checkout.
          const moved = ctx.sessionDir.set(result.path);
          if ("error" in moved) {
            return { ...result, session_cwd: ctx.sessionDir.cwd, warning: moved.error };
          }
          return { ...result, session_cwd: moved.cwd };
        } catch (e) {
          return { error: (e as Error).message || "The worktree could not be created." };
        }
      },
    }),

    list_worktrees: tool({
      description: "List the Git worktrees of the repository the session is in.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const worktrees = await listWorktrees(ctx.sessionDir.cwd);
          return { count: worktrees.length, worktrees };
        } catch (e) {
          return { error: (e as Error).message || "The worktrees could not be listed." };
        }
      },
    }),

    load_workspace_dependencies: tool({
      description:
        "Report the runtimes and the library directories this machine has: the Node executable, a Python " +
        "interpreter, pnpm, and where their libraries live. A runtime that is not installed is reported as " +
        "missing rather than guessed.",
      inputSchema: z.object({}),
      execute: async () => {
        const nodePath = process.execPath;
        const python = which("python3") ?? which("python");
        const pnpm = which("pnpm");
        const [nodeVersion, pythonVersion, pnpmVersion] = await Promise.all([
          version(nodePath, ["--version"]),
          python ? version(python, ["--version"]) : Promise.resolve(null),
          pnpm ? version(pnpm, ["--version"]) : Promise.resolve(null),
        ]);
        const nodeModules = path.resolve(process.cwd(), "node_modules");
        return {
          node: {
            path: nodePath,
            version: nodeVersion,
            libraries: fs.existsSync(nodeModules) ? nodeModules : null,
          },
          python: python
            ? {
                path: python,
                version: pythonVersion,
                libraries: null,
              }
            : { path: null, version: null, libraries: null, missing: true },
          pnpm: pnpm
            ? { path: pnpm, version: pnpmVersion }
            : { path: null, version: null, missing: true },
        };
      },
    }),
  };
}
