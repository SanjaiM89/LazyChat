/**
 * The one-shot approval channel.
 *
 * A tool that needs a human decision asks here: the question reaches the
 * user, the answer comes back bound to that one call, and the exchange is
 * recorded in the session log.
 */
import { askUser } from "@/lib/ask-user";
import { appendEvent } from "@/lib/agent/session";

export interface ApprovalRequest {
  /** The tool that wants to run. */
  tool: string;
  /** Why it needs a decision. */
  reason: string;
  /** The conversation the question belongs to. */
  conversationId: string;
  /** The run the question belongs to. */
  runId?: string;
  /** The call the decision is bound to. */
  toolCallId?: string;
}

export interface ApprovalDecision {
  /** Whether the action may go ahead. */
  allowed: boolean;
  /** How far the answer reaches. */
  scope: "once" | "session";
  /** The tool the answer was about. */
  tool: string;
}

/**
 * Ask the user for a decision about one tool call.
 */
export async function requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
  const toolCallId = request.toolCallId ?? `approval-${request.tool}-${Date.now()}`;
  const context = { conversationId: request.conversationId, runId: request.runId ?? null };

  appendEvent(
    "approval/asked",
    { tool: request.tool, reason: request.reason, tool_call_id: toolCallId },
    context,
  );

  const answers = await askUser(
    toolCallId,
    request.conversationId,
    [
      {
        id: "approve",
        header: "Permission",
        question: request.reason,
        options: [
          { label: "Allow once", description: "Run this call and continue." },
          { label: "Allow for this session", description: "Run it without asking again." },
          { label: "Deny", description: "Do not run it; the model is told why." },
        ],
      },
    ],
    request.runId,
  );

  const picked = answers.flatMap((answer) => answer.selected);
  const allowed = picked.some((choice) => /allow/i.test(choice));
  const scope = picked.some((choice) => /session/i.test(choice)) ? "session" : "once";

  appendEvent(
    "approval/decided",
    { tool: request.tool, allowed, scope, tool_call_id: toolCallId },
    context,
  );

  return { allowed, scope, tool: request.tool };
}
