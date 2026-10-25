"use client";

/**
 * Ask-user card, ported from DeepSeek Harness'
 * (`packages/client/ui-tool/.../AskQuestionCard.tsx` + `QuestionToolRow.tsx`).
 *
 * dsh's card has two states and so does this one: while the call is pending the
 * card is a composer — pick an option, or type your own — and once the answer
 * lands it collapses into dsh's read-only transcript (question above, answer
 * below). The answered card is what the conversation keeps afterwards, so the
 * question and its answer stay readable in the transcript long after the turn.
 *
 * dsh collects the answer in a side panel; Omnia answers inline, because the
 * transcript is where the question was asked and the card is already there.
 */
import * as React from "react";
import { Check, CircleHelp, Loader2 } from "lucide-react";
import { cn } from "@/components/ui";

export interface AskQuestionOption {
  label: string;
  description?: string;
}

export interface AskQuestionInput {
  id: string;
  question: string;
  header?: string;
  options?: AskQuestionOption[];
  multiSelect?: boolean;
}

export interface AskAnswerInput {
  id: string;
  selected: string[];
  custom?: string;
}

/** One question's local editing state. */
interface Draft {
  /** Selected option labels, in click order. */
  picked: string[];
  /** Free-text answer; set when the user picks "Something else". */
  custom: string;
  /** Whether the free-text field is in play for this question. */
  customOpen: boolean;
}

function emptyDraft(): Draft {
  return { picked: [], custom: "", customOpen: false };
}

