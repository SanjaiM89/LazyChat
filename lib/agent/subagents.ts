import { nanoid } from "nanoid";

import { createChatRun, stopChatRun } from "@/lib/chat-runs";
import { appendEvent } from "@/lib/agent/session";
import type { PermissionSettings } from "@/lib/agent/permissions";
import type { ChatSettings } from "@/lib/types";

/**
 * Subagents.
 *
 * A subagent is a second agent that works on one task and reports back. It
 * runs in this process with the same tools as its parent — minus the tools
 * that would let it spawn another one — and its own model if the caller asks
 * for a different one.
 *
 * A subagent has an inbox: a message sent to a running subagent is delivered
 * when it next starts a turn, not in the middle of the current one.
 */

export type SubagentStatus = "running" | "done" | "failed" | "interrupted";

export interface Subagent {
  id: string;
  task: string;
  /** The teammate's name, when it has one. */
  name?: string;
  status: SubagentStatus;
  /** The conversation the parent belongs to; the events are logged there. */
  conversationId: string;
  parentRunId?: string;
  /** The run that is doing the work right now. */
  runId?: string;
  /** The answer the subagent produced. */
  result?: string;
  error?: string;
  /** Messages waiting for the subagent's next turn. */
  inbox: string[];
  startedAt: number;
  endedAt?: number;
}

const subagents = new Map<string, Subagent>();
const MAX_SUBAGENTS = 50;

export interface SpawnSubagentInput {
  task: string;
  /** The conversation the parent belongs to. */
  conversationId: string;
  parentRunId?: string;
  settings: ChatSettings;
  permissions: PermissionSettings;
  /** The model the subagent should use; the parent's when omitted. */
  model?: string;
  provider?: string;
  /** The folder the subagent works in. */
  workspaceId?: string;
  /** The tools the subagent may not use. */
  excludeTools?: string[];
  /** How long the subagent may run. */
  timeoutMs?: number;
  /** A name, when the subagent is a named teammate. */
  name?: string;
  /**
   * Earlier turns the subagent starts with. A fresh agent gets none; a forked
   * one inherits the lead's completed turns.
   */
  context?: Array<{ role: "user" | "assistant"; text: string }>;
}

/**
 * Start a subagent on a task.
 *
 * The caller does not wait: the subagent works in the background and the
 * model asks for its result when it wants it.
 */
export function spawnSubagent(input: SpawnSubagentInput): Subagent {
  reapSubagents();
  const id = `sub-${nanoid(8)}`;
  const agent: Subagent = {
    id,
    task: input.task,
    name: input.name,
    status: "running",
    conversationId: input.conversationId,
    parentRunId: input.parentRunId,
    inbox: [],
    startedAt: Date.now(),
  };
  subagents.set(id, agent);

  appendEvent(
    "subagent/started",
    { subagent: id, task: input.task, name: input.name ?? null },
    { conversationId: input.conversationId, runId: input.parentRunId },
  );

  void runTurn(agent, input, input.task);
  return agent;
}

/** Run one turn of a subagent, and keep going while its inbox has mail. */
async function runTurn(
  agent: Subagent,
  input: SpawnSubagentInput,
  message: string,
): Promise<void> {
  try {
    // A forked agent starts with the turns it inherited; a fresh one does not.
    const inherited = (input.context ?? []).map((turn, index) => ({
      role: turn.role,
      id: nanoid(8),
      parts: [{ type: "text" as const, text: turn.text }],
    }));
    const run = await createChatRun({
      messages: [
        ...inherited,
        { role: "user", id: nanoid(8), parts: [{ type: "text", text: message }] },
      ],
      settings: {
        ...input.settings,
        ...(input.provider ? { provider: input.provider as ChatSettings["provider"] } : {}),
        ...(input.model ? { model: input.model } : {}),
      },
      permissions: input.permissions,
      excludeTools: input.excludeTools,
      workspaceId: input.workspaceId,
      // A subagent has no conversation of its own: it never appears in the
      // sidebar, and its turns are logged under the parent.
    });
    agent.runId = run.id;
    await run.done;
    agent.result = run.answerText || run.error || "";
    agent.error = run.error;
    agent.status = run.error ? "failed" : "done";
  } catch (e) {
    agent.status = "failed";
    agent.error = (e as Error).message || "The subagent failed.";
  } finally {
    agent.runId = undefined;
    agent.endedAt = Date.now();
    appendEvent(
      "subagent/finished",
      { subagent: agent.id, status: agent.status, result: (agent.result ?? "").slice(0, 4000) },
      { conversationId: agent.conversationId, runId: agent.parentRunId },
    );
  }

  // Anything that arrived while the turn was running gets the next one.
  const next = agent.inbox.shift();
  if (next && (agent.status as SubagentStatus) !== "interrupted") {
    await runTurn(agent, input, next);
  }
}

