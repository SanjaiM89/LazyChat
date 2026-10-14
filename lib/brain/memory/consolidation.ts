/**
 * Memory consolidation.
 *
 * After enough of a conversation has accumulated, the session is compressed:
 *
 *   Turns ──consolidate──> EpisodicMemory  ("what this session was about")
 *                      └─> SemanticMemory  (durable facts worth keeping)
 *                      └─> ProceduralMemory (how this kind of question is answered)
 *
 * Consolidation is LLM-driven when a key is present and rule-driven otherwise,
 * so the memory demo works offline. Facts are linked back to the graph nodes
 * they came from via `ABOUT`, which is what lets the UI highlight them.
 */
import { createHash } from "node:crypto";

import type { FalkorClient } from "../graph";
import type { BrainLlm } from "../types";
import { getTurns, nowIso, turnCount } from "./session";

export const CONSOLIDATE_AFTER_TURNS = 4;

/** How many turns had already been folded into memory at last consolidation. */
export async function consolidatedTurns(client: FalkorClient, sessionId: string): Promise<number> {
  const rows = await client.query<{ c: number }>(
    "MATCH (s:Session {id: $sid}) RETURN coalesce(s.consolidated_turns, 0) AS c",
    { sid: sessionId },
  );
  return rows.length > 0 ? Number(rows[0].c) : 0;
}

/**
 * True when enough *new* turns have piled up since the last consolidation.
 *
 * Deliberately not "has this session been consolidated before" — that made a
 * session consolidate exactly once, so turns 3, 4, 5 … were never remembered.
 * Each time another `threshold` turns accumulate, memory is refreshed.
 */
export async function shouldConsolidate(
  client: FalkorClient,
  sessionId: string,
  threshold = CONSOLIDATE_AFTER_TURNS,
): Promise<boolean> {
  const total = await turnCount(client, sessionId);
  if (total < threshold) return false;
  return total - (await consolidatedTurns(client, sessionId)) >= threshold;
}

// ---------------------------------------------------------------------------
// Fact extraction (offline-safe)
// ---------------------------------------------------------------------------

// Entity-ish tokens that are worth remembering as facts about the company.
const SUBJECT =
  /\b(auth-service|payments-api|ledger-service|notification-service|search-api|recsys|event-pipeline|web-checkout|api-gateway|identity-sync|data-platform)\b/i;
const DECISION = /\bdecision\b|\bADR\b|\bwe (decided|chose|adopted)\b/i;

// Sentences carrying these markers were *recalled* from an earlier session, not
// learned from the graph this turn. Storing them would make each session's
// memory a copy of the previous one's — a feedback loop that compounds.
const RECALLED = /earlier sessions|\[episodic\]|\[semantic\]|\[procedural\]|remind me/i;

/** Canonical form used to decide whether two facts are the same fact. */
export function normalizeFact(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 160);
}

/**
 * Content-addressed id.
 *
 * Re-learning the same fact MERGEs onto the existing node (refreshing its
 * timestamp and links) instead of appending a near-duplicate row, which is what
 * previously made the store grow a copy of itself every session.
 */
export function factId(userId: string, text: string): string {
  const digest = createHash("sha1").update(normalizeFact(text)).digest("hex").slice(0, 12);
  return `semantic:${userId}:${digest}`;
}

/**
 * Pull candidate durable facts out of a passage of text.
 *
 * Deliberately conservative: a fact is kept only if it names a service or a
 * decision, so the store does not fill with conversational filler.
 */
export function extractFacts(answer: string): string[] {
  const facts: string[] = [];
  if (!answer) return facts;
  for (const sentence of answer.split(/(?<=[.!?])\s+/)) {
    const s = sentence.trim();
    if (!s || s.length < 25 || s.length > 400) continue;
    if (RECALLED.test(s)) continue;
    if (SUBJECT.test(s) || DECISION.test(s)) facts.push(s);
  }
  return dedupe(facts);
}

const FACT_SYSTEM =
  "You extract durable facts about an engineering organisation from agent " +
  "findings. You never speculate and never add information that is not in the " +
  "text you are given.";

/**
 * Remove at most one leading list marker ('- ', '1. ', '* ').
 *
 * Not a character-set strip: that would eat the leading '7' in "7 ticket(s)…"
 * and the fact would stop matching its source.
 */
