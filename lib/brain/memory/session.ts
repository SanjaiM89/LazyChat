/**
 * Session and turn persistence in FalkorDB.
 *
 * Memory is not a side-channel here — conversation state lives *in the graph*,
 * so recalling something a user said last week is a Cypher query against the
 * same database that answers engineering questions. Removing FalkorDB removes
 * recall along with everything else.
 *
 * Isolation: every memory node carries `user_id`, and every read filters on it.
 * Two users asking the same question never see each other's memories.
 */
import type { FalkorClient } from "../graph";
import type { MemoryNode } from "../types";

export function nowIso(): string {
  return new Date().toISOString();
}

function uid(hex: number): string {
  let out = "";
  for (let i = 0; i < hex; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

export function newSessionId(userId = "demo"): string {
  return `session:${userId}:${uid(10)}`;
}

export type SessionSummary = {
  session_id: string;
  started_at: string | null;
  last_active_at: string | null;
  turn_count: number;
  preview: string | null;
};

export type Turn = {
  id: string;
  role: string;
  content: string;
  timestamp: string | null;
  agent: string | null;
};

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Create (or return) the Session node for this conversation. */
export async function startSession(
  client: FalkorClient,
  userId: string,
  sessionId?: string | null,
): Promise<{ session_id: string; user_id: string; started_at: string }> {
  const sid = sessionId || newSessionId(userId);
  const ts = nowIso();
  await client.write(
    "MERGE (s:Session {id: $sid}) " +
      "ON CREATE SET s.user_id = $uid, s.started_at = $ts, s.turn_count = 0 " +
      "SET s.last_active_at = $ts",
    { sid, uid: userId, ts },
  );
  return { session_id: sid, user_id: userId, started_at: ts };
}

/** Guarantee a session exists before a turn is written to it. */
export async function ensureSession(
  client: FalkorClient,
  userId: string,
  sessionId?: string | null,
): Promise<string> {
  if (sessionId) {
    const rows = await client.query("MATCH (s:Session {id: $sid}) RETURN s.id AS id", { sid: sessionId });
    if (rows.length > 0) return sessionId;
  }
  return (await startSession(client, userId, sessionId)).session_id;
}

/** Past sessions for one user, most recent first. */
export async function listSessions(
  client: FalkorClient,
  userId: string,
  limit = 50,
): Promise<SessionSummary[]> {
  const rows = await client.query<{
    session_id: string;
    started_at: string | null;
    last_active: string | null;
    turn_count: number;
    preview: string | null;
  }>(
    "MATCH (s:Session) WHERE s.user_id = $uid " +
      "OPTIONAL MATCH (s)-[:CONTAINS]->(t:Turn) " +
      "RETURN s.id AS session_id, s.started_at AS started_at, " +
      "       s.last_active_at AS last_active, count(t) AS turn_count, " +
      "       head([x IN collect(t.content) WHERE x IS NOT NULL AND x <> '']) AS preview " +
      "ORDER BY coalesce(s.last_active_at, s.started_at) DESC LIMIT $limit",
    { uid: userId, limit },
  );
  return rows.map((r) => {
    const preview = r.preview;
    return {
      session_id: r.session_id,
      started_at: r.started_at,
      last_active_at: r.last_active,
      turn_count: Number(r.turn_count),
      preview: preview && preview.length > 120 ? `${preview.slice(0, 120)}...` : preview,
    };
  });
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

/** Append one Turn to a Session. */
export async function recordTurn(
  client: FalkorClient,
  sessionId: string,
  role: string,
  content: string,
  agent?: string | null,
): Promise<{ turn_id: string; role: string; content: string; timestamp: string }> {
  const turnId = `turn:${uid(12)}`;
  const ts = nowIso();
  await client.write(
    "MATCH (s:Session {id: $sid}) " +
      "CREATE (t:Turn {id: $tid, role: $role, content: $content, " +
      "        timestamp: $ts, agent: $agent}) " +
      "MERGE (s)-[:CONTAINS]->(t) " +
      "SET s.turn_count = coalesce(s.turn_count, 0) + 1, s.last_active_at = $ts",
    { sid: sessionId, tid: turnId, role, content, ts, agent: agent ?? null },
  );
  return { turn_id: turnId, role, content, timestamp: ts };
}

export async function getTurns(
  client: FalkorClient,
  sessionId: string,
  limit = 200,
): Promise<Turn[]> {
  const rows = await client.query<{
    id: string;
    role: string;
    content: string;
    timestamp: string | null;
    agent: string | null;
  }>(
    "MATCH (s:Session {id: $sid})-[:CONTAINS]->(t:Turn) " +
      "RETURN t.id AS id, t.role AS role, t.content AS content, t.timestamp AS timestamp, t.agent AS agent " +
      "ORDER BY t.timestamp ASC LIMIT $limit",
    { sid: sessionId, limit },
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    timestamp: r.timestamp,
    agent: r.agent,
  }));
}

export async function turnCount(client: FalkorClient, sessionId: string): Promise<number> {
  const rows = await client.query<{ c: number }>(
    "MATCH (s:Session {id: $sid})-[:CONTAINS]->(t:Turn) RETURN count(t) AS c",
    { sid: sessionId },
  );
  return rows.length > 0 ? Number(rows[0].c) : 0;
}

// ---------------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------------

// Recall is lexical against the memory nodes' own text. Deliberately not vector
// search: it stays inspectable, needs no embedding service, and the reasoning
// trace can show exactly which memory node was recalled and why.
const RECALL_CYPHER = `
MATCH (n)
WHERE (n:EpisodicMemory OR n:SemanticMemory) AND n.user_id = $uid
RETURN n.id AS id,
       coalesce(n.summary, n.fact) AS text,
       n.timestamp AS ts,
       CASE WHEN n:EpisodicMemory THEN 'episodic' ELSE 'semantic' END AS kind,
       coalesce(n.about, []) AS about
ORDER BY ts DESC LIMIT 50
`;

/**
 * Memories for this user, ranked by keyword overlap with `question`.
 *
 * Per-user by construction: the query filters on `user_id`, so one user can
 * never see another's memory even when they ask the same question.
 */
export async function recallMemories(
  client: FalkorClient,
  userId: string,
  question = "",
  limit = 6,
): Promise<Array<MemoryNode & { score: number }>> {
  const rows = await client.query<{
    id: string;
    text: string | null;
    ts: string | null;
    kind: string;
    about: string[] | null;
  }>(RECALL_CYPHER, { uid: userId });
  if (rows.length === 0) return [];

  const terms = new Set(
    question
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
  const scored = rows.map((r) => {
    const textLower = (r.text ?? "").toLowerCase();
    let overlap = 0;
    for (const t of terms) if (textLower.includes(t)) overlap += 1;
    return {
      id: r.id,
      summary: r.text ?? "",
      timestamp: r.ts,
      kind: (r.kind === "episodic" ? "episodic" : "semantic") as MemoryNode["kind"],
      about: r.about ?? [],
      score: overlap,
    };
  });

  // Score descending, then oldest-first within a score (mirrors the two stable
  // sorts in the original implementation).
  scored.sort((a, b) => b.score - a.score || (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));

  const relevant = scored.filter((m) => m.score > 0);
  return (relevant.length > 0 ? relevant : scored).slice(0, limit);
}

export async function memoryStats(
  client: FalkorClient,
  userId: string,
): Promise<Record<string, number>> {
  const rows = await client.query<{ label: string; c: number }>(
    "MATCH (n) WHERE (n:EpisodicMemory OR n:SemanticMemory OR n:ProceduralMemory) " +
      "AND n.user_id = $uid RETURN labels(n)[0] AS label, count(*) AS c",
    { uid: userId },
  );
  return Object.fromEntries(rows.map((r) => [r.label, Number(r.c)]));
}
