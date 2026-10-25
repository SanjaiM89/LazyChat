import { tool } from "ai";
import { z } from "zod";

import {
  getSubagent,
  interruptSubagent,
  listSubagents,
  sendToSubagent,
  spawnSubagent,
  type SpawnSubagentInput,
} from "@/lib/agent/subagents";
import { getJob, jobOutput, killJob, listJobs, startJob } from "@/lib/agent/jobs";
import { PROVIDERS, getDefaultModel } from "@/lib/models";
import type { PermissionSettings } from "@/lib/agent/permissions";
import type { ChatSettings } from "@/lib/types";

/**
 * The tools that let the model hand work to somebody else: a subagent that
 * thinks on its own, and a background job that keeps running when the turn
 * ends.
 */
export function buildSubagentTools(ctx: {
  conversationId: string;
  parentRunId?: string;
  settings: ChatSettings;
  permissions: PermissionSettings;
  workspaceId?: string;
  cwd?: string;
}) {
  const spawnInput = (task: string, model?: string, provider?: string): SpawnSubagentInput => ({
    task,
    conversationId: ctx.conversationId,
    parentRunId: ctx.parentRunId,
    settings: ctx.settings,
    permissions: ctx.permissions,
    workspaceId: ctx.workspaceId,
    model,
    provider,
    // A subagent may not spawn another subagent.
    excludeTools: ["subagent", "subagent_send_message", "subagent_interrupt", "code_run"],
  });

  return {
    subagent: tool({
      description:
        "Hand a task to a subagent: a second agent that works on it with the same tools and reports back. " +
        "Use it for work that is self-contained and would fill the context — a survey, a long file analysis, a " +
        "change spread over many files. The subagent runs in the background; ask for its result with subagent_list.",
      inputSchema: z.object({
        task: z.string().describe("What the subagent should do, in enough detail to work from"),
        model: z.string().optional().describe("A different model to use, if this work needs one"),
        provider: z.string().optional().describe("A different provider to use"),
      }),
      execute: async ({ task, model, provider }) => {
        const agent = spawnInput(task, model, provider);
        const sub = spawnSubagent(agent);
        return {
          subagent: sub.id,
          status: sub.status,
          note: "It works in the background. Ask for its result with subagent_list.",
        };
      },
    }),

    subagent_list: tool({
      description:
        "List the subagents and what they are doing. A finished subagent carries the answer it produced.",
      inputSchema: z.object({
        subagent: z.string().optional().describe("Only this subagent, instead of all of them"),
      }),
      execute: async ({ subagent }) => {
        if (subagent) {
          const agent = getSubagent(subagent);
          if (!agent) return { error: `There is no subagent called "${subagent}".` };
          return {
            subagent: agent.id,
            status: agent.status,
            task: agent.task,
            result: agent.result ?? null,
            error: agent.error ?? null,
            pending: agent.inbox.length,
          };
        }
        const agents = listSubagents(ctx.conversationId);
        return {
          count: agents.length,
          subagents: agents.map((agent) => ({
            subagent: agent.id,
            status: agent.status,
            task: agent.task,
            result: agent.result ?? null,
            error: agent.error ?? null,
            pending: agent.inbox.length,
          })),
        };
      },
    }),

    subagent_send_message: tool({
      description:
        "Send a message to a subagent. A running subagent reads it when it next starts a turn; an idle one wakes up " +
        "with it.",
      inputSchema: z.object({
        subagent: z.string().describe("The subagent id"),
        message: z.string().describe("What to tell it"),
      }),
      execute: async ({ subagent, message }) => {
        const result = sendToSubagent(subagent, message, spawnInput(message));
        if (result.error) return { error: result.error };
        return { subagent, delivered: true, queued: result.queued };
      },
    }),

    subagent_interrupt: tool({
      description: "Stop a subagent and the work it is doing.",
      inputSchema: z.object({
        subagent: z.string().describe("The subagent id"),
      }),
      execute: async ({ subagent }) => {
        const ok = interruptSubagent(subagent);
        return ok ? { subagent, interrupted: true } : { error: `There is no subagent called "${subagent}".` };
      },
    }),

    subagent_list_models: tool({
      description: "List the models a subagent can be given, with their context windows.",
      inputSchema: z.object({}),
      execute: async () => {
        const models: Array<{ provider: string; id: string; context?: number }> = [];
        for (const [providerId, provider] of Object.entries(PROVIDERS)) {
          for (const model of provider.models ?? []) {
            models.push({ provider: providerId, id: model.id, context: model.context });
          }
        }
        return {
          count: models.length,
          default: getDefaultModel("sarvam" as never),
          models,
        };
      },
    }),

    job_start: tool({
      description:
        "Start a background job: a command that keeps running after this turn ends. Use it for a build, a test " +
        "run, a watch process — anything longer than a tool call should be.",
      inputSchema: z.object({
        command: z.string().describe("The command to run"),
        title: z.string().optional().describe("A short name for the job"),
      }),
      execute: async ({ command, title }) => {
        const job = startJob({
          conversationId: ctx.conversationId,
          title: title ?? command,
          command,
          cwd: ctx.cwd ?? process.cwd(),
        });
        return { job: job.id, status: job.status, command: job.command };
      },
    }),

    job_output: tool({
      description: "Read what a background job has produced so far.",
      inputSchema: z.object({
        job: z.string().describe("The job id"),
        since: z.number().int().min(0).optional().describe("Read from this character offset"),
      }),
      execute: async ({ job, since }) => {
        const record = getJob(job);
        if (!record) return { error: `There is no job called "${job}".` };
        const output = jobOutput(job, since ?? 0);
        return {
          job,
          status: record.status,
          exit_code: record.exitCode ?? null,
          output: output?.output ?? "",
          truncated: output?.truncated ?? false,
        };
      },
    }),

    job_list: tool({
      description: "List the background jobs and their state.",
      inputSchema: z.object({}),
      execute: async () => {
        const jobs = listJobs(ctx.conversationId);
        return {
          count: jobs.length,
          jobs: jobs.map((job) => ({
            job: job.id,
            title: job.title,
            status: job.status,
            exit_code: job.exitCode ?? null,
            started_at: job.startedAt,
          })),
        };
      },
    }),

    job_kill: tool({
      description: "Stop a running background job.",
      inputSchema: z.object({
        job: z.string().describe("The job id"),
      }),
      execute: async ({ job }) => {
        const ok = killJob(job);
        return ok ? { job, killed: true } : { error: `There is no job called "${job}".` };
      },
    }),
  };
}
