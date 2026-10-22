import "server-only";

/**
 * Conversation compaction, ported from dsh-compaction-basic semantics.
 *
 * - Trigger: estimated pressure (last request input tokens / model window)
 *   crosses `thresholdRatio` (default 0.8, like dsh).
 * - Retention: newest messages kept verbatim, cut at a user-message boundary
 *   (tool pairs never split mid-flight); everything older is summarized by
 *   the conversation's own provider/model into one assistant message.
 * - Manual `/compact`-style path: force flag condenses regardless of pressure.
 * - Overflow recovery: callers that catch a context-window error can force.
 */
import { streamText, type UIMessage } from "ai";

import { findModel } from "@/lib/models";
import { buildLanguageModel } from "@/lib/providers";
import { getCustomProvider, isDeepSeekProvider } from "@/lib/custom-providers";
import { DEEPSEEK_DEFAULT_MAX_TOKENS } from "@/lib/deepseek";
import { getConversation, saveConversation } from "@/lib/store";

export const COMPACT_THRESHOLD = 0.8;
export const MIN_KEEP_MESSAGES = 6;

export function contextWindow(provider: string, model: string): number {
  return findModel(provider as never, model)?.context ?? 128_000;
}

export function pressureRatio(inputTokens: number, provider: string, model: string): number {
  const window = contextWindow(provider, model);
  if (!window) return 0;
  return inputTokens / window;
}

type CompactableMessage = UIMessage & { parts: Array<{ type: string; text?: string }> };

function headText(messages: CompactableMessage[]): string {
  return messages
    .map((m) => {
      const text = (m.parts ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n")
        .slice(0, 2000);
      const tools = (m.parts ?? [])
        .filter((p) => typeof p.type === "string" && (p.type.startsWith("tool-") || p.type === "dynamic-tool"))
        .map((p) => p.type)
        .join(", ");
      return `[${m.role}]${tools ? ` (tools: ${tools})` : ""}\n${text}`;
    })
    .join("\n\n")
    .slice(0, 24000);
}

export interface CompactResult {
  compacted: boolean;
  messages?: UIMessage[];
  removed?: number;
  kept?: number;
  summaryChars?: number;
  reason?: string;
}

export async function compactConversation(
  conversationId: string,
  opts: { force?: boolean; threshold?: number } = {},
): Promise<CompactResult> {
  const conv = await getConversation(conversationId);
  if (!conv) return { compacted: false, reason: "unknown conversation" };
  const messages = (conv.messages ?? []) as CompactableMessage[];
  if (messages.length <= MIN_KEEP_MESSAGES + 2) {
    return { compacted: false, reason: "too short to compact" };
  }

  if (!opts.force) {
    const lastInput = conv.lastRun?.inputTokens ?? 0;
    const ratio = pressureRatio(lastInput, conv.provider, conv.model);
    if (ratio < (opts.threshold ?? COMPACT_THRESHOLD)) {
      return { compacted: false, reason: `pressure ${(ratio * 100).toFixed(0)}% below threshold` };
    }
  }

  // Cut at a user boundary, keeping at least MIN_KEEP_MESSAGES verbatim.
  let cut = Math.max(1, messages.length - MIN_KEEP_MESSAGES);
  while (cut > 1 && messages[cut]?.role !== "user") cut -= 1;
  const head = messages.slice(0, cut);
  const tail = messages.slice(cut);
  if (head.length === 0) return { compacted: false, reason: "no condensable prefix" };

  const model = await buildLanguageModel({ provider: conv.provider as never, model: conv.model });
  // DeepSeek compaction goes through the same streaming Messages transport the
  // harness uses; everything else keeps the existing summarization call.
  const custom = await getCustomProvider(conv.provider);
  const deepseek = !!custom && isDeepSeekProvider(custom);
  const condensed = streamText({
    model,
    system:
      "Summarize this conversation prefix for continuation. Keep: user goals and decisions, " +
      "facts established, code/file state, todos and next steps, error fixes. Drop: greetings, " +
      "aborted attempts, verbatim tool output. Be dense — this replaces the originals.",
    prompt: headText(head),
    ...(deepseek ? { maxOutputTokens: DEEPSEEK_DEFAULT_MAX_TOKENS } : {}),
  });
  const summary = await condensed.text;
  const clean = summary.trim().slice(0, 6000) || "(empty prefix)";
  const summaryMessage = {
    id: `compact-${Date.now()}`,
    role: "assistant",
    parts: [{ type: "text", text: `📌 Compacted context — earlier conversation summarized:\n${clean}` }],
  } as unknown as UIMessage;

  const next = [summaryMessage, ...tail];
  await saveConversation({
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: Date.now(),
    provider: conv.provider,
    model: conv.model,
    messages: next as unknown[],
    usage: conv.usage,
    lastRun: conv.lastRun,
  });
  return {
    compacted: true,
    messages: next,
    removed: head.length,
    kept: tail.length,
    summaryChars: clean.length,
  };
}
