/**
 * Session titles.
 *
 * A title is folded from the durable log: the leading words of the first
 * eligible human message, or a title the user set, which pins the session.
 * Titles are client-visible and never enter the model input.
 */
import type { SessionEvent } from "@/lib/agent/session";

export interface TitleLimits {
  /** The maximum whitespace-delimited words in the fallback. */
  fallbackMaxWords?: number;
  /** The maximum UTF-8 bytes in the fallback. */
  fallbackMaxBytes?: number;
  /** The maximum UTF-8 bytes accepted from any source. */
  maxTitleBytes?: number;
}

const DEFAULTS: Required<TitleLimits> = {
  fallbackMaxWords: 8,
  fallbackMaxBytes: 96,
  maxTitleBytes: 120,
};

interface TitleData {
  text?: string;
  title?: string;
  source?: string;
}

/**
 * The accepted title for a session, or null when the session has none yet.
 */
export function foldSessionTitle(
  events: SessionEvent[],
  limits: TitleLimits = {},
): string | null {
  const bounds = { ...DEFAULTS, ...limits };

  // A title the user set pins the session: the latest one wins.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type !== "session/title") continue;
    const d = (event.data ?? {}) as TitleData;
    const title = (d.title ?? "").trim();
    if (title) return clip(title, bounds.maxTitleBytes);
  }

  // Otherwise the fallback: the first eligible human message.
  for (const event of events) {
    if (event.type !== "user/message") continue;
    const d = (event.data ?? {}) as TitleData;
    const text = (d.text ?? "").trim();
    if (!text) continue;
    return fallbackTitle(text, bounds.fallbackMaxWords, bounds.fallbackMaxBytes);
  }
  return null;
}

/**
 * The deterministic fallback: the leading words of a message.
 */
export function fallbackTitle(text: string, maxWords: number, maxBytes: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let title = words.slice(0, maxWords).join(" ");
  if (Buffer.byteLength(title, "utf8") > maxBytes) {
    // Drop whole words until the title fits.
    while (title && Buffer.byteLength(title, "utf8") > maxBytes) {
      title = title.split(" ").slice(0, -1).join(" ");
    }
  }
  return title;
}

/** Clip a title to a byte budget. */
function clip(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let out = text;
  while (out && Buffer.byteLength(out, "utf8") > maxBytes) {
    out = out.slice(0, -1);
  }
  return out;
}
