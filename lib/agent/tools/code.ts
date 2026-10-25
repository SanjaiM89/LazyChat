import { tool } from "ai";
import { z } from "zod";

import { runCode } from "@/lib/agent/code-runner";

/**
 * Run a program against the tool set.
 *
 * The program gets a `tools` object whose properties are the tools it may
 * call. It is the way to do work that is not a single call: read a directory,
 * filter it, write a summary — in one round trip instead of five.
 */
export function buildCodeTools(ctx: {
  /** The tools the program may call. Filled in by the run loop. */
  tools: () => Record<string, unknown>;
  /** The directory the program runs in. It follows the session. */
  cwd?: string | (() => string);
}) {
  return {
    code_run: tool({
      description:
        "Run a TypeScript program that can call the agent's tools. The program is a module whose default export " +
        "receives `{ tools }`; each tool is a function that returns its result. " +
        "export default async function ({ tools }) { const files = await tools.ws_glob({ pattern: '**/*.ts' }); return files; } " +
        "Use it when one call cannot express the work, e.g. filtering a list, or running the same call many times.",
      inputSchema: z.object({
        source: z.string().describe("The TypeScript source of the program"),
        timeout_ms: z
          .number()
          .int()
          .min(1000)
          .max(300_000)
          .optional()
          .describe("How long the program may run (default 60000)."),
      }),
      execute: async ({ source, timeout_ms }) => {
        try {
          const result = await runCode(source, {
            tools: ctx.tools() as never,
            cwd: typeof ctx.cwd === "function" ? ctx.cwd() : ctx.cwd,
            timeoutMs: timeout_ms ?? 60_000,
          });
          return {
            ok: result.ok,
            result: result.result ?? null,
            error: result.error ?? null,
            calls: result.calls.map((c) => ({ name: c.name, ok: c.ok, error: c.error ?? null })),
            duration_ms: result.durationMs,
          };
        } catch (e) {
          return { error: (e as Error).message || "The program could not be run." };
        }
      },
    }),
  };
}