export function AskUserCard({
  toolCallId,
  questions,
  result,
  streaming,
  errorText,
}: {
  toolCallId: string;
  questions: AskQuestionInput[];
  /** The settled tool result, once the call has produced one. */
  result?: { answers?: AskAnswerInput[]; answered?: boolean } | undefined;
  streaming: boolean;
  errorText?: string;
}) {
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDrafts((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return Object.fromEntries(questions.map((q) => [q.id, emptyDraft()]));
    });
  }, [questions]);

  const pending = streaming && !result && !errorText;
  const answers = result?.answers;

  function draft(id: string): Draft {
    return drafts[id] ?? emptyDraft();
  }

  function patch(id: string, next: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...draft(id), ...next } }));
  }

  function toggle(q: AskQuestionInput, label: string) {
    const d = draft(q.id);
    if (q.multiSelect) {
      patch(q.id, {
        picked: d.picked.includes(label)
          ? d.picked.filter((p) => p !== label)
          : [...d.picked, label],
      });
    } else {
      patch(q.id, { picked: d.picked.includes(label) ? [] : [label] });
    }
  }

  async function submit() {
    const payload: AskAnswerInput[] = questions.map((q) => {
      const d = draft(q.id);
      const custom = d.customOpen ? d.custom.trim() : "";
      return {
        id: q.id,
        selected: d.picked,
        ...(custom ? { custom } : {}),
      };
    });
    // A question with nothing picked and nothing typed is skipped, which dsh
    // renders as "skipped" rather than as an empty answer.
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/chat/ask-user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolCallId, answers: payload }),
      });
      if (res.ok) return;
      // 409 means the server no longer holds this question — the turn was
      // stopped, timed out, or the server restarted. Leaving the card silently
      // waiting would strand the user on a button that can never fire.
      if (res.status === 409) {
        setSendError(
          "This question is no longer waiting for an answer — the turn ended. Send a message to carry on.",
        );
      } else {
        setSendError("Could not send your answer. Is the server still running?");
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Could not send your answer.");
    } finally {
      setSending(false);
    }
  }

  // A call that carries no questions cannot be answered: the model sent
  // malformed arguments, so the tool never ran and no question exists. Show
  // the failure plainly instead of an empty composer with a dead Answer button.
  if (questions.length === 0) {
    return (
      <div className="my-1 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 animate-fade-in-up text-[13px] text-danger">
        {pending ? (
          <Loader2 size={13} className="shrink-0 animate-spin" />
        ) : (
          <CircleHelp size={13} className="shrink-0" />
        )}
        <span>{errorText ?? "Could not read the question."}</span>
      </div>
    );
  }

  // ---- answered: dsh's read-only transcript -------------------------------
  if (answers) {
    return (
      <div className="my-1 flex flex-col gap-3 rounded-lg border border-border bg-bg-surface-100 px-4 py-3.5 animate-fade-in-up">
        {questions.map((q, index) => {
          // Match by id, falling back to position. The card builds its own
          // answers from `q.id`, so an exact match is the normal path; the
          // fallback keeps the transcript readable when the ids do not line up
          // (a model that echoed its own id rather than the question's), where
          // silently printing "No answer" would misreport what the user chose.
          const a =
            answers.find((x) => x.id === q.id) ??
            (answers.length === questions.length ? answers[index] : undefined);
          const lines = [
            ...(a?.selected ?? []),
            ...(a?.custom ? [a.custom] : []),
          ];
          return (
            <div key={q.id} className="flex flex-col gap-0.5">
              <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-fg-muted">
                {q.question}
              </p>
              <div className="flex flex-col">
                {lines.length === 0 ? (
                  <span className="text-[13px] leading-6 text-fg-muted/70">
                    No answer
                  </span>
                ) : (
                  lines.map((line, i) => (
                    <span key={i} className="text-[13px] leading-6 text-fg">
                      {line}
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Not pending, not answered, not failed: the turn that asked is gone — most
  // often the page was reloaded mid-question, which cannot re-attach to a
  // stream that already ended. Show why, not controls that do nothing.
  if (!pending && !answers) {
    return (
      <div className="my-1 overflow-hidden rounded-lg border border-border bg-bg-surface-100 px-4 py-3.5 animate-fade-in-up">
        {questions.map((q) => (
          <div key={q.id} className="mb-1.5 flex flex-col gap-0.5 last:mb-0">
            {q.header && (
              <span className="eyebrow">
                {q.header}
              </span>
            )}
            <p className="text-[13.5px] leading-6 text-fg">{q.question}</p>
          </div>
        ))}
        <p className="mt-2.5 text-[12px] text-fg-muted">
          {errorText ?? "This question was never answered — the turn ended first."}
        </p>
      </div>
    );
  }

  // ---- unanswered: the composer ------------------------------------------
  return (
    <div className="beam-border my-1 overflow-hidden rounded-lg border border-brand/30 bg-bg-surface-100 shadow-soft animate-fade-in-up">
      <div className="flex items-center gap-2 border-b border-border bg-accent-soft px-4 py-2">
        {pending ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
        ) : (
          <CircleHelp size={13} className="shrink-0 text-accent" />
        )}
        <span className="text-[12px] font-medium text-fg">
          {pending ? "Waiting for your answer" : "Question"}
        </span>
      </div>

      <div className="flex flex-col gap-4 px-4 py-3.5">
        {questions.map((q) => {
          const d = draft(q.id);
          return (
            <div key={q.id} className="flex flex-col gap-2">
              {q.header && (
                <span className="eyebrow !text-accent">
                  {q.header}
                </span>
              )}
              <p className="whitespace-pre-wrap break-words text-[13.5px] leading-6 text-fg">
                {q.question}
              </p>

              {(q.options ?? []).length > 0 && (
                <div className="flex flex-col gap-1.5 stagger [--stagger:40ms]">
                  {(q.options ?? []).map((opt) => {
                    const on = d.picked.includes(opt.label);
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        disabled={!pending || sending}
                        onClick={() => toggle(q, opt.label)}
                        className={cn(
                          "flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-all duration-200 disabled:cursor-default",
                          on
                            ? "border-brand/60 bg-accent-soft shadow-[0_0_0_3px_var(--accent-soft)]"
                            : "border-border bg-bg-surface-200 hover:border-border-stronger hover:bg-bg-surface-300",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex shrink-0 items-center justify-center border",
                            q.multiSelect ? "h-3.5 w-3.5 rounded" : "h-4 w-4 rounded-full",
                            on ? "border-brand bg-brand text-brand-button-text animate-scale-in" : "border-border-stronger",
                          )}
                        >
                          {on &&
                            (q.multiSelect ? (
                              <Check size={10} strokeWidth={3} />
                            ) : (
                              <span className="h-1.5 w-1.5 rounded-full bg-brand-button-text" />
                            ))}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] leading-5 text-fg">
                            {opt.label}
                          </span>
                          {opt.description && (
                            <span className="mt-0.5 block text-[12px] leading-5 text-fg-muted">
                              {opt.description}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    disabled={!pending || sending}
                    onClick={() => patch(q.id, { customOpen: !d.customOpen })}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-[13px] transition-all duration-200 disabled:cursor-default",
                      d.customOpen
                        ? "border-brand/60 bg-accent-soft text-fg"
                        : "border-dashed border-border-strong text-fg-muted hover:border-border-stronger hover:bg-bg-hover",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                        d.customOpen ? "border-brand bg-brand" : "border-border-stronger",
                      )}
                    >
                      {d.customOpen && (
                        <span className="h-1.5 w-1.5 rounded-full bg-brand-button-text" />
                      )}
                    </span>
                    Something else
                  </button>

                  {d.customOpen && (
                    <textarea
                      autoFocus
                      value={d.custom}
                      disabled={!pending || sending}
                      onChange={(e) => patch(q.id, { custom: e.target.value })}
                      placeholder="Type your answer…"
                      rows={2}
                      className="resize-none rounded-md border border-border-strong bg-bg-control px-3 py-2 text-[13px] leading-5 text-fg outline-none transition-[border-color,box-shadow] focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)] disabled:opacity-60 animate-fade-in-up"
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}

        {errorText && <p className="text-[12.5px] text-danger">{errorText}</p>}
        {sendError && <p className="text-[12.5px] text-danger">{sendError}</p>}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!pending || sending}
            onClick={() => void submit()}
            className="btn-sheen h-8 rounded-md border border-[color:var(--brand-button-border)] bg-[color:var(--brand-button)] px-3.5 text-[13px] font-medium text-[color:var(--brand-button-text)] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          >
            Answer
          </button>
          {pending && (
            <span className="text-[11.5px] text-fg-muted">
              The turn continues once you answer.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}