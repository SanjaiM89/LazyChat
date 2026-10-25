/**
 * DeepSeek Harness bridge — shared types.
 *
 * LazyChat keeps its chat UI untouched. Everything the harness needs
 * (workspaces, agent runs, durable memory) lives here and in sibling
 * modules, persisted in the same FalkorDB the Company Brain uses.
 */

export type WorkspaceStatus = "active" | "archived";

export interface Workspace {
  id: string;
  /** Display title. Defaults to the final path segment; duplicates are allowed. */
  title: string;
  /** Canonical absolute directory backing the workspace (the session cwd). */
  path: string;
  description?: string;
  owner?: string;
  tags?: string[];
  status: WorkspaceStatus;
  /** Live check of the backing directory. Never persisted. */
  dir_status: "ok" | "missing-dir";
  /** Ordering key for the sidebar (stable, user-controlled). */
  position: number;
  created_at: string;
  updated_at: string;
}

export interface AgentSession {
  /** dsh session id (opaque string, used verbatim). */
  id: string;
  workspace_id: string;
  goal?: string;
  status: "running" | "ended" | "failed";
  hidden?: boolean;
  started_at: string;
  ended_at?: string;
}

export interface AgentRun {
  id: string;
  workspace_id: string;
  session_id: string;
  task: string;
  status: "queued" | "running" | "done" | "failed" | "stopped";
  /** dsh process pid while running. */
  pid?: number;
  exit_code?: number;
  started_at: string;
  ended_at?: string;
}

export type MemoryScope = "global" | string; // "global" or `workspace:<id>`

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  /** user_profile | preference | pattern | fix | relation | reference | note | summary */
  kind: string;
  text: string;
  /** Single-value slots (e.g. `user.name`) replace on conflict. */
  slot?: string | null;
  tags?: string[];
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface TodoItem {
  id: string;
  workspace_id: string;
  text: string;
  status: "open" | "doing" | "done";
  sort: number;
  created_at: string;
  updated_at: string;
}

export interface CommandRun {
  id: string;
  workspace_id: string;
  session_id?: string;
  run_id?: string;
  command: string;
  exit_code?: number;
  /** Truncated output (head/tail kept, middle cut). */
  output?: string;
  started_at: string;
  duration_ms?: number;
}
