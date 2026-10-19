/**
 * FalkorDB-backed memory for Omnia's own conversations.
 *
 * Every Omnia conversation maps to one brain Session (`omnia:<id>`) owned by
 * the `omnia` user, so the graph remembers what Omnia talked about — the
 * capability the app previously lacked. All calls are fire-and-forget safe:
 * a down or slow graph must never break a chat.
 */
import { currentUser } from "@/lib/auth/context";
import { askAgent } from "@/lib/brain/agent";
import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient } from "@/lib/brain/graph";
import { factId, normalizeFact } from "@/lib/brain/memory/consolidation";
import { ensureSession, recallMemories, recordTurn } from "@/lib/brain/memory/session";
import { msFromEnv, withBudget } from "@/lib/brain/timeout";

/** Memory is per signed-in user; "omnia" is only the legacy single-user fallback. */
function omniaUser(): string {
  return currentUser()?.uid ?? "omnia";
}

function sessionFor(conversationId: string): string {
  return `omnia:${conversationId}`;
}

async function brainClient(): Promise<FalkorClient | null> {
  try {
    await ensureReady();
    return await FalkorClient.get();
  } catch (err) {
    console.warn(`[omnia-memory] graph unavailable: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Memories relevant to `question`, formatted for a system prompt. Empty when
 * the graph is unreachable or knows nothing — never throws.
 *
 * Bounded: recall runs before the model is called, so a wedged graph may add
 * at most `BRAIN_RECALL_BUDGET_MS` to first-token latency — after that the
 * turn simply starts without remembered context.
 */
export async function recallForOmnia(question: string, limit = 4): Promise<string> {
  if (!question.trim()) return "";
  return withBudget(
    remember(question, limit),
    msFromEnv("BRAIN_RECALL_BUDGET_MS", 4_000),
    "",
  );
}

async function remember(question: string, limit: number): Promise<string> {
  try {
    const client = await brainClient();
    if (!client) return "";
    const memories = await recallMemories(client, omniaUser(), question, limit);
    if (memories.length === 0) return "";
    const lines = memories.map((m) => `- [${m.kind}] ${m.summary.slice(0, 200)}`);
    return (
      "\n\n## Remembered context (from earlier Omnia conversations, stored in FalkorDB)\n" +
      "Use this when relevant; ignore it when it is not. Never claim these are " +
      "live tool results.\n" +
      lines.join("\n")
    );
  } catch (err) {
    console.warn(`[omnia-memory] recall failed: ${(err as Error).message}`);
    return "";
  }
}

/** Append one turn of an Omnia conversation to its brain Session. Never throws. */
export async function recordOmniaTurn(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const text = (content ?? "").trim();
  if (!conversationId || !text) return;
  try {
    const client = await brainClient();
    if (!client) return;
    const sid = await ensureSession(client, omniaUser(), sessionFor(conversationId));
    await recordTurn(client, sid, role, text.slice(0, 4000));
  } catch (err) {
    console.warn(`[omnia-memory] record failed: ${(err as Error).message}`);
  }
}

/** Plain-text rendering of a chat message's text parts. */
export function messageText(message: { parts?: Array<{ type: string; text?: string }> }): string {
  return ((message.parts ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n")).trim();
}

// ---------------------------------------------------------------------------
// Automatic capture: durable facts without being asked
//
// Recording turns is not remembering — recall only reads Episodic/Semantic
// memory, so a fact that lives solely in Turn nodes is invisible next session.
// This closes that gap: every Omnia turn is scanned for self-identifying
// statements ("my name is Jev") and they are stored immediately as
// SemanticMemory, no explicit "remember this" needed.
// ---------------------------------------------------------------------------

export type PersonalFact = {
  /** Canonical sentence stored in the graph. */
  fact: string;
  /**
   * Slot for single-value facts (`user.name`). When a new fact arrives for an
   * occupied slot, the old one is replaced — "my name is X" then "call me Y"
   * leaves exactly one name, and re-stating the same fact refreshes it instead
   * of duplicating it.
   */
  slot: string | null;
};

function titleCase(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function cleanPhrase(text: string, maxLen = 80): string {
  return text.trim().replace(/\s+/g, " ").replace(/[.?!;,]+$/g, "").trim().slice(0, maxLen);
}

// Words that look like a name to a regex but never are one.
const NOT_A_NAME = new Set([
  "maybe", "please", "later", "now", "here", "there", "soon", "today", "tomorrow",
  "sorry", "happy", "sad", "tired", "fine", "good", "bad", "okay", "ok", "sure",
  "right", "ready", "busy", "free", "back", "home", "away", "done", "glad",
  "hungry", "thirsty", "bored", "sick", "well", "lucky", "joking", "kidding",
  "honest", "serious", "cold", "hot", "sorry",
]);

/**
 * A name the user volunteered ("my name is Jev", "call me Al"), title-cased —
 * or null. Shared by the auto-capture fast path and the offline planner so
 * both agree on what counts as a name.
 */
export function extractNameMention(text: string): string | null {
  const raw =
    /(?:my name is|call me|i am|i'm|this is)\s+([A-Za-z][A-Za-z'’-]+(?:\s+[A-Za-z][A-Za-z'’-]+){0,2})/.exec(
      text ?? "",
    )?.[1];
  if (!raw) return null;
  if (NOT_A_NAME.has(raw.split(/\s+/)[0]?.toLowerCase() ?? "")) return null;
  const clean = titleCase(cleanPhrase(raw, 40));
  return clean.length >= 2 ? clean : null;
}

/**
 * Pull durable personal facts out of one user turn. Pure and synchronous —
 * no model call, so capture works offline and costs nothing.
 */
export function extractPersonalFacts(text: string): PersonalFact[] {
  const out: PersonalFact[] = [];
  if (!text) return out;

  // "my name is Jev" / "call me Al" / "I'm Groot".
  const mentioned = extractNameMention(text);
  if (mentioned) {
    out.push({ fact: `The user's name is ${mentioned}.`, slot: "user.name" });
  }

  const work = /(?:i work (?:at|for|on))\s+(.+?)(?:[.!?]|$)/i.exec(text)?.[1];
  if (work) {
    const clean = cleanPhrase(work);
    if (clean.length >= 2) out.push({ fact: `The user works at ${clean}.`, slot: "user.work" });
  }

  const role = /(?:i'm a|i am a|i'm an|i am an)\s+(.+?)(?:[.!?]|$)/i.exec(text)?.[1];
  if (role) {
    const clean = cleanPhrase(role);
    if (clean.length >= 2 && !/^(?:happy|okay|sad|tired|fine|good|bad|sorry)\b/i.test(clean)) {
      out.push({ fact: `The user is a ${clean}.`, slot: "user.role" });
    }
  }

  const like = /(?:i (?:like|love|prefer)|my favou?rite (?:\w+ is))\s+(.+?)(?:[.!?]|$)/i.exec(text)?.[1];
  if (like) {
    const clean = cleanPhrase(like);
    // Likes accumulate (no slot) — content addressing dedups repeats.
    if (clean.length >= 2) out.push({ fact: `The user likes ${clean}.`, slot: null });
  }

  // Explicit "remember this" — stored verbatim as a durable fact even when no
  // model is involved to interpret it.
  const remember = /(?:remember|note)(?:\s+that)?\s+(.+?)(?:[.!?]|$)|don't forget\s+(.+?)(?:[.!?]|$)|keep in mind\s+(.+?)(?:[.!?]|$)/i.exec(
    text,
  );
  const remembered = remember?.[1] ?? remember?.[2] ?? remember?.[3];
  if (remembered && !/^me\b/i.test(remembered.trim())) {
    const clean = cleanPhrase(remembered, 200);
    if (clean.length >= 4) out.push({ fact: clean.endsWith(".") ? clean : `${clean}.`, slot: null });
  }

  return out;
}

