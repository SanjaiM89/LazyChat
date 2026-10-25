import { generateText, type ModelMessage, type UIMessage } from "ai";

import { findModel } from "@/lib/models";
import { buildLanguageModel } from "@/lib/providers";
import { getConversation, saveConversation } from "@/lib/store";
import { appendEvent } from "@/lib/agent/session";

/**
 * Context depth.
 *
 * Three layers keep a turn inside the model's window:
 *
 *  1. **Pruning** — a tool result that is too large is cut to its head and
 *     tail before the model ever sees it. This is the cheapest layer: it
 *     costs nothing and loses the least.
 *  2. **Spilling** — a tool result that is far too large is written to a file
 *     and the model gets a preview plus the locator, so the full text is still
 *     reachable.
 *  3. **Compaction** — when the conversation itself has grown past the
 *     window, the older part is summarized and the newest part is kept
 *     verbatim.
 *
 * The thresholds follow the harness: a tool result over 8192 characters is cut
 * to 4096 characters of head plus 1024 of tail, and compaction runs at 80% of
 * the context window.
 */

/** A tool result longer than this is cut before the model sees it. */
export const PRUNE_THRESHOLD_CHARS = 8192;
export const PRUNE_HEAD_CHARS = 4096;
export const PRUNE_TAIL_CHARS = 1024;

/** A tool result longer than this is spilled to a file. */
export const SPILL_THRESHOLD_CHARS = 20_000;

/** Compaction runs at this share of the context window. */
export const COMPACT_THRESHOLD_RATIO = 0.8;
/** The share of the conversation that survives compaction verbatim. */
export const RETAIN_RATIO = 0.3;
/** The smallest tail that is ever kept, whatever the ratio says. */
export const MIN_KEEP_MESSAGES = 6;
/** How many times a turn may be retried after a compaction. */
export const MAX_OVERFLOW_RETRIES = 2;

export function contextWindow(provider: string, model: string): number {
  return findModel(provider as never, model)?.context ?? 128_000;
}

/** The share of the window the current input already fills. */
export function pressureRatio(inputTokens: number, provider: string, model: string): number {
  const window = contextWindow(provider, model);
  if (!window) return 0;
  return inputTokens / window;
}

/**
 * Whether the turn should compact before the model is called.
 *
 * The headroom is the room the answer itself needs: a request that exactly
 * fills the window would still fail once the model starts writing.
 */
export function shouldCompact(
  inputTokens: number,
  provider: string,
  model: string,
  opts: { thresholdRatio?: number; headroomTokens?: number } = {},
): boolean {
  const window = contextWindow(provider, model);
  if (!window) return false;
  const ratio = opts.thresholdRatio ?? COMPACT_THRESHOLD_RATIO;
  const headroom = opts.headroomTokens ?? Math.floor(window * 0.1);
  return (inputTokens + headroom) / window >= ratio;
}

/** Cut a long string to its head and tail, marking the cut. */
export function pruneText(
  text: string,
  opts: { thresholdChars?: number; headChars?: number; tailChars?: number } = {},
): string {
  const threshold = opts.thresholdChars ?? PRUNE_THRESHOLD_CHARS;
  if (text.length <= threshold) return text;
  const head = opts.headChars ?? PRUNE_HEAD_CHARS;
  const tail = opts.tailChars ?? PRUNE_TAIL_CHARS;
  const removed = text.length - head - tail;
  return `${text.slice(0, head)}\n\n… [${removed} characters pruned] …\n\n${text.slice(-tail)}`;
}

/** Prune every oversized string inside a tool result, keeping its shape. */
export function pruneToolResult(
  value: unknown,
  opts: { thresholdChars?: number; headChars?: number; tailChars?: number } = {},
): unknown {
  const walk = (input: unknown, depth = 0): unknown => {
    if (depth > 8) return input;
    if (typeof input === "string") return pruneText(input, opts);
    if (Array.isArray(input)) return input.map((item) => walk(item, depth + 1));
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
        out[key] = walk(item, depth + 1);
      }
      return out;
    }
    return input;
  };
  return walk(value);
}

/** The text of a tool result, for measuring and spilling it. */
export function resultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

/**
 * Whether a provider error means the request was too big.
 *
 * Providers phrase this differently, so the message and the body are both
 * searched for the words they use.
 */
export function isContextOverflow(error: unknown): boolean {
  const parts: string[] = [];
  const anyErr = error as any;
  if (anyErr?.message) parts.push(String(anyErr.message));
  if (anyErr?.responseBody) parts.push(String(anyErr.responseBody));
  if (anyErr?.cause?.message) parts.push(String(anyErr.cause.message));
  const text = parts.join(" ").toLowerCase();
  if (!text) return false;
  return (
    text.includes("context length") ||
    text.includes("context window") ||
    text.includes("maximum context") ||
    text.includes("too many tokens") ||
    text.includes("token limit") ||
    text.includes("prompt is too long") ||
    text.includes("input length") ||
    text.includes("reduce the length of the messages")
  );
}

/** Whether a provider error means it refused the images in the request. */
export function isImageBudgetError(error: unknown): boolean {
  const anyErr = error as any;
  const text = `${anyErr?.message ?? ""} ${anyErr?.responseBody ?? ""}`.toLowerCase();
  return text.includes("image") && (text.includes("budget") || text.includes("too large") || text.includes("exceed"));
}

