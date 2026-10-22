import { tool } from "ai";
import { z } from "zod";

import type { AskAnswer, AskQuestion } from "@/lib/ask-user";

/**
 * The review half of dsh-plan-mode, free of storage so it can be tested with
 * an in-memory repository. `lib/plan-mode.ts` supplies the persisted state and
 * the real ask-user seam.
 */

export const REVIEW_ID = "plan-review";
export const APPROVE_LABEL = "Approve";
export const KEEP_PLANNING_LABEL = "Keep planning";

/** The plan's first markdown heading (any level), or undefined. */
export function firstHeading(plan: string): string | undefined {
  for (const line of plan.split("\n")) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

/** Title helper for a plan, mirroring dsh's generic tool card. */
export function planTitle(plan: string): string {
  return firstHeading(plan) ?? "Plan";
}

export interface PlanToolOptions {
  conversationId?: string;
  runId?: string;
  isActive: (conversationId: string) => Promise<boolean>;
  submit: (conversationId: string, plan: string) => Promise<void>;
  exit: (conversationId: string) => Promise<string | null>;
  askUser: (
    toolCallId: string,
    conversationId: string,
    questions: AskQuestion[],
    runId?: string,
  ) => Promise<AskAnswer[]>;
}

export function buildExitPlanModeTool(opts: PlanToolOptions) {
  return {
    exit_plan_mode: tool({
      description:
        "Use only in plan mode. Present your plan for the user's review and, on approval, leave plan mode. " +
        "The user may approve (carry out the plan from your next step) or keep planning — their feedback " +
        "comes back in the tool result; revise and present again.",
      inputSchema: z.object({
        plan: z
          .string()
          .describe(
            "The complete plan, as markdown, starting with a # heading that names it.",
          ),
      }),
      execute: async ({ plan }, exec) => {
        if (!opts.conversationId) {
          throw new Error("exit_plan_mode requires a conversation context");
        }
        if (!(await opts.isActive(opts.conversationId))) {
          throw new Error("exit_plan_mode is only available in plan mode");
        }
        if (!/^#\s+\S/.test(plan.trim())) {
          throw new Error(
            "exit_plan_mode requires a non-empty markdown plan starting with a # heading",
          );
        }
        await opts.submit(opts.conversationId, plan);

        const answers = await opts.askUser(
          String(exec?.toolCallId ?? ""),
          opts.conversationId,
          [
            {
              id: REVIEW_ID,
              header: "Plan review",
              question: "Approve this plan and leave plan mode?",
              options: [
                {
                  label: APPROVE_LABEL,
                  description:
                    "Leave plan mode; the plan is carried out from the next step.",
                },
                {
                  label: KEEP_PLANNING_LABEL,
                  description:
                    "Stay in plan mode; feedback goes back to the model.",
                },
              ],
            },
          ],
          opts.runId,
        );

        const item = answers.find((answer) => answer.id === REVIEW_ID);
        if (!item) {
          // Dismissed, cancelled, or expired: keep plan mode on so the human
          // can answer in their own words on the next turn.
          return { approved: false };
        }
        if (
          item.selected.length === 1 &&
          item.selected[0] === APPROVE_LABEL &&
          !item.custom
        ) {
          await opts.exit(opts.conversationId);
          return { approved: true };
        }
        const feedback = item.custom ?? "";
        throw new Error(
          feedback === ""
            ? "The user chose to keep planning; revise the plan and present it again."
            : `The user chose to keep planning; their feedback: ${feedback}`,
        );
      },
    }),
  };
}
