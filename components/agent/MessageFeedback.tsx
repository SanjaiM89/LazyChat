"use client";

import React from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { useAppStore } from "@/lib/app-store";

/**
 * The rating of a message, kept per conversation.
 *
 * The list is fetched once per conversation and cached, so switching back to a
 * conversation does not ask the server again.
 */
const cache = new Map<string, Map<string, "up" | "down">>();

export function useMessageFeedback(messageId: string) {
  const conversationId = useAppStore((s) => s.activeConversationId);
  const [rating, setRating] = React.useState<"up" | "down" | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!conversationId) {
      setRating(null);
      return;
    }
    const cached = cache.get(conversationId);
    if (cached) {
      setRating(cached.get(messageId) ?? null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/agent/feedback?conversationId=${encodeURIComponent(conversationId)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        const map = new Map<string, "up" | "down">();
        for (const entry of data.feedback ?? []) {
          map.set(entry.message_id, entry.rating);
        }
        cache.set(conversationId, map);
        if (!cancelled) setRating(map.get(messageId) ?? null);
      } catch {
        // The rating is a nicety; a failed fetch must not break the message.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, messageId]);

  const rate = React.useCallback(
    async (next: "up" | "down") => {
      if (!conversationId || busy) return;
      setBusy(true);
      const map = cache.get(conversationId) ?? new Map<string, "up" | "down">();
      map.set(messageId, next);
      cache.set(conversationId, map);
      setRating(next);
      try {
        await fetch("/api/agent/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            messageId,
            rating: next,
          }),
        });
      } catch {
        // Keep the optimistic state; the server will catch up next time.
      } finally {
        setBusy(false);
      }
    },
    [conversationId, messageId, busy],
  );

  return { rating, rate, busy };
}

/** The thumbs row under an assistant answer. */
export function MessageFeedback({ messageId }: { messageId: string }) {
  const { rating, rate, busy } = useMessageFeedback(messageId);
  const button =
    "flex h-6 w-6 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-surface-200 hover:text-fg disabled:opacity-40";

  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        aria-label={rating === "up" ? "Remove the positive rating" : "Rate this answer as helpful"}
        aria-pressed={rating === "up"}
        disabled={busy}
        onClick={() => void rate("up")}
        className={`${button} ${rating === "up" ? "text-accent-400" : ""}`}
      >
        <ThumbsUp size={13} />
      </button>
      <button
        type="button"
        aria-label={rating === "down" ? "Remove the negative rating" : "Rate this answer as unhelpful"}
        aria-pressed={rating === "down"}
        disabled={busy}
        onClick={() => void rate("down")}
        className={`${button} ${rating === "down" ? "text-danger-400" : ""}`}
      >
        <ThumbsDown size={13} />
      </button>
    </div>
  );
}
