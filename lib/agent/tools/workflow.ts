import { tool } from "ai";
import { z } from "zod";

import { runWorkflowScript, validateSchema, workflowEvent } from "@/lib/agent/workflow";
import { runSubagentToCompletion, type SpawnSubagentInput } from "@/lib/agent/subagents";
import { startJob } from "@/lib/agent/jobs";
import type { PermissionSettings } from "@/lib/agent/permissions";
import type { ChatSettings } from "@/lib/types";

/**
 * The workflow and ralph tools.
 *
 * A workflow is a small program the model writes to fan work out across many
 * agents at once. Ralph is the opposite: one objective, worked at round after
 * round by a fresh agent each time, with only a bounded handoff carried over.
 */

const SCRIPT_CONTRACT = `Script-body hooks:
- \`agent(prompt, opts?): Promise<any>\` — run one subagent to completion. Without \`opts.schema\` it resolves to the child's final text; with \`opts.schema\` (an object-rooted JSON Schema using ONLY type/properties/required/additionalProperties/items/enum/const/oneOf) it resolves to the validated object. Other opts: \`label\` (display), \`phase\` (progress group), and independent \`provider\`/\`model\` LLM target overrides.
- \`pipeline(items, ...stages): Promise<any[]>\` — run each item through the stages independently with NO barrier between stages (prefer this for multi-stage work). Each stage receives \`(prev, item, index)\`. A stage throw drops that ITEM to \`null\` and skips its remaining stages.
- \`parallel(thunks): Promise<any[]>\` — run zero-argument functions concurrently and await ALL of them (a barrier; use only when a stage genuinely needs every prior result together). A throwing thunk resolves to \`null\`.
- \`phase(title)\` — start a progress phase; \`log(message)\` — narrate progress; \`args\` — the tool call's \`args\` input, verbatim.

Misused hooks (bad arguments, unknown options, unsupported schemas, tripped caps) end the whole script instead of producing \`null\`. The script has no filesystem, network, timer, or Node.js APIs; the agents do the work.`;

