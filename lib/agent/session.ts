import { getDb } from "@/lib/sqlite";
import { isEventType, type EventType } from "@/lib/agent/events";

/**
 * The append-only session log.
 *
 * Every write is one row: a conversation, a monotonic per-conversation
 * sequence number, an event type and a JSON payload. Nothing is ever
 * updated, so the log doubles as the crash-recovery record — a run that dies
 * mid-turn leaves every committed step behind.
 */

export interface SessionEvent {
  id: number;
  conversation_id: string;
  run_id: string | null;
  seq: number;
  type: EventType;
  data: Record<string, unknown>;
  created_at: number;
}

export interface EventContext {
  conversationId: string;
  runId?: string | null;
}

/** A single serialized event may not exceed this; larger payloads are cut. */
const MAX_EVENT_BYTES = 64 * 1024;

function rowToEvent(row: any): SessionEvent {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.data);
    if (parsed && typeof parsed === "object") data = parsed;
  } catch {
    data = { raw: String(row.data) };
  }
  return {
    id: Number(row.id),
    conversation_id: String(row.conversation_id),
    run_id: row.run_id == null ? null : String(row.run_id),
    seq: Number(row.seq),
    type: isEventType(String(row.type)) ? (String(row.type) as EventType) : ("tool/result" as EventType),
    data,
    created_at: Number(row.created_at),
  };
}

/** Cut a payload that is too large to keep, and say so in the event itself. */
function boundData(data: Record<string, unknown>): string {
  let json = JSON.stringify(data);
  if (json.length <= MAX_EVENT_BYTES) return json;
  const trimmed: Record<string, unknown> = { truncated: true };
  for (const [key, value] of Object.entries(data)) {
    const next = JSON.stringify({ ...trimmed, [key]: value });
    if (next.length > MAX_EVENT_BYTES) break;
    trimmed[key] = value;
  }
  return JSON.stringify(trimmed);
}

/**
 * Append one event. Synchronous on purpose: the read of the next sequence
 * number and the write that uses it must not interleave with another append.
 */
export function appendEvent(
  type: EventType,
  data: Record<string, unknown>,
  ctx: EventContext,
): SessionEvent {
  const db = getDb();
  const row = db
    .prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM session_events WHERE conversation_id = ?")
    .get(ctx.conversationId);
  const seq = Number(row?.m ?? 0) + 1;
  const createdAt = Date.now();
  const payload = boundData(data);
  const res = db
    .prepare(
      "INSERT INTO session_events (conversation_id, run_id, seq, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(ctx.conversationId, ctx.runId ?? null, seq, type, payload, createdAt);
  return {
    id: Number(res.lastInsertRowid),
    conversation_id: ctx.conversationId,
    run_id: ctx.runId ?? null,
    seq,
    type,
    data: JSON.parse(payload),
    created_at: createdAt,
  };
}

export interface ListEventsOptions {
  types?: EventType[];
  limit?: number;
  /** Only events after this sequence number. */
  sinceSeq?: number;
  /** Newest first instead of oldest first. */
  newest?: boolean;
}

/** The events of one conversation, oldest first by default. */
export function listEvents(conversationId: string, opts: ListEventsOptions = {}): SessionEvent[] {
  const db = getDb();
  const params: unknown[] = [conversationId];
  let sql = "SELECT * FROM session_events WHERE conversation_id = ?";
  if (opts.types?.length) {
    sql += ` AND type IN (${opts.types.map(() => "?").join(",")})`;
    params.push(...opts.types);
  }
  if (opts.sinceSeq != null) {
    sql += " AND seq > ?";
    params.push(opts.sinceSeq);
  }
  sql += opts.newest ? " ORDER BY seq DESC" : " ORDER BY seq ASC";
  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  return db.prepare(sql).all(...params).map(rowToEvent);
}

/** Every event of one run — the trace a run panel renders. */
export function listRunEvents(runId: string): SessionEvent[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM session_events WHERE run_id = ? ORDER BY seq ASC")
    .all(runId)
    .map(rowToEvent);
}

/** The last committed sequence number of a conversation (0 when it has none). */
export function latestSeq(conversationId: string): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM session_events WHERE conversation_id = ?")
    .get(conversationId);
  return Number(row?.m ?? 0);
}

export interface SearchHit {
  conversation_id: string;
  type: string;
  data: Record<string, unknown>;
  created_at: number;
  /** How well the row matched the query; higher is better. */
  score: number;
}

/**
 * Full-text search over the log. `query` is FTS5 syntax; a plain word works
 * as expected, and a malformed expression degrades to a LIKE scan rather than
 * throwing.
 */
export function searchEvents(
  query: string,
  opts: { conversationId?: string; limit?: number } = {},
): SearchHit[] {
  const db = getDb();
  const limit = opts.limit ?? 20;
  const trimmed = query.trim();
  if (!trimmed) return [];

  const fts = (conversationId?: string) => {
    let sql =
      "SELECT e.conversation_id AS conversation_id, e.type AS type, e.data AS data, e.created_at AS created_at " +
      "FROM session_events_fts f JOIN session_events e ON e.id = f.rowid " +
      "WHERE session_events_fts MATCH ?";
    const params: unknown[] = [trimmed];
    if (conversationId) {
      sql += " AND e.conversation_id = ?";
      params.push(conversationId);
    }
    sql += " ORDER BY bm25(session_events_fts) LIMIT ?";
    params.push(limit);
    return db.prepare(sql).all(...params);
  };

  let rows: any[];
  try {
    rows = fts(opts.conversationId);
  } catch {
    // Not valid FTS5 syntax — fall back to a substring scan.
    let sql =
      "SELECT conversation_id, type, data, created_at FROM session_events WHERE data LIKE ?";
    const params: unknown[] = [`%${trimmed}%`];
    if (opts.conversationId) {
      sql += " AND conversation_id = ?";
      params.push(opts.conversationId);
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);
    rows = db.prepare(sql).all(...params);
  }

  return rows.map((row: any) => ({
    conversation_id: String(row.conversation_id),
    type: String(row.type),
    data: (() => {
      try {
        const parsed = JSON.parse(row.data);
        return parsed && typeof parsed === "object" ? parsed : { raw: String(row.data) };
      } catch {
        return { raw: String(row.data) };
      }
    })(),
    created_at: Number(row.created_at),
    score: 1,
  }));
}

/** Drop a conversation's history. Used when a conversation is deleted. */
export function deleteConversationEvents(conversationId: string): void {
  getDb().prepare("DELETE FROM session_events WHERE conversation_id = ?").run(conversationId);
}