/**
 * Store one semantic fact for the Omnia user, checking existence first.
 *
 * - Same normalised fact already stored → just refresh its timestamp.
 * - Same slot, different fact (a rename) → replace, so exactly one wins.
 * - Otherwise MERGE by content-addressed id — repeats can never duplicate.
 */
export async function writeSemanticFact(
  client: FalkorClient,
  userId: string,
  fact: string,
  source: string,
  slot: string | null = null,
): Promise<{ id: string; stored: boolean; replaced: boolean }> {
  const norm = normalizeFact(fact).slice(0, 80);
  if (!norm) return { id: "", stored: false, replaced: false };
  const ts = new Date().toISOString();

  if (slot) {
    const existing = await client.query<{ id: string; fact: string }>(
      "MATCH (m:SemanticMemory) WHERE m.user_id = $uid AND m.slot = $slot " +
        "RETURN m.id AS id, m.fact AS fact",
      { uid: userId, slot },
    );
    const same = existing.find((r) => normalizeFact(r.fact ?? "").slice(0, 80) === norm);
    if (same) {
      await client.write("MATCH (m:SemanticMemory {id: $id}) SET m.timestamp = $ts", {
        id: same.id,
        ts,
      });
      return { id: same.id, stored: false, replaced: false };
    }
    if (existing.length > 0) {
      await client.write(
        "MATCH (m:SemanticMemory) WHERE m.user_id = $uid AND m.slot = $slot DETACH DELETE m",
        { uid: userId, slot },
      );
    }
  }

  const fid = factId(userId, fact);
  await client.write(
    "MERGE (m:SemanticMemory {id: $fid}) " +
      "SET m.user_id = $uid, m.fact = $fact, m.source = $source, " +
      "    m.timestamp = $ts, m.about = [], m.slot = $slot",
    { fid, uid: userId, fact, source, ts, slot },
  );
  return { id: fid, stored: true, replaced: Boolean(slot) };
}

/**
 * Capture durable facts from a finished Omnia turn — automatically, whether or
 * not the user said "remember this".
 *
 *  1. Fast path: self-identifying statements are stored immediately (this is
 *     what makes "my name is Jev" answerable in the *next* conversation).
 *  2. Slow path: threshold consolidation compresses the session into episodic
 *     + semantic memory exactly like the /brain path (offline-safe).
 *
 * Never throws.
 */
export async function captureOmniaMemory(
  conversationId: string,
  userText: string,
  userId: string = omniaUser(),
): Promise<void> {
  const text = (userText ?? "").trim();
  if (!conversationId) return;
  try {
    const client = await brainClient();
    if (!client) return;
    const sid = await ensureSession(client, userId, sessionFor(conversationId));

    for (const { fact, slot } of extractPersonalFacts(text)) {
      await writeSemanticFact(client, userId, fact, sid, slot);
    }

    const { consolidateSession } = await import("@/lib/brain/memory/consolidation");
    await consolidateSession(client, sid, userId, {});
  } catch (err) {
    console.warn(`[omnia-memory] capture failed: ${(err as Error).message}`);
  }
}
