import { nanoid } from "nanoid";

import { getDb } from "@/lib/sqlite";
import { appendEvent } from "@/lib/agent/session";
import {
  getSubagent,
  interruptSubagent,
  listSubagents,
  sendToSubagent,
  spawnSubagent,
  type SpawnSubagentInput,
} from "@/lib/agent/subagents";

/**
 * The team.
 *
 * A team is the lead plus named teammates that share a task board. A teammate
 * is a subagent with a name; the board is what the teammates coordinate
 * through.
 *
 * The board is durable (SQLite) and every change bumps a revision, so two
 * agents cannot silently overwrite each other's work: an update carries the
 * revision it was based on and is refused when it is stale.
 */

export type TeamMemberStatus = "running" | "inactive" | "provisioning" | "failed";
export type TeamTaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export interface TeamMember {
  name: string;
  description: string;
  role: "lead" | "teammate";
  status: TeamMemberStatus;
  /** The subagent that does the work. */
  subagentId?: string;
  revision: number;
  createdAt: number;
}

export interface TeamTask {
  id: string;
  subject: string;
  description: string;
  status: TeamTaskStatus;
  ownerName?: string;
  blockedBy: string[];
  writeScopes: string[];
  revision: number;
  createdAt: number;
  updatedAt: number;
}

/** What a member says when nobody is working. */
export const NO_ACTIVE_PEER_MESSAGE =
  "No other Team member is running or provisioning. wait_agent cannot make progress or wake " +
  "inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake " +
  "each required inactive teammate before waiting again.";

const members = new Map<string, TeamMember>();
const memberSubagents = new Map<string, string>();

/** The lead is the conversation the team belongs to. */
function leadKey(conversationId: string): string {
  return `lead:${conversationId}`;
}