function stripMarker(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])?\s*/, "").trim();
}

function significant(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of (text ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (w.length > 2) out.add(w);
  }
  return out;
}

/**
 * Is this fact actually supported by the source?
 *
 * Two paths, in order of confidence:
 *   1. the normalised fact appears verbatim in the source, or
 *   2. at least 70% of its content words appear in the source, with a floor of
 *      3 matched words so a short fact cannot pass on one lucky term.
 */
export function isGrounded(candidate: string, sourceNorm: string, sourceTokens: Set<string>): boolean {
  const norm = normalizeFact(candidate);
  if (norm && sourceNorm.includes(norm.slice(0, 60))) return true;
  const tokens = significant(candidate);
  if (tokens.size === 0) return false;
  let matched = 0;
  for (const t of tokens) if (sourceTokens.has(t)) matched += 1;
  return matched >= 3 && matched / tokens.size >= 0.7;
}

/**
 * LLM-driven fact extraction, with a grounding guard.
 *
 * The model may segment and phrase facts better than a regex, but every returned
 * fact must be verifiably supported by the source text. Anything else is
 * discarded — otherwise asking a model to summarise would quietly become a way
 * to invent facts.
 */
export async function extractFactsLlm(text: string, llm: BrainLlm | null): Promise<string[]> {
  if (!text || !llm) return [];
  const prompt =
    "Extract the durable facts from the text below. A durable fact is a " +
    "statement about the system, its services, tickets or decisions that will " +
    "still be true tomorrow.\n\n" +
    "Rules:\n" +
    "- Use only information present in the text. Do not add anything.\n" +
    "- Reuse the text's own wording for service names, ticket keys and numbers " +
    "— do not spell out or convert figures.\n" +
    "- Keep each fact to one sentence, under 200 characters.\n" +
    "- Return between 0 and 5 facts.\n\n" +
    "Reply with one fact per line and nothing else — no bullets, no numbering, " +
    "no preamble.\n\n" +
    `TEXT:\n${text.slice(0, 3000)}`;
  let response: { text: string };
  try {
    response = await llm.complete([{ role: "user", content: prompt }], FACT_SYSTEM, []);
  } catch {
    return [];
  }

  const sourceNorm = normalizeFact(text);
  const sourceTokens = significant(text);
  const out: string[] = [];
  for (const line of (response.text ?? "").split("\n")) {
    const cand = stripMarker(line);
    if (!(cand.length >= 25 && cand.length <= 400)) continue;
    if (RECALLED.test(cand)) continue;
    if (!isGrounded(cand, sourceNorm, sourceTokens)) continue;
    out.push(cand);
  }
  return dedupe(out);
}