export function buildWorkflowTools(ctx: {
  conversationId: string;
  parentRunId?: string;
  settings: ChatSettings;
  permissions: PermissionSettings;
  workspaceId?: string;
  cwd?: string;
}) {
  const spawnInput = (task: string, provider?: string, model?: string): SpawnSubagentInput => ({
    task,
    conversationId: ctx.conversationId,
    parentRunId: ctx.parentRunId,
    settings: ctx.settings,
    permissions: ctx.permissions,
    workspaceId: ctx.workspaceId,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    // A workflow agent may not spawn another workflow.
    excludeTools: ["workflow", "ralph", "code_run"],
  });

  const runScript = async (
    script: string,
    args: Record<string, unknown>,
  ) => {
    workflowEvent(
      "tool-workflow/run-start",
      { args: Object.keys(args) },
      { conversationId: ctx.conversationId, runId: ctx.parentRunId },
    );

    const result = await runWorkflowScript(
      script,
      args,
      {
        agent: async (prompt, options) => {
          workflowEvent(
            "tool-workflow/agent-start",
            { label: options.label ?? null, phase: options.phase ?? null },
            { conversationId: ctx.conversationId, runId: ctx.parentRunId },
          );
          const child = await runSubagentToCompletion(
            spawnInput(prompt, options.provider, options.model),
          );
          workflowEvent(
            "tool-workflow/agent-end",
            { label: options.label ?? null, ok: !child.error },
            { conversationId: ctx.conversationId, runId: ctx.parentRunId },
          );
          if (child.error && !child.text) return null;
          if (!options.schema) return child.text;
          // The child was asked for JSON; it has to be JSON, and it has to fit.
          let parsed: unknown;
          try {
            parsed = JSON.parse(child.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
          } catch {
            throw new Error("The agent did not answer with the JSON the schema asks for.");
          }
          const error = validateSchema(parsed, options.schema);
          if (error) throw new Error(`The agent's answer does not fit the schema: ${error}`);
          return parsed;
        },
        note: (kind, message) => {
          if (kind === "phase") {
            workflowEvent(
              "tool-workflow/agent-start",
              { phase: message },
              { conversationId: ctx.conversationId, runId: ctx.parentRunId },
            );
          }
        },
      },
      { timeoutMs: 15 * 60 * 1000 },
    );

    workflowEvent(
      "tool-workflow/run-end",
      { ok: result.ok, agents: result.calls.length },
      { conversationId: ctx.conversationId, runId: ctx.parentRunId },
    );
    return result;
  };

  return {
    workflow: tool({
      description:
        `Run a JavaScript workflow script that orchestrates subagents at scale. Use this for work that fans out across many independent pieces — an audit over many files, a migration, multi-angle research, adversarial verification of findings — where you write the orchestration as a script instead of delegating turn by turn.\n\n${SCRIPT_CONTRACT}`,
      inputSchema: z.object({
        script: z.string().describe("The workflow script"),
        args: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Values the script reads from `args`"),
        run_in_background: z
          .boolean()
          .optional()
          .describe("Start the workflow and return a job id instead of waiting for it"),
      }),
      execute: async ({ script, args, run_in_background }) => {
        const scriptArgs = args ?? {};

        if (run_in_background) {
          const job = startJob({
            conversationId: ctx.conversationId,
            title: "workflow",
            command: "workflow",
            cwd: ctx.cwd ?? process.cwd(),
            run: async () => {
              const result = await runScript(script, scriptArgs);
              const text = result.ok
                ? JSON.stringify(result.value ?? null, null, 1)
                : `The workflow failed: ${result.error}`;
              return { output: text, exitCode: result.ok ? 0 : 1 };
            },
          });
          return { job: job.id, status: job.status, note: "The workflow is running in the background." };
        }

        const result = await runScript(script, scriptArgs);
        if (!result.ok) {
          return {
            error: result.error,
            phases: result.phases,
            logs: result.logs,
            agents: result.calls.length,
          };
        }
        return {
          result: result.value ?? null,
          phases: result.phases,
          logs: result.logs,
          agents: result.calls.length,
        };
      },
    }),

    ralph: tool({
      description:
        "Work toward one objective, one fresh agent per round. Each round starts a clean agent that knows the objective " +
        "and the previous round's handoff, and nothing else. Use it when the work needs several passes to get right.",
      inputSchema: z.object({
        objective: z.string().describe("What the rounds are all working toward"),
        max_rounds: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("How many rounds to run (default 3)"),
      }),
      execute: async ({ objective, max_rounds }) => {
        const rounds = max_rounds ?? 3;
        let handoff: string | undefined;
        const history: Array<{ round: number; status: string; summary: string }> = [];

        for (let round = 1; round <= rounds; round++) {
          const prompt = [
            "You are one fresh worker in a foreground Ralph loop. You receive no parent conversation and no prior child session. Do not call the ralph tool: this round already is its worker.",
            `Immutable objective:\n${objective}`,
            `Ralph round: ${round} of ${rounds}.`,
            "The shared workspace and its current working tree are the long-term memory and source of truth. Inspect them before acting, preserve existing work, perform concrete in-scope work, and verify what you change. Treat the previous report only as a bounded handoff; confirm it against the workspace.",
            `Previous structured handoff:\n${handoff ?? "(none — this is the first round)"}`,
            "Answer with a single JSON object and nothing else: {\"status\":\"continue|done|blocked\",\"summary\":\"what you did and what you found\",\"next\":\"what the next round should do\"}.",
          ].join("\n");

          const child = await runSubagentToCompletion(spawnInput(prompt));
          if (child.error && !child.text) {
            return { error: child.error, round, history };
          }

          let parsed: { status?: string; summary?: string; next?: string } = {};
          try {
            parsed = JSON.parse(child.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
          } catch {
            parsed = { status: "continue", summary: child.text.slice(0, 2000) };
          }
          history.push({
            round,
            status: parsed.status ?? "continue",
            summary: (parsed.summary ?? "").slice(0, 2000),
          });
          handoff = JSON.stringify({ status: parsed.status, summary: parsed.summary, next: parsed.next });

          if (parsed.status === "done" || parsed.status === "blocked") {
            return {
              rounds: round,
              status: parsed.status,
              summary: parsed.summary ?? "",
              next: parsed.next ?? null,
              history,
            };
          }
        }

        return {
          rounds,
          status: "continue",
          summary: history[history.length - 1]?.summary ?? "",
          next: handoff ? JSON.parse(handoff).next : null,
          history,
          note: "The rounds ran out. Call ralph again to continue from here.",
        };
      },
    }),
  };
}