function ensureDb(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_tasks (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_name TEXT,
      blocked_by TEXT NOT NULL DEFAULT '[]',
      write_scopes TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_team_tasks_status ON team_tasks(status);
  `);
}

function rowToTask(row: any): TeamTask {
  const parse = (value: unknown): string[] => {
    try {
      const parsed = JSON.parse(String(value ?? "[]"));
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };
  return {
    id: String(row.id),
    subject: String(row.subject),
    description: String(row.description),
    status: String(row.status) as TeamTaskStatus,
    ownerName: row.owner_name ? String(row.owner_name) : undefined,
    blockedBy: parse(row.blocked_by),
    writeScopes: parse(row.write_scopes),
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/** The members of a team: the lead plus its teammates. */
export function listMembers(conversationId: string): TeamMember[] {
  const out: TeamMember[] = [];
  const lead = members.get(leadKey(conversationId));
  if (lead) out.push(lead);
  for (const member of members.values()) {
    if (member.role !== "teammate") continue;
    if (memberSubagents.get(member.name) === undefined) continue;
    const subagentId = memberSubagents.get(member.name);
    const sub = subagentId ? getSubagent(subagentId) : undefined;
    out.push({
      ...member,
      status: memberStatus(member, sub?.status),
    });
  }
  return out;
}

function memberStatus(member: TeamMember, subagentStatus?: string): TeamMemberStatus {
  if (member.status === "failed" || member.status === "provisioning") return member.status;
  if (subagentStatus === "running") return "running";
  if (subagentStatus === "failed") return "failed";
  return "inactive";
}

/** The member with this name, if the team has one. */
export function getMember(name: string): TeamMember | undefined {
  for (const member of members.values()) {
    if (member.name === name) return member;
  }
  return undefined;
}

/** Register the lead of a conversation, so the team has an addressable head. */
export function ensureLead(conversationId: string): TeamMember {
  const key = leadKey(conversationId);
  const existing = members.get(key);
  if (existing) return existing;
  const lead: TeamMember = {
    name: "lead",
    description: "The agent that coordinates the team.",
    role: "lead",
    status: "running",
    revision: 1,
    createdAt: Date.now(),
  };
  members.set(key, lead);
  return lead;
}

/**
 * Spawn a named teammate.
 *
 * The teammate works on the prompt in the background; the lead asks for its
 * result later. `context: "fork"` hands it the lead's completed turns.
 */
export function spawnTeammate(
  input: SpawnSubagentInput & { name: string; description: string },
): TeamMember {
  const existing = getMember(input.name);
  if (existing && existing.role === "teammate") {
    throw new Error(`There is already a teammate called "${input.name}".`);
  }
  const member: TeamMember = {
    name: input.name,
    description: input.description,
    role: "teammate",
    status: "provisioning",
    revision: 1,
    createdAt: Date.now(),
  };
  members.set(input.name, member);
  appendEvent(
    "team/member",
    { member: input.name, action: "spawned", description: input.description },
    { conversationId: input.conversationId, runId: input.parentRunId },
  );

  const subagent = spawnSubagent({ ...input, name: input.name });
  memberSubagents.set(input.name, subagent.id);
  member.subagentId = subagent.id;
  member.status = "running";
  return member;
}

/**
 * Send a message to a member.
 *
 * A running member receives it at its next step; an inactive one starts a
 * turn with it.
 */
export function sendToMember(
  name: string,
  message: string,
  input?: SpawnSubagentInput,
): { delivered: boolean; queued: boolean; error?: string } {
  const member = getMember(name);
  if (!member) return { delivered: false, queued: false, error: `There is no member called "${name}".` };
  const subagentId = memberSubagents.get(name);
  if (!subagentId) {
    // The lead has no subagent of its own: its message is the task it is given.
    return { delivered: false, queued: false, error: "The lead cannot receive messages." };
  }
  const result = sendToSubagent(subagentId, message, input);
  if (result.error) return result;
  appendEvent(
    "team/member",
    { member: name, action: "messaged", queued: result.queued },
    { conversationId: input?.conversationId ?? "", runId: input?.parentRunId },
  );
  return result;
}

/** Stop a teammate and the work it is doing. */
export function interruptMember(name: string): boolean {
  const member = getMember(name);
  if (!member || member.role !== "teammate") return false;
  const subagentId = memberSubagents.get(name);
  if (!subagentId) return false;
  const ok = interruptSubagent(subagentId);
  member.status = "inactive";
  return ok;
}

// ---------------------------------------------------------------------------
// The task board
// ---------------------------------------------------------------------------

/** Create a task on the board. */
export function createTask(input: {
  conversationId: string;
  subject: string;
  description: string;
  blockedBy?: string[];
  writeScopes?: string[];
  runId?: string;
}): TeamTask {
  ensureDb();
  const db = getDb();
  const id = `task-${nanoid(8)}`;
  const now = Date.now();
  db.prepare(
    "INSERT INTO team_tasks (id, subject, description, status, owner_name, blocked_by, write_scopes, revision, created_at, updated_at) " +
      "VALUES (?, ?, ?, 'pending', NULL, ?, ?, 1, ?, ?)",
  ).run(
    id,
    input.subject,
    input.description,
    JSON.stringify(input.blockedBy ?? []),
    JSON.stringify(input.writeScopes ?? []),
    now,
    now,
  );
  const task = getTask(id)!;
  appendEvent(
    "team/task",
    { task: id, action: "created", subject: task.subject },
    { conversationId: input.conversationId, runId: input.runId },
  );
  return task;
}

export function getTask(id: string): TeamTask | undefined {
  ensureDb();
  const row = getDb().prepare("SELECT * FROM team_tasks WHERE id = ?").get(id);
  return row ? rowToTask(row) : undefined;
}

export function listTasks(filter: {
  status?: TeamTaskStatus;
  owner?: string;
  ready?: boolean;
  limit?: number;
  offset?: number;
} = {}): TeamTask[] {
  ensureDb();
  const rows = getDb()
    .prepare("SELECT * FROM team_tasks WHERE status != 'deleted' ORDER BY created_at ASC")
    .all() as any[];
  let tasks = rows.map(rowToTask);
  if (filter.status) tasks = tasks.filter((task) => task.status === filter.status);
  if (filter.owner) {
    tasks = tasks.filter((task) =>
      filter.owner === "unowned" ? !task.ownerName : task.ownerName === filter.owner,
    );
  }
  if (filter.ready !== undefined) {
    tasks = tasks.filter((task) => isTaskReady(task) === filter.ready);
  }
  const offset = filter.offset ?? 0;
  const limit = Math.min(filter.limit ?? 50, 100);
  return tasks.slice(offset, offset + limit);
}

/** A task is ready when it is unowned, pending, and nothing blocks it. */
export function isTaskReady(task: TeamTask): boolean {
  if (task.status !== "pending" || task.ownerName) return false;
  return task.blockedBy.every((id) => {
    const blocker = getTask(id);
    return !blocker || blocker.status === "completed";
  });
}

export type TeamTaskAction =
  | "claim"
  | "release"
  | "edit"
  | "set_dependencies"
  | "complete"
  | "reopen"
  | "reassign"
  | "delete";

/**
 * Change a task, compare-and-set on its revision.
 *
 * A stale revision is refused: the caller has to read the task again, because
 * somebody else changed it in between.
 */
export function updateTask(input: {
  conversationId: string;
  taskId: string;
  expectedRevision: number;
  action: TeamTaskAction;
  subject?: string;
  description?: string;
  blockedBy?: string[];
  writeScopes?: string[];
  owner?: string;
  runId?: string;
}): { ok: true; task: TeamTask } | { ok: false; error: string; current?: TeamTask } {
  ensureDb();
  const task = getTask(input.taskId);
  if (!task) return { ok: false, error: `There is no task called "${input.taskId}".` };
  if (task.revision !== input.expectedRevision) {
    return {
      ok: false,
      error: `That task moved on: it is at revision ${task.revision}, not ${input.expectedRevision}. Read it again.`,
      current: task,
    };
  }

  const next: TeamTask = { ...task, revision: task.revision + 1, updatedAt: Date.now() };
  switch (input.action) {
    case "claim":
      if (task.ownerName && task.ownerName !== input.owner) {
        return { ok: false, error: `"${task.ownerName}" already owns that task.`, current: task };
      }
      next.ownerName = input.owner;
      next.status = "in_progress";
      break;
    case "release":
      next.ownerName = undefined;
      next.status = "pending";
      break;
    case "edit":
      if (input.subject !== undefined) next.subject = input.subject;
      if (input.description !== undefined) next.description = input.description;
      if (input.writeScopes !== undefined) next.writeScopes = input.writeScopes;
      break;
    case "set_dependencies":
      next.blockedBy = input.blockedBy ?? [];
      break;
    case "complete":
      next.status = "completed";
      break;
    case "reopen":
      next.status = "in_progress";
      break;
    case "reassign":
      next.ownerName = input.owner;
      break;
    case "delete":
      next.status = "deleted";
      break;
  }

  getDb()
    .prepare(
      "UPDATE team_tasks SET subject = ?, description = ?, status = ?, owner_name = ?, blocked_by = ?, write_scopes = ?, revision = ?, updated_at = ? WHERE id = ?",
    )
    .run(
      next.subject,
      next.description,
      next.status,
      next.ownerName ?? null,
      JSON.stringify(next.blockedBy),
      JSON.stringify(next.writeScopes),
      next.revision,
      next.updatedAt,
      next.id,
    );

  appendEvent(
    "team/task",
    { task: next.id, action: input.action, subject: next.subject, revision: next.revision },
    { conversationId: input.conversationId, runId: input.runId },
  );
  return { ok: true, task: next };
}

/** How many teammates are working right now. */
export function activeMemberCount(conversationId: string): number {
  return listMembers(conversationId).filter(
    (member) => member.status === "running" || member.status === "provisioning",
  ).length;
}

/**
 * Wait for the next change among the teammates.
 *
 * Waiting never wakes an idle teammate: when nobody is working the answer is
 * immediate, because nothing is going to happen.
 */
export async function waitForTeam(
  conversationId: string,
  timeoutMs: number,
): Promise<{ progress: boolean; reason?: string; members?: TeamMember[]; tasks?: TeamTask[] }> {
  const snapshot = () =>
    JSON.stringify({
      members: listMembers(conversationId).map((member) => [member.name, member.status]),
      tasks: listTasks().map((task) => [task.id, task.revision, task.status]),
    });

  if (activeMemberCount(conversationId) === 0) {
    return { progress: false, reason: NO_ACTIVE_PEER_MESSAGE };
  }

  const before = snapshot();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const now = snapshot();
    if (now !== before) {
      return {
        progress: true,
        members: listMembers(conversationId),
        tasks: listTasks(),
      };
    }
  }
  return {
    progress: false,
    reason: "Nothing changed before the timeout. Re-list the members and the board.",
    members: listMembers(conversationId),
    tasks: listTasks(),
  };
}

/** Forget the finished teammates of a conversation. */
export function reapMembers(maxAgeMs = 60 * 60 * 1000): number {
  const now = Date.now();
  let removed = 0;
  for (const member of [...members.values()]) {
    if (member.role !== "teammate") continue;
    if (now - member.createdAt < maxAgeMs) continue;
    const subagentId = memberSubagents.get(member.name);
    const sub = subagentId ? getSubagent(subagentId) : undefined;
    if (sub && sub.status === "running") continue;
    members.delete(member.name);
    memberSubagents.delete(member.name);
    removed++;
  }
  return removed;
}
