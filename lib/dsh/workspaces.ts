
/**
 * Workspace registry on FalkorDB (mirrors dsh-workspace semantics).
 *
 * One record per canonical path. Sessions join the workspace whose directory
 * they run in (SessionHeader.cwd). Removing a workspace never touches the
 * directory, files, or session histories — they simply become ungrouped.
 */
import fs from "node:fs";
import path from "node:path";

import { FalkorClient } from "@/lib/brain/graph";
import type { AgentSession, Workspace, WorkspaceStatus } from "./types";

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
  return {
    id: r.id as string,
    name: (r.name as string) ?? "",
    path: (r.path as string) ?? "",
    description: (r.description as string) ?? "",
    owner: (r.owner as string) ?? "",
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    status: ((r.status as string) === "archived" ? "archived" : "active") as WorkspaceStatus,
    position: Number(r.position ?? 0),
    created_at: (r.created_at as string) ?? "",
    updated_at: (r.updated_at as string) ?? "",
  };
}

export async function listWorkspaces(client: FalkorClient, includeArchived = false): Promise<Workspace[]> {
  const where = includeArchived ? "" : "WHERE w.status <> 'archived'";
  const rows = await client.query(
    `MATCH (w:Workspace) ${where} RETURN w.id AS id, w.name AS name, w.path AS path, ` +
      `w.description AS description, w.owner AS owner, w.tags AS tags, w.status AS status, ` +
      `w.position AS position, w.created_at AS created_at, w.updated_at AS updated_at ` +
      `ORDER BY w.position ASC, w.updated_at DESC`,
  );
  return rows.map(rowToWorkspace);
}

export async function getWorkspace(client: FalkorClient, id: string): Promise<Workspace | null> {
  const rows = await client.query(
    `MATCH (w:Workspace {id: $id}) RETURN w.id AS id, w.name AS name, w.path AS path, ` +
      `w.description AS description, w.owner AS owner, w.tags AS tags, w.status AS status, ` +
      `w.position AS position, w.created_at AS created_at, w.updated_at AS updated_at LIMIT 1`,
    { id },
  );
  return rows.length > 0 ? rowToWorkspace(rows[0]) : null;
}

export async function getWorkspaceByPath(client: FalkorClient, dir: string): Promise<Workspace | null> {
  const rows = await client.query<{ id: string }>(
    `MATCH (w:Workspace {path: $path}) RETURN w.id AS id LIMIT 1`,
    { path: canonicalPath(dir) },
  );
  if (rows.length === 0) return null;
  return getWorkspace(client, rows[0].id);
}

export async function createWorkspace(
  client: FalkorClient,
  input: { name: string; path: string; description?: string; owner?: string; tags?: string[] },
): Promise<Workspace> {
  const dir = canonicalPath(input.path);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`Workspace path does not exist or is not a directory: ${input.path}`);
  }
  const existing = await getWorkspaceByPath(client, dir);
  // Creating a project for a directory that already has one returns it unchanged.
  if (existing) return existing;

  const count = await client.query<{ n: number }>("MATCH (w:Workspace) RETURN count(w) AS n");
  const ts = nowIso();
  const id = uid("ws");
  await client.write(
    "CREATE (w:Workspace {id: $id, name: $name, path: $path, description: $description, " +
      "owner: $owner, tags: $tags, status: 'active', position: $position, " +
      "created_at: $ts, updated_at: $ts})",
    {
      id,
      name: input.name.trim() || path.basename(dir),
      path: dir,
      description: input.description ?? "",
      owner: input.owner ?? "",
      tags: input.tags ?? [],
      position: Number(count[0]?.n ?? 0),
      ts,
    },
  );
  const created = await getWorkspace(client, id);
  if (!created) throw new Error("Workspace creation failed.");
  return created;
}

export async function updateWorkspace(
  client: FalkorClient,
  id: string,
  patch: { name?: string; description?: string; owner?: string; tags?: string[]; status?: WorkspaceStatus; position?: number },
): Promise<Workspace> {
  const sets: string[] = ["w.updated_at = $ts"];
  const params: Record<string, unknown> = { id, ts: nowIso() };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === "name" && typeof value === "string" && !value.trim()) continue;
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
