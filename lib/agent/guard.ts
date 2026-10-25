import { requestApproval } from "@/lib/agent/approval";
import { decidePermission, type PermissionSettings } from "@/lib/agent/permissions";
import { appendEvent } from "@/lib/agent/session";
import type { ToolSet } from "ai";

/**
 * Enforcement of the permission layer.
 *
 * Every tool the model calls passes through here first. A call that the mode
 * forbids never runs; a call that needs a human decision pauses the turn and
 * asks, exactly like the model's own questions do, so the answer arrives
 * through the same UI.
 */

export interface GuardContext {
  conversationId: string;
  runId: string;
  settings: PermissionSettings;
  /** Tools the user allowed for the rest of this run. */
  granted: Set<string>;
}

type ExecutableTool = {
  execute?: (input: any, options: any) => unknown;
  [key: string]: unknown;
};

/**
 * Wrap a tool set so each call is checked against the session's permissions.
 *
 * The wrapped tools keep their identity, so the model still sees the same
 * names and schemas.
 */
export function guardTools(tools: Record<string, unknown>, ctx: GuardContext): ToolSet {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(tools)) {
    out[name] = guardTool(name, value as ExecutableTool, ctx);
  }
  return out as ToolSet;
}

function guardTool(name: string, tool: ExecutableTool, ctx: GuardContext): ExecutableTool {
  const original = tool?.execute;
  if (typeof original !== "function") return tool;

  const guarded: ExecutableTool = {
    ...tool,
    execute: async (input: any, options: any) => {
      const decision = decidePermission(name, ctx.settings);

      if (decision.outcome === "deny") {
        appendEvent(
          "approval/decided",
          { tool: name, allowed: false, reason: decision.reason },
          { conversationId: ctx.conversationId, runId: ctx.runId },
        );
        // The model reads the refusal and can pick another way.
        return { error: decision.reason, denied: true };
      }

      if (decision.outcome === "ask" && !ctx.granted.has(name)) {
        const answer = await requestApproval({
          tool: name,
          reason: decision.reason,
          conversationId: ctx.conversationId,
          runId: ctx.runId,
          toolCallId: options?.toolCallId,
        });
        if (answer.scope === "session") ctx.granted.add(name);
        if (!answer.allowed) {
          return { error: "The user declined this action.", denied: true };
        }
      }

      return original(input, options);
    },
  };
  return guarded;
}