type Message = UIMessage & { parts: Array<{ type: string; text?: string }> };

/**
 * Replace the oldest images with a placeholder, keeping the newest ones.
 *
 * The image stays in the conversation and in the event log; only the request
 * the model sees loses it, so a provider that refuses a request over its
 * image budget can be retried.
 */
export function offloadImages(
  messages: ModelMessage[],
  keep = 0,
): { messages: ModelMessage[]; offloaded: number } {
  const imageCount = (message: ModelMessage): number =>
    Array.isArray(message.content)
      ? message.content.filter((part: any) => part?.type === "image").length
      : 0;
  const total = messages.reduce((sum, message) => sum + imageCount(message), 0);
  if (total === 0) return { messages, offloaded: 0 };

  let toOffload = Math.max(0, total - keep);
  if (toOffload === 0) return { messages, offloaded: 0 };
  let offloaded = 0;

  const next: ModelMessage[] = messages.map((message) => {
    if (!Array.isArray(message.content) || toOffload === 0) return message;
    const content = message.content.map((part: any) => {
      if (part?.type !== "image" || toOffload === 0) return part;
      toOffload -= 1;
      offloaded += 1;
      return { type: "text", text: "[image removed to fit the context window]" };
    });
    return { ...message, content } as ModelMessage;
  });

  return { messages: next, offloaded };
}

/**
 * Where a compaction cuts the conversation.
 *
 * The cut is at a user-message boundary so a tool call and its result are
 * never split apart, and the newest part always survives.
 */
export function planCompaction(
  messages: Message[],
  opts: { retainRatio?: number; minKeep?: number } = {},
): { cut: number; removed: number; kept: number } | null {
  const retainRatio = opts.retainRatio ?? RETAIN_RATIO;
  const minKeep = opts.minKeep ?? MIN_KEEP_MESSAGES;
  if (messages.length <= minKeep + 2) return null;

  const target = Math.max(minKeep, Math.ceil(messages.length * retainRatio));
  let cut = messages.length - target;
  if (cut <= 0) return null;
  // Walk back to a user boundary so a tool pair is never split.
  while (cut > 1 && messages[cut]?.role !== "user") cut -= 1;
  if (cut <= 1) return null;
  return { cut, removed: cut, kept: messages.length - cut };
}

function headText(messages: Message[]): string {
  return messages
    .map((message) => {
      const text = (message.parts ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n")
        .slice(0, 2000);
      const tools = (message.parts ?? [])
        .filter((part) => part.type.startsWith("tool-") || part.type === "dynamic-tool")
        .map((part) => part.type)
        .join(", ");
      return `[${message.role}]${tools ? ` (tools: ${tools})` : ""}\n${text}`;
    })
    .join("\n\n")
    .slice(0, 24_000);
}

export interface CompactResult {
  compacted: boolean;
  messages?: UIMessage[];
  removed?: number;
  kept?: number;
  summaryChars?: number;
  reason?: string;
}

/**
 * Compact a conversation: the older part becomes one summary, the newest part
 * is kept verbatim.
 */
export async function compactConversation(
  conversationId: string,
  opts: { force?: boolean; threshold?: number; runId?: string } = {},
): Promise<CompactResult> {
  const conversation = await getConversation(conversationId);
  if (!conversation) return { compacted: false, reason: "unknown conversation" };
  const messages = (conversation.messages ?? []) as Message[];

  if (!opts.force) {
    const lastInput = conversation.lastRun?.inputTokens ?? 0;
    const ratio = pressureRatio(lastInput, conversation.provider, conversation.model);
    if (ratio < (opts.threshold ?? COMPACT_THRESHOLD_RATIO)) {
      return { compacted: false, reason: `pressure ${(ratio * 100).toFixed(0)}% below threshold` };
    }
  }

  const plan = planCompaction(messages);
  if (!plan) return { compacted: false, reason: "too short to compact" };

  const ctx = { conversationId, runId: opts.runId };
  appendEvent("compaction/start", { removed: plan.removed, kept: plan.kept }, ctx);

  const head = messages.slice(0, plan.cut);
  const tail = messages.slice(plan.cut);

  const model = await buildLanguageModel({
    provider: conversation.provider as never,
    model: conversation.model,
  });
  const { text: summary } = await generateText({
    model,
    system:
      "Summarize this conversation prefix for continuation. Keep: user goals and decisions, " +
      "facts established, code/file state, todos and next steps, error fixes. Drop: greetings, " +
      "aborted attempts, verbatim tool output. Be dense — this replaces the originals.",
    prompt: headText(head),
  });
  const clean = summary.trim().slice(0, 6000) || "(empty prefix)";
  const summaryMessage = {
    id: `compact-${Date.now()}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: `📌 Compacted context — earlier conversation summarized:\n${clean}`,
      },
    ],
  } as unknown as UIMessage;

  const next = [summaryMessage, ...tail];
  await saveConversation({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: Date.now(),
    provider: conversation.provider,
    model: conversation.model,
    messages: next as unknown[],
    usage: conversation.usage,
    lastRun: conversation.lastRun,
  });

  appendEvent("compaction/summary", { chars: clean.length, summary: clean.slice(0, 2000) }, ctx);
  appendEvent("compaction/end", { removed: plan.removed, kept: plan.kept }, ctx);

  return {
    compacted: true,
    messages: next,
    removed: plan.removed,
    kept: plan.kept,
    summaryChars: clean.length,
  };
}
