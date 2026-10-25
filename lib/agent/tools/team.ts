import { tool } from "ai";
import { z } from "zod";

import {
  createTask,
  ensureLead,
  getMember,
  getTask,
  interruptMember,
  listMembers,
  listTasks,
  sendToMember,
  spawnTeammate,
  updateTask,
  waitForTeam,
} from "@/lib/agent/teams";
import type { SpawnSubagentInput } from "@/lib/agent/subagents";
import type { PermissionSettings } from "@/lib/agent/permissions";
import type { ChatSettings } from "@/lib/types";

/**
 * The team tools.
 *
 * A teammate is a named subagent; the board is what the team coordinates
 * through. The tool names carry a `team_` prefix so they never sit next to
 * the plain subagent tools and get mixed up.
 */
export function buildTeamTools(ctx: {
  conversationId: string;
  parentRunId?: string;
  settings: ChatSettings;
  permissions: PermissionSettings;
  workspaceId?: string;
}) {
  const spawnInput = (task: string): SpawnSubagentInput => ({
    task,
    conversationId: ctx.conversationId,
    parentRunId: ctx.parentRunId,
    settings: ctx.settings,
    permissions: ctx.permissions,
    workspaceId: ctx.workspaceId,
    // A teammate may not spawn another teammate.
    excludeTools: [
      "subagent",
      "subagent_send_message",
      "subagent_interrupt",
      "code_run",
      "team_spawn_teammate",
    ],
  });

  return {
    team_spawn_teammate: tool({
      description:
        "Create one named teammate. The teammate works on the prompt in the background and the team can message " +
        "it later. Use it when the work splits into parts that are independent of each other.",
      inputSchema: z.object({
        name: z.string().describe("A unique name for the teammate, e.g. 'auditor'"),
        description: z.string().describe("What this teammate is responsible for"),
        prompt: z.string().describe("The complete task for the teammate"),
        context: z
          .enum(["fresh", "fork"])
          .optional()
          .describe("fresh starts with no history; fork inherits your completed turns."),
      }),
      execute: async ({ name, description, prompt, context }) => {
        try {
          const input = spawnInput(prompt);
          if (context === "fork") {
            const lead = ensureLead(ctx.conversationId);
            input.context = await leadTurns(ctx.conversationId);
            void lead;
          }
          const member = spawnTeammate({ ...input, name, description });
          return {
            member: member.name,
            status: member.status,
            description: member.description,
            note: "It works in the background. Message it, or list the team, to hear back.",
          };
        } catch (e) {
          return { error: (e as Error).message || "The teammate could not be created." };
        }
      },
    }),

    team_send_message: tool({
      description:
        "Send a message to a teammate. A running teammate reads it at its next step; an idle one wakes up with it.",
      inputSchema: z.object({
        target: z.string().describe("The member's name"),
        message: z.string().describe("A self-contained message for the teammate"),
      }),
      execute: async ({ target, message }) => {
        const result = sendToMember(target, message, spawnInput(message));
        if (result.error) return { error: result.error };
        return { target, delivered: true, queued: result.queued };
      },
    }),

    team_list_agents: tool({
      description:
        "List the team: the lead and every teammate, with what each is responsible for and whether it is " +
        "working right now.",
      inputSchema: z.object({}),
      execute: async () => {
        const members = listMembers(ctx.conversationId);
        return {
          count: members.length,
          members: members.map((member) => ({
            name: member.name,
            role: member.role,
            status: member.status,
            description: member.description,
            revision: member.revision,
          })),
        };
      },
    }),

    team_wait_agent: tool({
      description:
        "Wait for the next change among the teammates: a status, a message or a task change. This never wakes an " +
        "idle teammate — when nobody is working the answer is immediate.",
      inputSchema: z.object({
        timeout_ms: z
          .number()
          .int()
          .min(1000)
          .max(600_000)
          .optional()
          .describe("How long to wait (default 30000)."),
      }),
      execute: async ({ timeout_ms }) => {
        const result = await waitForTeam(ctx.conversationId, timeout_ms ?? 30_000);
        return {
          progress: result.progress,
          reason: result.reason ?? null,
          members: (result.members ?? []).map((member) => ({
            name: member.name,
            status: member.status,
            description: member.description,
          })),
          tasks: (result.tasks ?? []).map((task) => ({
            id: task.id,
            subject: task.subject,
            status: task.status,
            owner: task.ownerName ?? null,
            ready: task.status === "pending" && !task.ownerName,
          })),
        };
      },
    }),

    team_interrupt_agent: tool({
      description: "Stop a teammate and the work it is doing.",
      inputSchema: z.object({
        target: z.string().describe("The member's name"),
      }),
      execute: async ({ target }) => {
        const ok = interruptMember(target);
        return ok ? { target, interrupted: true } : { error: `There is no teammate called "${target}".` };
      },
    }),

    team_task_create: tool({
      description: "Create one unowned task on the shared board.",
      inputSchema: z.object({
        subject: z.string().describe("A concise title"),
        description: z.string().describe("The details and what done means"),
        blocked_by: z.array(z.string()).optional().describe("Task ids that must finish first"),
        write_scopes: z
          .array(z.string())
          .optional()
          .describe("Advisory folders this task expects to change"),
      }),
      execute: async ({ subject, description, blocked_by, write_scopes }) => {
        const task = createTask({
          conversationId: ctx.conversationId,
          subject,
          description,
          blockedBy: blocked_by,
          writeScopes: write_scopes,
          runId: ctx.parentRunId,
        });
        return taskView(task);
      },
    }),

    team_task_list: tool({
      description:
        "List the tasks on the board, with who owns each, what blocks it and whether it is ready to start.",
      inputSchema: z.object({
        status: z.enum(["pending", "in_progress", "completed"]).optional(),
        owner: z.string().optional().describe("A member name, or 'unowned'"),
        ready: z.boolean().optional().describe("Only the tasks that are (or are not) ready"),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async ({ status, owner, ready, limit }) => {
        const tasks = listTasks({ status, owner, ready, limit });
        return { count: tasks.length, tasks: tasks.map(taskView) };
      },
    }),

    team_task_get: tool({
      description: "Read one task before changing or working on it.",
      inputSchema: z.object({
        task_id: z.string().describe("The task id"),
      }),
      execute: async ({ task_id }) => {
        const task = getTask(task_id);
        if (!task) return { error: `There is no task called "${task_id}".` };
        return taskView(task);
      },
    }),

    team_task_update: tool({
      description:
        "Change a task. The revision must be the one you last read: if somebody else changed the task in " +
        "between, the update is refused and you get the current state.",
      inputSchema: z.object({
        task_id: z.string().describe("The task id"),
        expected_revision: z.number().int().describe("The revision you last read"),
        action: z
          .enum(["claim", "release", "edit", "set_dependencies", "complete", "reopen", "reassign", "delete"])
          .describe("The change to make"),
        subject: z.string().optional().describe("A new title, for edit"),
        description: z.string().optional().describe("New details, for edit"),
        blocked_by: z.array(z.string()).optional().describe("The blockers, for set_dependencies"),
        write_scopes: z.array(z.string()).optional().describe("The write scopes, for edit"),
        owner: z.string().optional().describe("The new owner, for reassign"),
      }),
      execute: async (args) => {
        const result = updateTask({
          conversationId: ctx.conversationId,
          taskId: args.task_id,
          expectedRevision: args.expected_revision,
          action: args.action,
          subject: args.subject,
          description: args.description,
          blockedBy: args.blocked_by,
          writeScopes: args.write_scopes,
          owner: args.owner,
          runId: ctx.parentRunId,
        });
        if (!result.ok) {
          return {
            error: result.error,
            current: result.current ? taskView(result.current) : null,
          };
        }
        return taskView(result.task);
      },
    }),
  };
}

/** A task as the model sees it. */
function taskView(task: {
  id: string;
  subject: string;
  description: string;
  status: string;
  ownerName?: string;
  blockedBy: string[];
  writeScopes: string[];
  revision: number;
}): Record<string, unknown> {
  return {
    id: task.id,
    subject: task.subject,
    description: task.description,
    status: task.status,
    owner: task.ownerName ?? null,
    blocked_by: task.blockedBy,
    write_scopes: task.writeScopes,
    revision: task.revision,
    ready: task.status === "pending" && !task.ownerName,
  };
}

/** The lead's completed turns, for a forked teammate to start from. */
async function leadTurns(conversationId: string): Promise<Array<{ role: "user" | "assistant"; text: string }>> {
  try {
    const { getConversation } = await import("@/lib/store");
    const conversation = await getConversation(conversationId);
    const messages = (conversation?.messages ?? []) as Array<{
      role: string;
      parts?: Array<{ type: string; text?: string }>;
    }>;
    return messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        text: (message.parts ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n")
          .slice(0, 4000),
      }))
      .filter((turn) => turn.text.length > 0);
  } catch {
    return [];
  }
}
