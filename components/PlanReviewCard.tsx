"use client";

import * as React from "react";
import { CheckCircle2, CircleHelp, Loader2, RotateCcw } from "lucide-react";

import { Markdown } from "@/components/Markdown";
import { cn } from "@/components/ui";

/**
 * Plan review, ported from dsh's `exit_plan_mode` user-question seam.
 *
 * The tool pauses inside the stream and asks the human to approve or send the
 * plan back. The answer travels over the same `/api/chat/ask-user` endpoint as
 * `ask_user_question`, so a reload mid-review re-renders the same pending card
 * and a stopped turn releases the model.
 */
export function PlanReviewCard({
  toolCallId,
  plan,
  result,
  streaming,
  errorText,
}: {
  toolCallId: string;
  plan: string;
  result?: { approved?: boolean; message?: string } | undefined;
  streaming: boolean;
  errorText?: string;
}) {
  const [feedback, setFeedback] = React.useState("");
  const [sending, setSending] = React.useState<"approve" | "revise" | null>(null);
  const [sendError, setSendError] = React.useState<string | null>(null);

  const pending = streaming && !result && !errorText && Boolean(toolCallId);

  async function answer(choice: "Approve" | "Keep planning") {
    if (sending || !toolCallId) return;
    setSending(choice === "Approve" ? "approve" : "revise");
    setSendError(null);
    try {
      const custom = feedback.trim();
      const res = await fetch("/api/chat/ask-user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolCallId,
          answers: [
            {
              id: "plan-review",
              selected: [choice],
              ...(custom ? { custom } : {}),
            },
          ],
        }),
      });
      if (res.ok) return;
      if (res.status === 409) {
        setSendError(
          "This review is no longer open — the turn ended. Send a message to carry on.",
        );
      } else {
        setSendError("Could not send your review. Is the server still running?");
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Could not send your review.");
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="my-1 overflow-hidden rounded-lg border border-border bg-bg-surface-100 animate-fade-in-up">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <span className="grid shrink-0 place-items-center text-accent" aria-hidden>
          {result?.approved ? (
            <CheckCircle2 size={15} />
          ) : pending ? (
            <CircleHelp size={15} />
          ) : (
            <RotateCcw size={15} />
          )}
        </span>
        <span className="text-[13px] font-medium text-fg">
          {result?.approved
            ? "Plan approved"
            : errorText
              ? "Plan sent back"
              : pending
                ? "Review this plan"
                : "Plan review"}
        </span>
        <span className="ml-auto text-[12px] text-fg-muted">
          {result?.approved
            ? "Executing"
            : errorText
              ? "Revision requested"
              : pending
                ? "Waiting for your review"
                : "Closed"}
        </span>
      </div>

      {plan.trim() && (
        <div className="max-h-[340px] overflow-y-auto px-4 py-3 text-[13.5px]">
          <Markdown content={plan} />
        </div>
      )}

      {pending && (
        <div className="flex flex-col gap-2 border-t border-border px-3.5 py-3">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="Optional: what should the plan change?"
            className={cn(
              "w-full resize-none rounded-md border border-border bg-bg-surface-200 px-3 py-2 text-[13px] leading-relaxed text-fg",
              "placeholder:text-fg-faint focus:border-brand/50 focus:outline-none",
            )}
            disabled={sending !== null}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void answer("Keep planning")}
              disabled={sending !== null}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-bg-control px-3 text-[12.5px] font-medium text-fg transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              {sending === "revise" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RotateCcw size={13} />
              )}
              Keep planning
            </button>
            <button
              type="button"
              onClick={() => void answer("Approve")}
              disabled={sending !== null}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[color:var(--brand-button-border)] bg-[color:var(--brand-button)] px-3 text-[12.5px] font-medium text-[color:var(--brand-button-text)] transition-all hover:brightness-110 disabled:opacity-50"
            >
              {sending === "approve" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <CheckCircle2 size={13} />
              )}
              Approve
            </button>
          </div>
          {sendError && <p className="text-[12px] text-danger">{sendError}</p>}
        </div>
      )}

      {errorText && (
        <div className="border-t border-border px-3.5 py-2.5 text-[12.5px] leading-relaxed text-danger">
          {errorText}
        </div>
      )}
      {!pending && !result?.approved && !errorText && (
        <div className="border-t border-border px-3.5 py-2.5 text-[12.5px] text-fg-muted">
          {result?.message || "The review closed without an answer. Plan mode stays on."}
        </div>
      )}
    </div>
  );
}