export function getSubagent(id: string): Subagent | undefined {
  return subagents.get(id);
}

export function listSubagents(conversationId?: string): Subagent[] {
  return [...subagents.values()]
    .filter((agent) => !conversationId || agent.conversationId === conversationId)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Send a message to a subagent.
 *
 * A running subagent receives it in its next turn; an idle one starts a new
 * turn with it.
 */
export function sendToSubagent(
  id: string,
  message: string,
  input?: SpawnSubagentInput,
): { delivered: boolean; queued: boolean; error?: string } {
  const agent = subagents.get(id);
  if (!agent) return { delivered: false, queued: false, error: `There is no subagent called "${id}".` };
  if (agent.status === "interrupted") {
    return { delivered: false, queued: false, error: "That subagent was interrupted." };
  }
  agent.inbox.push(message);
  if (agent.status === "done" || agent.status === "failed") {
    // Idle: wake it with the message.
    agent.status = "running";
    agent.endedAt = undefined;
    if (input) void runTurn(agent, input, message);
    return { delivered: true, queued: false };
  }
  return { delivered: true, queued: true };
}

/**
 * Run a subagent and wait for its answer.
 *
 * The background `subagent` tool does not wait; a workflow's `agent()` hook
 * does, because the script arranges the work itself.
 */
export async function runSubagentToCompletion(
  input: SpawnSubagentInput,
): Promise<{ text: string; error?: string }> {
  const agent = spawnSubagent(input);
  const deadline = Date.now() + (input.timeoutMs ?? 15 * 60 * 1000);
  while (Date.now() < deadline) {
    const current = getSubagent(agent.id);
    if (!current) return { text: "", error: "The subagent went away." };
    if (current.status === "done") return { text: current.result ?? "" };
    if (current.status === "failed") {
      return { text: current.result ?? "", error: current.error ?? "The subagent failed." };
    }
    if (current.status === "interrupted") {
      return { text: current.result ?? "", error: "The subagent was interrupted." };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { text: agent.result ?? "", error: "The subagent did not finish in time." };
}

/** Stop a subagent and the run it is in. */
export function interruptSubagent(id: string): boolean {
  const agent = subagents.get(id);
  if (!agent) return false;
  if (agent.runId) stopChatRun(agent.runId);
  agent.status = "interrupted";
  agent.endedAt = Date.now();
  agent.inbox.length = 0;
  appendEvent(
    "subagent/finished",
    { subagent: id, status: "interrupted" },
    { conversationId: agent.conversationId, runId: agent.parentRunId },
  );
  return true;
}

/** Drop the finished subagents nobody is looking at any more. */
export function reapSubagents(maxAgeMs = 60 * 60 * 1000): number {
  const now = Date.now();
  let removed = 0;
  for (const agent of [...subagents.values()]) {
    if (agent.status === "running") continue;
    if (now - (agent.endedAt ?? agent.startedAt) < maxAgeMs) continue;
    subagents.delete(agent.id);
    removed++;
  }
  if (subagents.size > MAX_SUBAGENTS) {
    const oldest = [...subagents.values()]
      .filter((a) => a.status !== "running")
      .sort((a, b) => a.startedAt - b.startedAt)[0];
    if (oldest) {
      subagents.delete(oldest.id);
      removed++;
    }
  }
  return removed;
}
