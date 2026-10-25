/**
 * Message feedback.
 *
 * A rating, an optional category from the fixed taxonomy and optional
 * verbatim notes, recorded against a finished assistant message. The session
 * log owns every creation and deletion, and the feedback never enters the
 * model's history.
 */
import { appendEvent, listEvents } from "@/lib/agent/session";

/** The fixed taxonomy a rating may be filed under. */
export const FEEDBACK_CATEGORIES = [
  "task-result",
  "instruction-following",
  "product-interaction",
  "service-stability",
  "resource-cost",
  "security-privacy-permission",
  "other",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackRating = "up" | "down";

export interface MessageFeedback {
  /** The assistant message the rating is about. */
  message_id: string;
  /** Whether the answer was good. */
  rating: FeedbackRating;
  /** The category the human filed the judgment under. */
  category?: FeedbackCategory;
  /** The human's own words. */
  note?: string;
  /** When the rating was recorded. */
  created_at: number;
}

/**
 * Record a rating for a message.
 *
 * A second rating for the same message replaces the first: the log holds the
 * current state, not a history of opinions.
 */
export function recordFeedback(
  conversationId: string,
  feedback: Omit<MessageFeedback, "created_at">,
): MessageFeedback {
  const record: MessageFeedback = { ...feedback, created_at: Date.now() };
  appendEvent("feedback/record", record as unknown as Record<string, unknown>, {
    conversationId,
    runId: null,
  });
  return record;
}

/** The current feedback of a conversation. */
export function listFeedback(conversationId: string): MessageFeedback[] {
  const events = listEvents(conversationId, { types: ["feedback/record"], limit: 1000 });
  const byMessage = new Map<string, MessageFeedback>();
  for (const event of events) {
    const data = event.data as unknown as MessageFeedback & { rating?: string };
    if (!data?.message_id) continue;
    const rating: string | undefined = data.rating;
    // A deletion is recorded as a rating of "deleted".
    if (rating === "deleted") {
      byMessage.delete(data.message_id);
      continue;
    }
    byMessage.set(data.message_id, data as MessageFeedback);
  }
  return [...byMessage.values()];
}

/** Remove the feedback of a message. */
export function deleteFeedback(conversationId: string, messageId: string): boolean {
  const existing = listFeedback(conversationId).some((f) => f.message_id === messageId);
  if (!existing) return false;
  appendEvent(
    "feedback/record",
    { message_id: messageId, rating: "deleted", created_at: Date.now() } as unknown as Record<
      string,
      unknown
    >,
    { conversationId, runId: null },
  );
  return true;
}
