import { nanoid } from "nanoid";

import { listEvents } from "@/lib/agent/session";
import { getConversation, listConversations } from "@/lib/store";
import { createChatRun, type CreateChatRunInput } from "@/lib/chat-runs";
import type { PermissionSettings } from "@/lib/agent/permissions";
import type { ChatSettings } from "@/lib/types";

/**
 * Run recovery.
 *
 * A run that dies — the server restarts, the machine sleeps, the process is
 * killed — leaves its history in the session log. The log is append-only, so
 * every committed step is still there: the turn that started, the steps that
 * finished, the tool calls that answered and the one that did not.
 *
 * A resume reads that record, rebuilds the conversation the model was working
 * on, and starts a fresh run that carries on from the last committed step.
 */

export interface InterruptedRun {
  runId: string;
  conversationId: string;
  startedAt: number;
  lastEventType: string;
  lastEventAt: number;
  /** The sequence number of the run's last event, for a stable order. */
  lastEventSeq: number;
  /** The tool call that never came back, when there was one. */
  pendingTool?: { name: string; toolCallId: string; input: unknown };
  /** The last user message of the interrupted turn. */
  lastUserMessage?: string;
}

/**
 * The runs that started and never ended.
 *
 * A run that ended properly has a `turn/end`; one that died does not.
 */
export async function listInterruptedRuns(conversationId?: string): Promise<InterruptedRun[]> {
  const conversations = conversationId
    ? [conversationId]
    : (await listConversations()).map((row) => row.id);
  const found = new Map<string, InterruptedRun>();

  for (const id of conversations) {
    const events = listEvents(id, { limit: 2000 });
    const byRun = new Map<string, typeof events>();
    for (const event of events) {
      if (!event.run_id) continue;
      const bucket = byRun.get(event.run_id) ?? [];
      bucket.push(event);
      byRun.set(event.run_id, bucket);
    }

    for (const [runId, runEvents] of byRun) {
      const started = runEvents.find((event) => event.type === "turn/start");
      if (!started) continue;
      const ended = runEvents.find((event) => event.type === "turn/end");
      if (ended) continue;

      const last = runEvents[runEvents.length - 1];
      const user = [...runEvents].reverse().find((event) => event.type === "user/message");
      const answered = new Set(
        runEvents
          .filter((event) => event.type === "tool/result")
          .map((event) => String((event.data as any)?.toolCallId ?? "")),
      );
      const pending = runEvents.find(
        (event) => event.type === "tool/call" && !answered.has(String((event.data as any)?.toolCallId ?? "")),
      );

      found.set(runId, {
        runId,
        conversationId: id,
        startedAt: started.created_at,
        lastEventType: last?.type ?? "turn/start",
        lastEventAt: last?.created_at ?? started.created_at,
        lastEventSeq: last?.seq ?? started.seq,
        pendingTool: pending
          ? {
              name: String((pending.data as any)?.tool ?? "tool"),
              toolCallId: String((pending.data as any)?.toolCallId ?? ""),
              input: (pending.data as any)?.input,
            }
          : undefined,
        lastUserMessage:
          typeof (user?.data as any)?.text === "string" ? (user!.data as any).text : undefined,
      });
    }
  }

  // Newest first. The sequence number breaks a tie between two runs that
  // started in the same millisecond, so the order never wobbles.
  return [...found.values()].sort(
    (a, b) => b.startedAt - a.startedAt || b.lastEventSeq - a.lastEventSeq,
  );
}

/** The conversations the app knows about. */

export interface ResumeResult {
  ok: boolean;
  runId?: string;
  error?: string;
  /** What the model is told about the interrupted attempt. */
  note?: string;
}

/**
 * Start a new run that continues an interrupted one.
 *
 * The conversation comes from the store, the last user message from the log,
 * and the model is told where the previous attempt stopped.
 */
export async function resumeRun(
  runId: string,
  opts: {
    settings: ChatSettings;
    permissions: PermissionSettings;
    workspaceId?: string;
    trigger?: CreateChatRunInput["trigger"];
  },
): Promise<ResumeResult> {
  const interrupted = (await listInterruptedRuns()).find((run) => run.runId === runId);
  if (!interrupted) {
    return { ok: false, error: `There is no interrupted run called "${runId}".` };
  }

  const conversation = await getConversation(interrupted.conversationId);
  const history = ((conversation?.messages ?? []) as any[]).slice();
  const lastText = interrupted.lastUserMessage ?? "";

  // The user message is only added again when the store did not keep it: a
  // turn that never finished was not written back.
  const last = history[history.length - 1];
  const alreadyThere = last?.role === "user" && String(last?.parts?.[0]?.text ?? "").includes(lastText);
  const messages = alreadyThere
    ? history
    : [
        ...history,
        {
          role: "user",
          id: nanoid(10),
          parts: [{ type: "text", text: lastText || "Continue the work you were doing." }],
        },
      ];

  const note = interrupted.pendingTool
    ? `The previous attempt was interrupted while "${interrupted.pendingTool.name}" was running. ` +
      `Check whether it actually did its work before repeating it, then carry on.`
    : "The previous attempt was interrupted. Check what was already done, then carry on.";

  const run = await createChatRun({
    messages: messages as any,
    settings: opts.settings,
    permissions: opts.permissions,
    workspaceId: opts.workspaceId,
    trigger: opts.trigger ?? "submit-message",
  });

  return { ok: true, runId: run.id, note };
}
