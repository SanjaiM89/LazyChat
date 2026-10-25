import "server-only";

/**
 * Conversation compaction.
 *
 * The engine lives in `lib/agent/compaction.ts`; this module keeps the old
 * import path working for the API route that triggers a compaction by hand.
 */
export {
  COMPACT_THRESHOLD_RATIO as COMPACT_THRESHOLD,
  MIN_KEEP_MESSAGES,
  RETAIN_RATIO,
  compactConversation,
  contextWindow,
  planCompaction,
  pressureRatio,
  shouldCompact,
  type CompactResult,
} from "@/lib/agent/compaction";
