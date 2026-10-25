/**
 * Conversations in Firestore, written as the signed-in user (see lib/auth/token.ts).
 *
 *   conversations/{id}                 metadata: ownerId, orgId, title, timestamps, model, usage, lastRun
 *   conversations/{id}/messages/{i_c}  one UI message per doc (chunked past 250k chars, so no 1 MB limit)
 *
 * Saves are incremental: only messages whose hash changed are rewritten. If Firestore rejects a write because
 * the user's token expired (a background run outlived it), the whole conversation is parked in data/outbox/
 * and pushed on the owner's next request, so nothing is lost.
 */
import crypto from "node:crypto";
import { getDb } from "@/lib/sqlite";
import fs from "node:fs";
import path from "node:path";

import { currentUser } from "@/lib/auth/context";
import { latestToken } from "@/lib/auth/token";
import { DATA_DIR } from "@/lib/data-dir";
import { FirestoreError, commit, getDoc, listDocs, queryEquals, type Doc, type Plain, type Write } from "@/lib/firestore-rest";

export interface StoredConversation {
  /** Firebase uid of the owner and the org they belonged to when it was created. */
  ownerId?: string;
  orgId?: string | null;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model: string;
  messages: unknown[];
  /**
   * The session's working directory. It starts at the attached workspace and
   * moves with `working_directory`; the workspace a session belongs to is the
   * one whose path equals this.
   */
  cwd?: string;
  /** Cumulative token usage across runs (dsh-style accounting). */
  usage?: { inputTokens: number; outputTokens: number };
  /** Last finished run: freshness for speed + context pressure. */
  lastRun?: { inputTokens: number; outputTokens: number; decodeMs: number; at: number };
}

export type ConversationMeta = Omit<StoredConversation, "messages">;

export const CHUNK_CHARS = 250_000;
const pad = (n: number, w = 6) => String(n).padStart(w, "0");
const sha = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

// ---- pure helpers (unit-tested) -----------------------------------------------------------------

export interface MsgDoc {
  id: string;
  data: { idx: number; chunk: number; total: number; h: string; json: string };
}

/** Split messages into Firestore docs; ids sort in message order. */
export function toMessageDocs(messages: unknown[]): MsgDoc[] {
  const out: MsgDoc[] = [];
  messages.forEach((m, idx) => {
    const json = JSON.stringify(m) ?? "null";
    const h = sha(json);
    const total = Math.max(1, Math.ceil(json.length / CHUNK_CHARS));
    for (let c = 0; c < total; c++) {
      out.push({ id: `${pad(idx)}_${pad(c, 3)}`, data: { idx, chunk: c, total, h, json: json.slice(c * CHUNK_CHARS, (c + 1) * CHUNK_CHARS) } });
    }
  });
  return out;
}

/** Reassemble messages from stored docs (any order). */
export function fromMessageDocs(docs: Array<{ data: Record<string, Plain> }>): unknown[] {
  const byIdx = new Map<number, string[]>();
  for (const d of [...docs].sort((a, b) => Number(a.data.idx) * 1000 + Number(a.data.chunk) - (Number(b.data.idx) * 1000 + Number(b.data.chunk)))) {
    const i = Number(d.data.idx);
    byIdx.set(i, [...(byIdx.get(i) ?? []), String(d.data.json ?? "")]);
  }
  return [...byIdx.keys()].sort((a, b) => a - b).map((i) => JSON.parse(byIdx.get(i)!.join("")));
}

/** Writes needed to turn `existing` (id -> hash) into `next`: changed/new docs, plus ids to delete. */
export function diffMessageDocs(existing: Map<string, string>, next: MsgDoc[]): { upserts: MsgDoc[]; deletes: string[] } {
  const keep = new Set(next.map((d) => d.id));
  return {
    upserts: next.filter((d) => existing.get(d.id) !== d.data.h),
    deletes: [...existing.keys()].filter((id) => !keep.has(id)),
  };
}

// ---- token + outbox -------------------------------------------------------------------------------

function tokenFor(uid: string): string {
  const t = latestToken(uid);
  if (!t) throw new FirestoreError(401, "No valid sign-in token for this user");
  return t;
}

