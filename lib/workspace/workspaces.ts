
/**
 * Workspace registry on FalkorDB, shaped like the harness's registry.
 *
 * A workspace is a record over one existing directory. The canonical path is
 * the record's identity, so a symlink to a directory that is already a
 * workspace collides with it. Sessions join a workspace by the directory they
 * run in, not by an id stored on them. Removing a workspace never touches the
 * directory, its files, or the session histories — they simply become
 * ungrouped.
 */
import fs from "node:fs";
import { validateSchema } from "@/lib/agent/json-schema";
import path from "node:path";

import { FalkorClient } from "@/lib/brain/graph";
import type { AgentSession, Workspace, WorkspaceStatus } from "./types";
import {
  defaultWorkspaceTitle,
  realpathNormalize,
  workspaceDirStatus,
} from "./paths";

function nowIso(): string {
  return new Date().toISOString();
}

function uid(prefix: string): string {
  return `${prefix}:${Math.random().toString(16).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/** Canonical absolute path (resolves symlinks like dsh-workspace). */
export function canonicalPath(input: string): string {
  const abs = path.resolve(input);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

function rowToWorkspace(r: Record<string, unknown>): Workspace {
  const dir = (r.path as string) ?? "";
  return {
    id: r.id as string,
    // Records written before the rename carry `name`; the title is the same thing.
    title: ((r.title as string) ?? (r.name as string) ?? "").trim(),
    path: dir,
    description: (r.description as string) ?? "",
    owner: (r.owner as string) ?? "",
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    status: ((r.status as string) === "archived" ? "archived" : "active") as WorkspaceStatus,
    dir_status: workspaceDirStatus(dir),
    position: Number(r.position ?? 0),
    created_at: (r.created_at as string) ?? "",
    updated_at: (r.updated_at as string) ?? "",
  };
}

const WORKSPACE_FIELDS =
  "w.id AS id, w.title AS title, w.name AS name, w.path AS path, " +
  "w.description AS description, w.owner AS owner, w.tags AS tags, w.status AS status, " +
  "w.position AS position, w.created_at AS created_at, w.updated_at AS updated_at";

export async function listWorkspaces(
  client: FalkorClient,
  includeArchived = false,
  ownerId?: string,
): Promise<Workspace[]> {
  const conds = [includeArchived ? "" : "w.status <> 'archived'", ownerId ? "w.owner = $owner" : ""].filter(Boolean);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = await client.query(
    `MATCH (w:Workspace) ${where} RETURN ${WORKSPACE_FIELDS} ORDER BY w.position ASC, w.updated_at DESC`,
    ownerId ? { owner: ownerId } : undefined,
  );
  return rows.map(rowToWorkspace);
}

export async function getWorkspace(client: FalkorClient, id: string): Promise<Workspace | null> {
  const rows = await client.query(
    `MATCH (w:Workspace {id: $id}) RETURN ${WORKSPACE_FIELDS} LIMIT 1`,
    { id },
  );
  return rows.length > 0 ? rowToWorkspace(rows[0]) : null;
}

/** The workspace owning a canonical path, if there is one. */
export async function getWorkspaceByPath(client: FalkorClient, dir: string): Promise<Workspace | null> {
  const rows = await client.query<{ id: string }>(
    `MATCH (w:Workspace {path: $path}) RETURN w.id AS id LIMIT 1`,
    { path: canonicalPath(dir) },
  );
  if (rows.length === 0) return null;
  return getWorkspace(client, rows[0].id);
}

/**
 * The registry state.
 *
 * A workspace registration is two writes — the record and its place in the
 * display order — so a crash between them can leave the two out of step. The
 * pending marker is written before the pair and cleared after it, so an
 * interrupted operation is distinguishable from ordinary corruption and can
 * be finished on the next read.
 */
export interface WorkspaceRegistryState {
  /** Whether the registry has been initialised. */
  initialized: boolean;
  /** The first-use workspace identity, kept even after it is deleted. */
  defaultWorkspaceId: string | null;
  /** The operation that was in flight when the last write was interrupted. */
  pending: { operation: "create" | "delete"; workspaceId: string } | null;
}

const REGISTRY_ID = "registry";

const EMPTY_REGISTRY: WorkspaceRegistryState = {
  initialized: false,
  defaultWorkspaceId: null,
  pending: null,
};

export async function readWorkspaceRegistryState(
  client: FalkorClient,
): Promise<WorkspaceRegistryState> {
  const rows = await client.query<{
    initialized?: boolean;
    default_workspace_id?: string;
    pending_operation?: string;
    pending_workspace_id?: string;
  }>(
    "MATCH (s:WorkspaceState {id: $id}) RETURN s.initialized AS initialized, " +
      "s.default_workspace_id AS default_workspace_id, " +
      "s.pending_operation AS pending_operation, s.pending_workspace_id AS pending_workspace_id",
    { id: REGISTRY_ID },
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return { ...EMPTY_REGISTRY };
  const operation = typeof row.pending_operation === "string" ? row.pending_operation : "";
  const workspaceId = typeof row.pending_workspace_id === "string" ? row.pending_workspace_id : "";
  return {
    initialized: row.initialized === true,
    // An empty string is how "no identity yet" is stored.
    defaultWorkspaceId:
      typeof row.default_workspace_id === "string" && row.default_workspace_id.length > 0
        ? row.default_workspace_id
        : null,
    pending:
      (operation === "create" || operation === "delete") && workspaceId
        ? { operation, workspaceId }
        : null,
  };
}

async function writeRegistryState(
  client: FalkorClient,
  patch: Partial<WorkspaceRegistryState>,
): Promise<void> {
  const current = await readWorkspaceRegistryState(client);
  const next = { ...current, ...patch };
  await client.write(
    "MERGE (s:WorkspaceState {id: $id}) SET s.initialized = $initialized, " +
      "s.default_workspace_id = $defaultWorkspaceId, " +
      "s.pending_operation = $pendingOperation, s.pending_workspace_id = $pendingWorkspaceId",
    {
      id: REGISTRY_ID,
      initialized: next.initialized,
      defaultWorkspaceId: next.defaultWorkspaceId ?? "",
      pendingOperation: next.pending?.operation ?? "",
      pendingWorkspaceId: next.pending?.workspaceId ?? "",
    },
  );
}

/**
 * Finish an interrupted registration.
 *
 * A create whose record made it is simply completed; a create whose record did
 * not is rolled back; a delete whose record survived is carried out. Either
 * way the marker is cleared and the registry is consistent again.
 */
export async function recoverWorkspaceRegistry(client: FalkorClient): Promise<WorkspaceRegistryState> {
  const state = await readWorkspaceRegistryState(client);
  if (!state.pending) return state;
  const { operation, workspaceId } = state.pending;
  const record = await getWorkspace(client, workspaceId);
  if (operation === "create" && !record) {
    // The record never landed: drop the half-made order entry.
    await client.write("MATCH (w:Workspace {id: $id}) DETACH DELETE w", { id: workspaceId });
  } else if (operation === "delete" && record) {
    await client.write("MATCH (w:Workspace {id: $id}) DETACH DELETE w", { id: workspaceId });
  }
  await writeRegistryState(client, { pending: null });
  return { ...state, pending: null };
}

/**
 * The shape a workspace record must have when it is written.
 *
 * The registry validates at the durability boundary, so a malformed record
 * never reaches the store and a later reader can trust what it finds.
 */
const WORKSPACE_RECORD_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["id", "title", "path", "status", "position", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    path: { type: "string" },
    description: { type: "string" },
    owner: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    status: { type: "string", enum: ["active", "archived"] },
    position: { type: "number" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
};

/**
 * Create a workspace for an existing directory.
 *
 * The path must be fully qualified and must name a directory that exists. The
 * canonical path is the record's identity, so a symlink to a directory that is
 * already a workspace collides with it and returns that record unchanged. A
 * new record is prepended to the registry order.
 */
export async function createWorkspace(
  client: FalkorClient,
  input: { path: string; title?: string; description?: string; owner?: string; tags?: string[] },
): Promise<Workspace> {
  const dir = realpathNormalize(input.path);
  if (!fs.statSync(dir).isDirectory()) {
    throw new Error(`cannot create a workspace at '${dir}': path is not a directory`);
  }
  const existing = await getWorkspaceByPath(client, dir);
  // A directory that already has a workspace returns it, title untouched.
  if (existing) return existing;

  const lowest = await client.query<{ p: number }>("MATCH (w:Workspace) RETURN min(w.position) AS p");
  const ts = nowIso();
  const id = uid("ws");
  // The marker goes down before the record, so an interrupted write is
  // recoverable rather than a silent gap in the order.
  const record = {
    id,
    title: (input.title ?? "").trim() || defaultWorkspaceTitle(dir),
    path: dir,
    description: input.description ?? "",
    owner: input.owner ?? "",
    tags: input.tags ?? [],
    status: "active" as const,
    // Prepended: the newest workspace sits at the head of the order.
    position: Number(lowest[0]?.p ?? 1) - 1,
    created_at: ts,
    updated_at: ts,
  };
  const invalid = validateSchema(record, WORKSPACE_RECORD_SCHEMA);
  if (invalid) throw new Error(`cannot create a workspace at '${dir}': ${invalid}`);
  await writeRegistryState(client, { pending: { operation: "create", workspaceId: id } });
  await client.write(
    "CREATE (w:Workspace {id: $id, title: $title, path: $path, description: $description, " +
      "owner: $owner, tags: $tags, status: 'active', position: $position, " +
      "created_at: $ts, updated_at: $ts})",
    {
      id: record.id,
      title: record.title,
      path: record.path,
      description: record.description,
      owner: record.owner,
      tags: record.tags,
      position: record.position,
      ts: record.created_at,
    },
  );
  const created = await getWorkspace(client, id);
  if (!created) {
    await writeRegistryState(client, { pending: null });
    throw new Error("Workspace creation failed.");
  }
  const registry = await readWorkspaceRegistryState(client);
  await writeRegistryState(client, {
    initialized: true,
    // The first workspace to exist keeps the first-use identity, even if it
    // is later deleted.
    defaultWorkspaceId: registry.defaultWorkspaceId ?? id,
    pending: null,
  });
  return created;
}

/** Replace the display title. Any string is allowed; titles may duplicate. */
export async function setWorkspaceTitle(client: FalkorClient, id: string, title: string): Promise<Workspace> {
  return updateWorkspace(client, id, { title });
}

/**
 * Move a workspace within the display order, DOM-insertBefore-like: with an
 * anchor it lands before that workspace, without one it appends.
 */
export async function moveWorkspaceBefore(
  client: FalkorClient,
  id: string,
  beforeId?: string,
): Promise<Workspace[]> {
  const all = await listWorkspaces(client, true);
  const from = all.findIndex((w) => w.id === id);
  if (from < 0) throw new Error(`cannot reorder unknown workspace '${id}'`);
  const without = all.filter((w) => w.id !== id);
  const at = beforeId === undefined ? without.length : without.findIndex((w) => w.id === beforeId);
  if (beforeId !== undefined && at < 0) throw new Error(`cannot reorder unknown workspace '${beforeId}'`);
  const moved = all[from];
  const ordered = [...without.slice(0, at), moved, ...without.slice(at)];
  const ts = nowIso();
  for (let i = 0; i < ordered.length; i++) {
    await client.write("MATCH (w:Workspace {id: $id}) SET w.position = $position, w.updated_at = $ts", {
      id: ordered[i].id,
      position: i,
      ts,
    });
  }
  return listWorkspaces(client, true);
}

/**
 * Remove a workspace registration. The directory, its files and every session
 * that ran there are untouched; the sessions simply become ungrouped.
 */
export async function deleteWorkspace(client: FalkorClient, id: string): Promise<boolean> {
  const ws = await getWorkspace(client, id);
  if (!ws) return false;
  // The marker goes down first, so a crash between the record and the order
  // leaves a recoverable trace rather than a registration that half exists.
  await writeRegistryState(client, { pending: { operation: "delete", workspaceId: id } });
  await client.write("MATCH (w:Workspace {id: $id}) DETACH DELETE w", { id });
  await writeRegistryState(client, { pending: null });
  return true;
}

export async function updateWorkspace(
  client: FalkorClient,
  id: string,
  patch: {
    title?: string;
    description?: string;
    owner?: string;
    tags?: string[];
    status?: WorkspaceStatus;
    position?: number;
  },
): Promise<Workspace> {
  const sets: string[] = ["w.updated_at = $ts"];
  const params: Record<string, unknown> = { id, ts: nowIso() };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === "title" && typeof value === "string" && !value.trim()) continue;
    sets.push(`w.${key} = $${key}`);
    params[key] = value;
  }
  await client.write(`MATCH (w:Workspace {id: $id}) SET ${sets.join(", ")}`, params);
  const updated = await getWorkspace(client, id);
  if (!updated) throw new Error(`Unknown workspace '${id}'.`);
  return updated;
}

/** Archive (never delete): folder, files and histories are untouched. */
export async function archiveWorkspace(client: FalkorClient, id: string): Promise<Workspace> {
  return updateWorkspace(client, id, { status: "archived" });
}

// ---------------------------------------------------------------------------
// Agent sessions (dsh session ids grouped by workspace cwd)
// ---------------------------------------------------------------------------

function rowToSession(r: Record<string, unknown>): AgentSession {
  return {
    id: r.id as string,
    workspace_id: (r.workspace_id as string) ?? "",
    goal: (r.goal as string) ?? "",
    status: (r.status as string) === "running" ? "running" : (r.status as string) === "failed" ? "failed" : "ended",
    hidden: Boolean(r.hidden),
    started_at: (r.started_at as string) ?? "",
    ended_at: (r.ended_at as string) ?? undefined,
  };
}

/** Record (or adopt) a dsh session under a workspace. Idempotent on id. */
export async function recordSession(
  client: FalkorClient,
  workspaceId: string,
  sessionId: string,
  goal = "",
): Promise<AgentSession> {
  const ts = nowIso();
  await client.write(
    "MERGE (s:AgentSession {id: $sid}) " +
      "ON CREATE SET s.workspace_id = $wid, s.goal = $goal, s.status = 'running', " +
      "s.hidden = false, s.started_at = $ts " +
      "WITH s MATCH (w:Workspace {id: $wid}) MERGE (s)-[:IN_WORKSPACE]->(w)",
    { sid: sessionId, wid: workspaceId, goal, ts },
  );
  const rows = await client.query(
    "MATCH (s:AgentSession {id: $sid}) RETURN s.id AS id, s.workspace_id AS workspace_id, " +
      "s.goal AS goal, s.status AS status, s.hidden AS hidden, s.started_at AS started_at, " +
      "s.ended_at AS ended_at LIMIT 1",
    { sid: sessionId },
  );
  return rowToSession(rows[0]);
}

export async function endSession(
  client: FalkorClient,
  sessionId: string,
  status: "ended" | "failed" = "ended",
): Promise<void> {
  await client.write("MATCH (s:AgentSession {id: $sid}) SET s.status = $status, s.ended_at = $ts", {
    sid: sessionId,
    status,
    ts: nowIso(),
  });
}

export async function setSessionHidden(client: FalkorClient, sessionId: string, hidden: boolean): Promise<void> {
  await client.write("MATCH (s:AgentSession {id: $sid}) SET s.hidden = $hidden", {
    sid: sessionId,
    hidden,
  });
}

export async function listSessions(
  client: FalkorClient,
  workspaceId: string,
  includeHidden = false,
): Promise<AgentSession[]> {
  const extra = includeHidden ? "" : "AND s.hidden = false";
  const rows = await client.query(
    `MATCH (s:AgentSession) WHERE s.workspace_id = $wid ${extra} ` +
      "RETURN s.id AS id, s.workspace_id AS workspace_id, s.goal AS goal, s.status AS status, " +
      "s.hidden AS hidden, s.started_at AS started_at, s.ended_at AS ended_at " +
      "ORDER BY s.started_at DESC",
    { wid: workspaceId },
  );
  return rows.map(rowToSession);
}

/** Sessions whose workspace no longer exists (moved/deleted dirs stay queryable). */
export async function listUngroupedSessions(client: FalkorClient): Promise<AgentSession[]> {
  const rows = await client.query(
    "MATCH (s:AgentSession) WHERE NOT (s)-[:IN_WORKSPACE]->(:Workspace) " +
      "RETURN s.id AS id, s.workspace_id AS workspace_id, s.goal AS goal, s.status AS status, " +
      "s.hidden AS hidden, s.started_at AS started_at, s.ended_at AS ended_at " +
      "ORDER BY s.started_at DESC LIMIT 100",
  );
  return rows.map(rowToSession);
}