export function dedupe(facts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of facts) {
    const key = normalizeFact(f).slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export type FactCandidate = { fact: string; about: string[] };

/**
 * Semantic facts sourced from the Researcher's findings.
 *
 * Preferred over the Synthesizer's prose because findings are tool output: they
 * are already grounded in graph rows and contain no recalled text, so memory
 * cannot absorb itself.
 */
export async function factsFromFindings(
  client: FalkorClient,
  sessionId: string,
  llm: BrainLlm | null = null,
): Promise<FactCandidate[]> {
  const crew = await import("../crew");
  const findings = await crew.readFindings(client, sessionId, crew.RESEARCHER);
  const out: FactCandidate[] = [];
  for (const f of findings) {
    const text = (f.content ?? "").trim();
    if (!text || text.length < 25 || RECALLED.test(text)) continue;
    const llmFacts = await extractFactsLlm(text, llm);
    const chosen = llmFacts.length > 0 ? llmFacts : extractFacts(text).length > 0 ? extractFacts(text) : [text];
    for (const fact of chosen) out.push({ fact, about: f.about ?? [] });
  }
  return out;
}

/** One-paragraph summary of a session, built from its turns. */
export async function summarizeSession(
  client: FalkorClient,
  sessionId: string,
  maxChars = 600,
): Promise<string> {
  const turns = await getTurns(client, sessionId);
  if (turns.length === 0) return "";
  const questions = turns.filter((t) => t.role === "user").map((t) => t.content);
  const answers = turns.filter((t) => t.role !== "user").map((t) => t.content);
  const parts: string[] = [];
  if (questions.length > 0) {
    parts.push(`The user asked about: ${questions.slice(0, 5).map((q) => q.slice(0, 120)).join("; ")}.`);
  }
  if (answers.length > 0) {
    parts.push(`Findings: ${answers.slice(0, 3).map((a) => a.slice(0, 400)).join(" ")}`);
  }
  return parts.join(" ").slice(0, maxChars);
}

/** Resolve free text to graph node ids so memories can be highlighted. */
async function mentionedNodeIds(client: FalkorClient, text: string): Promise<string[]> {
  if (!text) return [];
  const words = (text.match(/[A-Za-z][A-Za-z0-9-]{3,}/g) ?? []).slice(0, 12);
  if (words.length === 0) return [];
  try {
    const rows = await client.query<{ id: string }>(
      "MATCH (n) WHERE any(w IN $words WHERE toLower(n.name) CONTAINS toLower(w) " +
        "   OR toLower(coalesce(n.title,'')) CONTAINS toLower(w) " +
        "   OR toLower(coalesce(n.key,'')) = toLower(w)) " +
        "RETURN DISTINCT n.id AS id LIMIT 12",
      { words },
    );
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------

export type ConsolidateResult =
  | { consolidated: false; reason: string }
  | {
      consolidated: true;
      episodic_id: string;
      episodic_summary: string;
      semantic_written: number;
      about: string[];
      turn_count: number;
      timestamp: string;
    };

/**
 * Compress a finished session into episodic + semantic memory.
 *
 * Pass `llm` to have fact segmentation delegated to the model (still guarded
 * against ungrounded output); omit it and the regex path is used.
 */
export async function consolidateSession(
  client: FalkorClient,
  sessionId: string,
  userId: string,
  opts: { threshold?: number; force?: boolean; llm?: BrainLlm | null } = {},
): Promise<ConsolidateResult> {
  const threshold = opts.threshold ?? CONSOLIDATE_AFTER_TURNS;
  const llm = opts.llm ?? null;
  if (!opts.force && !(await shouldConsolidate(client, sessionId, threshold))) {
    return { consolidated: false, reason: "not eligible yet" };
  }

  const summary = await summarizeSession(client, sessionId);
  if (!summary) return { consolidated: false, reason: "no turns" };

  // Facts come from the Researcher's findings when available: those are tool
  // output, already grounded in graph rows. Falling back to the assistant's
  // prose is allowed, but recall markers are stripped either way so memory never
  // absorbs itself.
  let candidates = await factsFromFindings(client, sessionId, llm);
  if (candidates.length === 0) {
    const turns = await getTurns(client, sessionId);
    const fallback: FactCandidate[] = [];
    for (const t of turns) {
      if (t.role === "user") continue;
      const llmFacts = await extractFactsLlm(t.content, llm);
      const facts = llmFacts.length > 0 ? llmFacts : extractFacts(t.content);
      for (const f of facts) fallback.push({ fact: f, about: [] });
    }
    candidates = fallback;
    if (candidates.length === 0) {
      candidates = extractFacts(summary).map((f) => ({ fact: f, about: [] }));
    }
  }

  const about = await mentionedNodeIds(client, summary);
  const ts = nowIso();
  const turnTotal = await turnCount(client, sessionId);

  // One episodic node per session, refreshed on each consolidation so the
  // summary always covers the whole conversation rather than just its opening.
  const eid = `episodic:${sessionId}`;
  await client.write(
    "MATCH (s:Session {id: $sid}) " +
      "MERGE (e:EpisodicMemory {id: $eid}) " +
      "SET e.user_id = $uid, e.summary = $summary, e.timestamp = $ts, " +
      "    e.about = $about, e.turn_count = $turns " +
      "MERGE (s)-[:CONSOLIDATED_INTO]->(e)",
    { sid: sessionId, eid, uid: userId, summary, ts, about, turns: turnTotal },
  );

  // Content-addressed ids: re-learning a fact refreshes it instead of appending
  // a near-duplicate row.
  let factsWritten = 0;
  const seenFacts = new Set<string>();
  for (const item of candidates) {
    const fact = item.fact;
    const key = normalizeFact(fact).slice(0, 80);
    if (!key || seenFacts.has(key)) continue;
    seenFacts.add(key);
    const links = about.length > 0 ? about : item.about ?? [];
    const fid = factId(userId, fact);
    await client.write(
      "MERGE (m:SemanticMemory {id: $fid}) " +
        "SET m.user_id = $uid, m.fact = $fact, m.source = $source, " +
        "    m.timestamp = $ts, m.about = $about",
      { fid, uid: userId, fact, source: sessionId, ts, about: links },
    );
    factsWritten += 1;
  }

  // Mark how far memory has caught up, so the next consolidation is triggered
  // by *new* turns rather than never firing again.
  await client.write("MATCH (s:Session {id: $sid}) SET s.consolidated_turns = $turns", {
    sid: sessionId,
    turns: turnTotal,
  });

  return {
    consolidated: true,
    episodic_id: eid,
    episodic_summary: summary,
    semantic_written: factsWritten,
    about,
    turn_count: turnTotal,
    timestamp: ts,
  };
}

// ---------------------------------------------------------------------------
// Seeded procedural memory
// ---------------------------------------------------------------------------

export const PROCEDURES: Array<{ task_pattern: string; steps: string[] }> = [
  {
    task_pattern: "blast radius / what breaks if a service fails",
    steps: [
      "impact_of_failure(service) — reverse transitive DEPENDS_ON traversal",
      "group affected services by hop distance",
      "name the owning team for the nearest hop",
    ],
  },
  {
    task_pattern: "who knows about a service",
    steps: [
      "find_experts(service) — weighted multi-hop ranking",
      "report each person's evidence (expert / hands-on / owning-team)",
    ],
  },
  {
    task_pattern: "what is blocked / what is stuck",
    steps: [
      "tickets_blocked_by(topic) — traverse Ticket-[:BLOCKED_BY]->Decision",
      "group the blocked tickets by the service they belong to",
    ],
  },
  {
    task_pattern: "why was this decided",
    steps: [
      "get_decision_context(topic) — rationale plus DECIDED_BY",
      "cite the discussion messages via DISCUSSED_IN for provenance",
    ],
  },
];

/** Write the procedural memory a fresh graph needs to answer well. */
export async function installProcedures(client: FalkorClient, userId = "system"): Promise<number> {
  let n = 0;
  for (const proc of PROCEDURES) {
    const slug = proc.task_pattern.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const pid = `procedural:${userId}:${slug}`;
    await client.write(
      "MERGE (p:ProceduralMemory {id: $pid}) " +
        "SET p.user_id = $uid, p.task_pattern = $pattern, p.steps = $steps, " +
        "    p.timestamp = $ts",
      { pid, uid: userId, pattern: proc.task_pattern, steps: proc.steps, ts: nowIso() },
    );
    n += 1;
  }
  return n;
}

/** All recipes available to a user: their own learned ones plus the seeded set. */
export async function proceduresForUser(
  client: FalkorClient,
  userId: string,
): Promise<
  Array<{
    id: string;
    task_pattern: string;
    steps: string[];
    uses: number;
    applied: number;
    successes: number;
    learned: boolean;
  }>
> {
  const rows = await client.query<{
    id: string;
    pattern: string;
    steps: string[] | null;
    uses: number;
    applied: number;
    successes: number;
    learned: boolean;
  }>(
    "MATCH (p:ProceduralMemory) WHERE p.user_id = $uid OR p.user_id = 'system' " +
      "RETURN p.id AS id, p.task_pattern AS pattern, p.steps AS steps, " +
      "       coalesce(p.uses, 0) AS uses, coalesce(p.applied, 0) AS applied, " +
      "       coalesce(p.successes, 0) AS successes, coalesce(p.learned, false) AS learned " +
      "ORDER BY coalesce(p.uses, 0) DESC, p.task_pattern",
    { uid: userId },
  );
  return rows.map((r) => ({
    id: r.id,
    task_pattern: r.pattern,
    steps: r.steps ?? [],
    uses: Number(r.uses),
    applied: Number(r.applied),
    successes: Number(r.successes),
    learned: Boolean(r.learned),
  }));
}