const outboxDir = (uid: string) => path.join(DATA_DIR, "outbox", uid.replace(/[^A-Za-z0-9_-]/g, "_"));
const outboxFile = (uid: string, id: string) => path.join(outboxDir(uid), `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);

function parkInOutbox(conv: StoredConversation) {
  fs.mkdirSync(outboxDir(conv.ownerId!), { recursive: true });
  fs.writeFileSync(outboxFile(conv.ownerId!, conv.id), JSON.stringify(conv));
}

function readOutbox(uid: string, id: string): StoredConversation | null {
  try {
    return JSON.parse(fs.readFileSync(outboxFile(uid, id), "utf8")) as StoredConversation;
  } catch {
    return null;
  }
}

function clearOutbox(uid: string, id: string) {
  try {
    fs.unlinkSync(outboxFile(uid, id));
  } catch {
    /* none */
  }
}

// ---- caches ---------------------------------------------------------------------------------------

/** id -> (message doc id -> hash) as last seen in Firestore, so saves can be incremental. */
const synced = new Map<string, Map<string, string>>();
const META_TTL = 20_000;

// Caches are pinned to globalThis: in dev, Fast Refresh re-evaluates this
// module between requests, and a plain module-level Map would silently come
// back empty — turning the stale-serving fallbacks below into 500s exactly
// when Firestore is unreachable. Symbol.for makes the slot stable across
// re-evaluation (same trick as the brain caches).
const CACHE_SLOT = Symbol.for("lazychat.chat-store.caches");
const caches = ((globalThis as Record<symbol, unknown>)[CACHE_SLOT] ??= {
  meta: new Map<string, { at: number; meta: ConversationMeta | null }>(),
  list: new Map<string, ConversationMeta[]>(),
  conv: new Map<string, StoredConversation>(),
}) as {
  meta: Map<string, { at: number; meta: ConversationMeta | null }>;
  list: Map<string, ConversationMeta[]>;
  conv: Map<string, StoredConversation>;
};
const metaCache = caches.meta;

// Last-known-good copies served only when Firestore itself is unreachable
// (network error, not a Firestore answer), so a flaky route degrades reads
// instead of failing them. Fresh TTLs still apply to the happy path above.
const listCache = caches.list;
const convCache = caches.conv;
const CONV_CACHE_MAX = 40;

function putConvCache(conv: StoredConversation): void {
  convCache.delete(conv.id);
  convCache.set(conv.id, conv);
  while (convCache.size > CONV_CACHE_MAX) {
    const oldest = convCache.keys().next().value;
    if (oldest === undefined) break;
    convCache.delete(oldest);
  }
}

const metaFrom = (d: Doc): ConversationMeta => ({
  id: d.id,
  ownerId: String(d.data.ownerId ?? ""),
  orgId: (d.data.orgId as string | null) ?? null,
  title: String(d.data.title ?? ""),
  createdAt: Number(d.data.createdAt ?? 0),
  updatedAt: Number(d.data.updatedAt ?? 0),
  provider: String(d.data.provider ?? ""),
  model: String(d.data.model ?? ""),
  cwd: (d.data.cwd as string | undefined) ?? undefined,
  usage: (d.data.usage as ConversationMeta["usage"]) ?? undefined,
  lastRun: (d.data.lastRun as ConversationMeta["lastRun"]) ?? undefined,
});

function who(uid?: string): string | undefined {
  return uid ?? currentUser()?.uid;
}

// ---- public API -------------------------------------------------------------------------------------

/** Metadata only. null if missing or not owned by `ownerId` (default: the current user). */
export async function getConversationMeta(id: string, ownerId?: string): Promise<ConversationMeta | null> {
  const uid = who(ownerId) ?? "local";
  const db = getDb();
  const row = db.prepare("SELECT data FROM conversations WHERE id = ? AND (owner_id IS NULL OR owner_id = ?)").get(id, uid) as { data: string } | undefined;
  if (!row) return null;
  const conv = JSON.parse(row.data) as StoredConversation;
  const { messages: _m, ...meta } = conv;
  void _m;
  return meta as ConversationMeta;
}

export async function getConversation(id: string, ownerId?: string): Promise<StoredConversation | null> {
  const uid = who(ownerId) ?? "local";
  const db = getDb();
  const row = db.prepare("SELECT data FROM conversations WHERE id = ? AND (owner_id IS NULL OR owner_id = ?)").get(id, uid) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as StoredConversation;
}

export async function listConversations(ownerId?: string): Promise<ConversationMeta[]> {
  const uid = who(ownerId) ?? "local";
  const db = getDb();
  const rows = db.prepare("SELECT data FROM conversations WHERE owner_id IS NULL OR owner_id = ? ORDER BY updated_at DESC").all(uid) as { data: string }[];
  const out: ConversationMeta[] = [];
  for (const r of rows) {
    const conv = JSON.parse(r.data) as StoredConversation;
    const { messages: _m, ...meta } = conv;
    void _m;
    out.push(meta as ConversationMeta);
  }
  return out;
}

export async function saveConversation(
  conv: StoredConversation,
  owner?: { uid: string; orgId: string | null },
): Promise<void> {
  const uid = owner?.uid ?? conv.ownerId ?? who() ?? "local";
  const full: StoredConversation = { ...conv, ownerId: uid, createdAt: conv.createdAt ?? Date.now() };
  const db = getDb();
  db.prepare(
    "INSERT INTO conversations (id, owner_id, org_id, data, updated_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id, org_id=excluded.org_id, data=excluded.data, updated_at=excluded.updated_at",
  ).run(full.id, uid, full.orgId ?? null, JSON.stringify(full), full.updatedAt ?? Date.now());
}

export async function deleteConversation(id: string, ownerId?: string): Promise<void> {
  const uid = who(ownerId) ?? "local";
  const db = getDb();
  db.prepare("DELETE FROM conversations WHERE id = ? AND (owner_id IS NULL OR owner_id = ?)").run(id, uid);
}

export async function clearConversations(ownerId?: string): Promise<void> {
  const uid = who(ownerId) ?? "local";
  const db = getDb();
  db.prepare("DELETE FROM conversations WHERE owner_id IS NULL OR owner_id = ?").run(uid);
}

const lastFlush = new Map<string, number>();

/** Push parked conversations for this user (called from authed requests, at most once a minute). */
export async function flushOutbox(uid: string): Promise<void> {
  if (Date.now() - (lastFlush.get(uid) ?? 0) < 60_000) return;
  lastFlush.set(uid, Date.now());
  let files: string[] = [];
  try {
    files = fs.readdirSync(outboxDir(uid));
  } catch {
    return;
  }
  for (const f of files) {
    const conv = readOutbox(uid, f.replace(/[.]json$/, ""));
    if (!conv) continue;
    clearOutbox(uid, conv.id);
    await saveConversation(conv, { uid, orgId: conv.orgId ?? null }).catch(() => {});
  }
}
