import type { ToolSet } from "ai";

import { pruneToolResult, resultText } from "@/lib/agent/compaction";
import { spillText } from "@/lib/agent/spill";

/**
 * The result guard.
 *
 * Everything a tool returns goes through here before the model sees it: a
 * result too large to keep is spilled to a file, and one that is merely too
 * long is cut to its head and tail. The model always gets a usable result,
 * and the full text stays reachable.
 */

export interface ResultGuardContext {
  conversationId: string;
  runId: string;
  /** Spill the result to a file when it is over this size. */
  spillThreshold?: number;
  /** Cut the result when it is over this size. */
  pruneThreshold?: number;
}

type ExecutableTool = {
  execute?: (input: any, options: any) => unknown;
  [key: string]: unknown;
};

export function guardResults(
  tools: Record<string, unknown>,
  ctx: ResultGuardContext,
): ToolSet {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(tools)) {
    out[name] = guardResult(name, value as ExecutableTool, ctx);
  }
  return out as ToolSet;
}

function guardResult(name: string, tool: ExecutableTool, ctx: ResultGuardContext): ExecutableTool {
  const original = tool?.execute;
  if (typeof original !== "function") return tool;

  return {
    ...tool,
    execute: async (input: any, options: any) => {
      const value = await original(input, options);
      // A refused call already carries its explanation; leave it alone.
      if (value && typeof value === "object" && (value as any).denied) return value;

      const text = resultText(value);
      const spilled = spillText(ctx.conversationId, text, {
        thresholdChars: ctx.spillThreshold,
        runId: ctx.runId,
        name,
      });
      if (spilled) return spilled;

      return pruneToolResult(value, {
        thresholdChars: ctx.pruneThreshold,
      });
    },
  };
}
