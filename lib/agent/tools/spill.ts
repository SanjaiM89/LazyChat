import { tool } from "ai";
import { z } from "zod";

import { readSpill } from "@/lib/agent/spill";

/**
 * Read back something that was spilled to a file.
 *
 * A large tool result is written to a file rather than carried in the
 * conversation; this is how the model gets the rest of it.
 */
export function buildSpillTools(ctx: { conversationId?: string }) {
  return {
    spill_read: tool({
      description:
        "Read a file that a large tool result was spilled to. The tool result carries the path when that " +
        "happens. Only files the app wrote are readable.",
      inputSchema: z.object({
        path: z.string().describe("The path the tool result gave you"),
        max_chars: z
          .number()
          .int()
          .min(500)
          .max(100_000)
          .optional()
          .describe("How much to read (default 20000)."),
      }),
      execute: async ({ path, max_chars }) => {
        const result = readSpill(path, {
          conversationId: ctx.conversationId,
          maxChars: max_chars ?? 20_000,
        });
        if (!result) {
          return { error: "That file cannot be read. Only spilled results are readable." };
        }
        return {
          path: result.path,
          chars: result.chars,
          truncated: result.truncated,
          text: result.text,
        };
      },
    }),
  };
}
