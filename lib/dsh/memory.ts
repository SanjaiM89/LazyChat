
/**
 * Durable memory for workspaces + shared global memory, on FalkorDB.
 *
 * Two tiers, both plain graph records (no embeddings, no extra infra):
 *
 * - Workspace memory: Plan / Decision / CodeChange / CommandRun / ErrorFix /
 *   Dependency / Todo / Preference / Link / SessionSummary nodes, each
 *   -[:IN_WORKSPACE]-> its Workspace and carrying workspace_id.
 * - Shared memory: (:SharedMemory) with scope 'global' or 'workspace:<id>'.
 *   Agents in every workspace read global + their own scope; globally-useful
 *   learning is written with scope 'global' and a tag.
 *
 * Rules: secrets are redacted before storage; identical content MERGEs
 * (use_count++); same-slot conflicts resolve to the newest (old text kept in
 * `superseded_by` chain via REPLACED_BY edge); everything survives restarts
 * because it is just graph data.
 */
import { createHash } from "node:crypto";

import { FalkorClient } from "@/lib/brain/graph";
import type { CommandRun, MemoryRecord, MemoryScope, TodoItem } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function uid(prefix: string): string {
  return `${prefix}:${Math.random().toString(16).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function contentId(scope: string, kind: string, text: string): string {
  const norm = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 200);
  return `mem:${createHash("sha1").update(`${scope}|${kind}|${norm}`).digest("hex").slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Redaction (shared references must never carry secrets)
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: RegExp[] = [
  /(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|private[_-]?key)\s*[:=]\s*\S+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[bpas]-[A-Za-z0-9-]+)\b/g,
];

/** Strip credentials before anything is stored or shown. */
export function redactSecrets(text: string): string {
  let out = text ?? "";
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

// ---------------------------------------------------------------------------
// Workspace memory records (plans, decisions, diffs, commands, errors, ...)
// ---------------------------------------------------------------------------

const RECORD_LABELS = {
  plan: "WorkspacePlan",
  decision: "WorkspaceDecision",
  change: "CodeChange",
  command: "CommandRun",
  error: "ErrorFix",
  dependency: "Dependency",
  todo: "Todo",
  preference: "WsPreference",
  link: "WsLink",
  summary: "SessionSummary",
} as const;

export type RecordKind = keyof typeof RECORD_LABELS;

export async function writeWorkspaceRecord(
  client: FalkorClient,
  workspaceId: string,
  kind: RecordKind,
  data: Record<string, unknown>,
  sessionId?: string,
): Promise<string> {
  const label = RECORD_LABELS[kind];
  const id = uid("wr");
  const ts = nowIso();
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    clean[k] = typeof v === "string" ? redactSecrets(v).slice(0, 20000) : v;
  }
  await client.write(
    `CREATE (n:${label} {id: $id}) SET n += $props, n.workspace_id = $wid, ` +
      `n.created_at = $ts, n.updated_at = $ts ` +
      `WITH n MATCH (w:Workspace {id: $wid}) MERGE (n)-[:IN_WORKSPACE]->(w)`,
    { id, props: clean, wid: workspaceId, ts },
  );
  if (sessionId) {
    await client.write(
      `MATCH (n {id: $id}), (s:AgentSession {id: $sid}) MERGE (n)-[:RECORDED_IN]->(s)`,
      { id, sid: sessionId },
    );
  }
  return id;
}

export async function readWorkspaceRecords(
  client: FalkorClient,
  workspaceId: string,
  kind: RecordKind,
  limit = 50,
): Promise<Array<Record<string, unknown>>> {
  const label = RECORD_LABELS[kind];
  const rows = await client.query<{ n: Record<string, unknown> }>(
    `MATCH (n:${label}) WHERE n.workspace_id = $wid ` +
      `RETURN properties(n) AS n ORDER BY n.updated_at DESC, n.created_at DESC LIMIT $limit`,
    { wid: workspaceId, limit },
  );
  return rows.map((r) => r.n);
}

/** Formatted memory block injected into an agent prompt (global first). */
export async function buildMemoryContext(
  client: FalkorClient,
  workspaceId: string,
  maxChars = 6000,
): Promise<string> {
  const parts: string[] = [];
  const shared = await recallShared(client, workspaceId, "", 12);
  if (shared.length > 0) {
    parts.push(
      "## Shared memory (applies across workspaces)\n" +
        shared.map((m) => `- [${m.kind}] ${m.text.slice(0, 300)}`).join("\n"),
    );
  }
  for (const kind of ["summary", "decision", "plan", "error", "preference"] as RecordKind[]) {
    const recs = await readWorkspaceRecords(client, workspaceId, kind, 6);
    if (recs.length === 0) continue;
    const lines = recs.map((r) => {
      const s = r as Record<string, unknown>;
      const text =
        (s.summary as string) || (s.body as string) || (s.text as string) || (s.title as string) || "";
      const title = typeof s.title === "string" && text !== s.title ? `${s.title}: ` : "";
      const extra =
        kind === "error" && s.fix ? ` Fix: ${String(s.fix).slice(0, 200)}` : "";
      const pref = kind === "preference" && s.key ? `${String(s.key)}: ` : "";
      return `- ${pref}${title}${String(text).slice(0, 300)}${extra}`;
    });
    parts.push(`## Workspace ${kind}s\n${lines.join("\n")}`);
  }
  const todos = await listTodos(client, workspaceId);
  const open = todos.filter((t) => t.status !== "done");
  if (open.length > 0) {
    parts.push("## Open TODOs\n" + open.map((t) => `- [${t.status}] ${t.text}`).join("\n"));
  }
  const joined = parts.join("\n\n").slice(0, maxChars);
  return joined
    ? "## Relevant memory (loaded automatically: shared global + this workspace)\n" + joined
    : "";
}

// ---------------------------------------------------------------------------
// TODOs
// ---------------------------------------------------------------------------

export async function addTodo(client: FalkorClient, workspaceId: string, text: string): Promise<TodoItem> {
  const existing = await client.query<{ n: number }>(
    "MATCH (t:Todo) WHERE t.workspace_id = $wid RETURN count(t) AS n",
    { wid: workspaceId },
  );
  const id = uid("todo");
  const ts = nowIso();
  await client.write(
    "CREATE (t:Todo {id: $id, workspace_id: $wid, text: $text, status: 'open', " +
      "sort: $sort, created_at: $ts, updated_at: $ts}) " +
      "WITH t MATCH (w:Workspace {id: $wid}) MERGE (t)-[:IN_WORKSPACE]->(w)",
    { id, wid: workspaceId, text: redactSecrets(text).slice(0, 2000), sort: Number(existing[0]?.n ?? 0), ts },
  );
  return { id, workspace_id: workspaceId, text, status: "open", sort: 0, created_at: ts, updated_at: ts };
}

export async function setTodoStatus(
  client: FalkorClient,
  todoId: string,
  status: "open" | "doing" | "done",
): Promise<void> {
  await client.write("MATCH (t:Todo {id: $id}) SET t.status = $status, t.updated_at = $ts", {
    id: todoId,
    status,
    ts: nowIso(),
  });
}

export async function listTodos(client: FalkorClient, workspaceId: string): Promise<TodoItem[]> {  const rows = await client.query(
    "MATCH (t:Todo) WHERE t.workspace_id = $wid RETURN t.id AS id, t.text AS text, " +
      "t.status AS status, t.sort AS sort, t.created_at AS created_at, t.updated_at AS updated_at " +
      "ORDER BY t.sort ASC",
    { wid: workspaceId },
  );
  return rows.map((r) => ({
    id: r.id as string,
    workspace_id: workspaceId,
    text: (r.text as string) ?? "",
    status: ((r.status as string) === "doing" ? "doing" : (r.status as string) === "done" ? "done" : "open") as TodoItem["status"],
    sort: Number(r.sort ?? 0),
    created_at: (r.created_at as string) ?? "",
    updated_at: (r.updated_at as string) ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Command runs (truncated output, head/tail kept)
// ---------------------------------------------------------------------------

export async function recordCommandRun(
  client: FalkorClient,
  workspaceId: string,
  command: string,
  output: string,
  exitCode: number,
  durationMs: number,
  sessionId?: string,
  runId?: string,
): Promise<string> {
  const MAX = 8000;
  let kept = output ?? "";
  if (kept.length > MAX) {
    kept = kept.slice(0, 4000) + `\n… [${kept.length - 8000} chars cut] …\n` + kept.slice(-4000);
  }
  return writeWorkspaceRecord(
    client,
    workspaceId,
    "command",
    { command: redactSecrets(command).slice(0, 2000), output: redactSecrets(kept), exit_code: exitCode, duration_ms: durationMs, run_id: runId ?? "" },
    sessionId,
  );
}

export async function recentCommands(client: FalkorClient, workspaceId: string, limit = 20): Promise<CommandRun[]> {
  const recs = await readWorkspaceRecords(client, workspaceId, "command", limit);
  return recs.map((r) => {
    const s = r as Record<string, unknown>;
    return {
      id: (s.id as string) ?? "",
      workspace_id: workspaceId,
      session_id: (s.session_id as string) ?? undefined,
      run_id: (s.run_id as string) ?? undefined,
      command: (s.command as string) ?? "",
      exit_code: typeof s.exit_code === "number" ? s.exit_code : undefined,
      output: (s.output as string) ?? "",
      started_at: (s.created_at as string) ?? "",
      duration_ms: typeof s.duration_ms === "number" ? s.duration_ms : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Shared memory (global + per-workspace scopes)
// ---------------------------------------------------------------------------

function rowToMemory(r: Record<string, unknown>): MemoryRecord {
  return {
    id: r.id as string,
    scope: (r.scope as string) ?? "global",
    kind: (r.kind as string) ?? "note",
    text: (r.text as string) ?? "",
    slot: (r.slot as string) ?? null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    use_count: Number(r.use_count ?? 0),
    created_at: (r.created_at as string) ?? "",
    updated_at: (r.updated_at as string) ?? "",
  };
}

/**
 * Store shared memory with dedup + conflict resolution.
 * - Identical content (same scope/kind/text) → use_count++, timestamp refresh.
 * - Same slot, different text → newest wins; old node kept with REPLACED_BY.
 */
export async function storeShared(
  client: FalkorClient,
  input: { scope: MemoryScope; kind: string; text: string; slot?: string | null; tags?: string[] },
): Promise<MemoryRecord> {
  const text = redactSecrets(input.text).trim().slice(0, 4000);
  if (!text) throw new Error("Cannot store empty memory.");
  const scope = input.scope;
  const kind = input.kind.trim().toLowerCase().slice(0, 40) || "note";
  const slot = input.slot?.trim() || null;
  const tags = (input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12);
  const ts = nowIso();

  const id = contentId(scope, kind, text);
  const dupe = await client.query<{ id: string }>("MATCH (m:SharedMemory {id: $id}) RETURN m.id AS id LIMIT 1", {
    id,
  });
  if (dupe.length > 0) {
    await client.write(
      "MATCH (m:SharedMemory {id: $id}) SET m.use_count = coalesce(m.use_count, 0) + 1, m.updated_at = $ts",
      { id, ts },
    );
    const rows = await client.query(
      "MATCH (m:SharedMemory {id: $id}) RETURN m.id AS id, m.scope AS scope, m.kind AS kind, " +
        "m.text AS text, m.slot AS slot, m.tags AS tags, m.use_count AS use_count, " +
        "m.created_at AS created_at, m.updated_at AS updated_at LIMIT 1",
      { id },
    );
    return rowToMemory(rows[0]);
  }

  if (slot) {
    const conflicts = await client.query<{ id: string }>(
      "MATCH (m:SharedMemory) WHERE m.scope = $scope AND m.slot = $slot AND m.id <> $id " +
        "RETURN m.id AS id",
      { scope, slot, id },
    );
    await client.write(
      "MERGE (m:SharedMemory {id: $id}) SET m.scope = $scope, m.kind = $kind, m.text = $text, " +
        "m.slot = $slot, m.tags = $tags, m.use_count = 0, m.created_at = $ts, m.updated_at = $ts",
      { id, scope, kind, text, slot, tags, ts },
    );
    for (const c of conflicts) {
      await client.write(
        "MATCH (old:SharedMemory {id: $old}), (new:SharedMemory {id: $new}) " +
          "MERGE (old)-[:REPLACED_BY]->(new)",
        { old: c.id, new: id },
      );
    }
  } else {
    await client.write(
      "MERGE (m:SharedMemory {id: $id}) SET m.scope = $scope, m.kind = $kind, m.text = $text, " +
        "m.slot = $slot, m.tags = $tags, m.use_count = 0, m.created_at = $ts, m.updated_at = $ts",
      { id, scope, kind, text, slot, tags, ts },
    );
  }
  const rows = await client.query(
    "MATCH (m:SharedMemory {id: $id}) RETURN m.id AS id, m.scope AS scope, m.kind AS kind, " +
      "m.text AS text, m.slot AS slot, m.tags AS tags, m.use_count AS use_count, " +
      "m.created_at AS created_at, m.updated_at AS updated_at LIMIT 1",
    { id },
  );
  return rowToMemory(rows[0]);
}

/** Recall global + one workspace scope, ranked by keyword overlap. */
export async function recallShared(
  client: FalkorClient,
  workspaceId: string,
  query = "",
  limit = 12,
): Promise<MemoryRecord[]> {
  const scopes = ["global", `workspace:${workspaceId}`];
  const rows = await client.query(
    "MATCH (m:SharedMemory) WHERE m.scope IN $scopes RETURN m.id AS id, m.scope AS scope, " +
      "m.kind AS kind, m.text AS text, m.slot AS slot, m.tags AS tags, m.use_count AS use_count, " +
      "m.created_at AS created_at, m.updated_at AS updated_at ORDER BY m.updated_at DESC LIMIT 200",
    { scopes },
  );
  const terms = new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
  const scored = rows.map((r) => {
    const mem = rowToMemory(r);
    const hay = `${mem.text} ${(mem.tags ?? []).join(" ")} ${mem.kind}`.toLowerCase();
    let overlap = 0;
    for (const t of terms) if (hay.includes(t)) overlap += 1;
    // Global memories slightly outrank workspace ones on ties (shared first).
    return { mem, score: overlap + (mem.scope === "global" ? 0.1 : 0) };
  });
  scored.sort((a, b) => b.score - a.score);
  const relevant = scored.filter((s) => s.score > 0.1);
  const picked = (relevant.length > 0 ? relevant : scored).slice(0, limit).map((s) => s.mem);
  if (picked.length > 0) {
    await client.write("MATCH (m:SharedMemory) WHERE m.id IN $ids SET m.use_count = coalesce(m.use_count, 0) + 1", {
      ids: picked.map((m) => m.id),
    });
  }
  return picked;
}

export async function updateShared(
  client: FalkorClient,
  id: string,
  patch: { text?: string; tags?: string[] },
): Promise<MemoryRecord | null> {
  const sets: string[] = ["m.updated_at = $ts"];
  const params: Record<string, unknown> = { id, ts: nowIso() };
  if (patch.text !== undefined) {
    sets.push("m.text = $text");
    params.text = redactSecrets(patch.text).trim().slice(0, 4000);
  }
  if (patch.tags !== undefined) {
    sets.push("m.tags = $tags");
    params.tags = patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12);
  }
  await client.write(`MATCH (m:SharedMemory {id: $id}) SET ${sets.join(", ")}`, params);
  const rows = await client.query(
    "MATCH (m:SharedMemory {id: $id}) RETURN m.id AS id, m.scope AS scope, m.kind AS kind, " +
      "m.text AS text, m.slot AS slot, m.tags AS tags, m.use_count AS use_count, " +
      "m.created_at AS created_at, m.updated_at AS updated_at LIMIT 1",
    { id },
  );
  return rows.length > 0 ? rowToMemory(rows[0]) : null;
}

export async function deleteShared(client: FalkorClient, id: string): Promise<boolean> {
  const rows = await client.query<{ n: number }>(
    "MATCH (m:SharedMemory {id: $id}) DETACH DELETE m RETURN 1 AS n",
    { id },
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Deterministic workspace capture: the user's own words, no model needed
//
// Mirrors the Omnia personal-fact fast path. Explicit statements ("remember
// that X", "we decided Y", "TODO: Z") are stored as workspace memory the
// moment the turn finishes — independent of whether the model calls any
// memory tool. Everything here is pure regex + MERGE; it never throws.
// ---------------------------------------------------------------------------

export interface WorkspaceFacts {
  memories: Array<{ kind: string; text: string; slot?: string | null }>;
  todos: string[];
  decisions: Array<{ title: string; body: string }>;
}

function cleanLine(text: string, maxLen = 200): string {
  return text.trim().replace(/\s+/g, " ").replace(/[.?!;,]+$/g, "").trim().slice(0, maxLen);
}

/**
 * Pull durable workspace facts out of one user turn. Pure and synchronous.
 */
export function extractWorkspaceFacts(text: string): WorkspaceFacts {
  const out: WorkspaceFacts = { memories: [], todos: [], decisions: [] };
  if (!text) return out;

  // Explicit remembers: "remember that X", "note X", "don't forget X".
  const rememberRe =
    /(?:remember|note)(?:\s+that)?\s+(.+?)(?:[.!?]|$)|don't forget\s+(.+?)(?:[.!?]|$)|keep in mind\s+(.+?)(?:[.!?]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = rememberRe.exec(text)) !== null) {
    const raw = cleanLine(m[1] ?? m[2] ?? m[3] ?? "");
    if (raw.length < 4) continue;
    if (/^me\b/i.test(raw)) continue; // "remember me" (login checkbox), not a fact
    if (/^to\s+\w/i.test(raw)) {
      // "remember to restart X" is future work, not a fact.
      out.todos.push(raw.replace(/^to\s+/i, ""));
    } else {
      out.memories.push({ kind: "note", text: raw.endsWith(".") ? raw : `${raw}.` });
    }
  }

  // TODO markers: lines starting with TODO:/TASK:, plus "add a todo".
  for (const line of text.split("\n")) {
    const marked = /^(?:todo|task)\s*:\s*(.+)$/i.exec(line.trim())?.[1];
    if (marked) {
      const clean = cleanLine(marked, 160);
      if (clean.length >= 3) out.todos.push(clean);
    }
  }
  const addTodo =
    /how (?:do|to|can|should)\b/i.test(text)
      ? undefined // "how do I add a todo" is a question, not a task
      : /add (?:a )?todo\s*:?\s*(.+?)(?:[.!?]|$)/i.exec(text)?.[1];
  if (addTodo) {
    const clean = cleanLine(addTodo, 160);
    if (clean.length >= 3 && !out.todos.includes(clean)) out.todos.push(clean);
  }

  // Stated decisions: "we decided X", "decision: Y", "let's go with Z".
  const decided =
    /\bwe (?:decided|chose|picked|will use|are going with|agreed (?:on|to))\b\s*(.{4,140})/i.exec(
      text,
    )?.[1] ?? /^\s*decision\s*:\s*(.+)$/im.exec(text)?.[1];
  if (decided) {
    const title = cleanLine(decided, 140);
    if (title.length >= 4) {
      out.decisions.push({ title, body: cleanLine(text, 600) });
    }
  }

  return out;
}

/**
 * Store extracted facts as workspace memory with existence checks:
 * - memories MERGE by content id (storeShared dedups repeats);
 * - todos skip when an equal open todo already exists;
 * - decisions skip when an equal-titled decision already exists.
 */
export async function captureWorkspaceFacts(
  client: FalkorClient,
  workspaceId: string,
  userText: string,
  sessionId?: string,
): Promise<{ memories: number; todos: number; decisions: number }> {
  const found = extractWorkspaceFacts(userText ?? "");
  const scope = `workspace:${workspaceId}`;
  let memories = 0;
  let todos = 0;
  let decisions = 0;

  for (const mem of found.memories) {
    await storeShared(client, { scope, kind: mem.kind, text: mem.text, slot: mem.slot ?? null });
    memories += 1;
  }

  for (const text of found.todos) {
    const existing = await client.query<{ id: string }>(
      "MATCH (t:Todo) WHERE t.workspace_id = $wid AND t.status <> 'done' " +
        "AND toLower(t.text) = toLower($text) RETURN t.id AS id LIMIT 1",
      { wid: workspaceId, text },
    );
    if (existing.length === 0) {
      await addTodo(client, workspaceId, text);
      todos += 1;
    }
  }

  for (const d of found.decisions) {
    const existing = await client.query<{ id: string }>(
      "MATCH (n:WorkspaceDecision) WHERE n.workspace_id = $wid " +
        "AND toLower(n.title) = toLower($title) RETURN n.id AS id LIMIT 1",
      { wid: workspaceId, title: d.title },
    );
    if (existing.length === 0) {
      await writeWorkspaceRecord(client, workspaceId, "decision", { title: d.title, body: d.body }, sessionId);
      decisions += 1;
    }
  }

  return { memories, todos, decisions };
}
