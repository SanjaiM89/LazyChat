import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";

import { readJSON, writeJSON } from "@/lib/store";
import {
  admitGoalRound,
  createGoalRecord,
  DEFAULT_MAX_GOAL_ROUNDS,
  goalWire,
  normalizeGoal,
  renderGoalRoundPrompt,
  updateGoalRecord,
  type GoalActivation,
  type GoalRecord,
} from "@/lib/goal-model";

/**
 * Persisted same-session goal, ported from dsh-goal + dsh-tool-goal.
 *
 * Storage stays the existing per-user `goals.json`, but rows now carry the
 * dsh wire semantics: `revision` (compare-and-set), `roundsStarted`,
 * `maxGoalRounds`, and a `phase`. Activation (armed/disarmed) is process-local
 * like dsh's: a server restart leaves an active goal disarmed until a human
 * asks to resume it, so unattended rounds never resume themselves by accident.
 */

const GOALS_FILE = "goals.json";

/** Process-local auto-continuation authority, keyed by conversation. */
const activations = new Map<string, GoalActivation>();

function activationOf(conversationId: string): GoalActivation {
  return activations.get(conversationId) ?? "disarmed";
}

function arm(conversationId: string): void {
  activations.set(conversationId, "armed");
}

function disarm(conversationId: string): void {
  activations.set(conversationId, "disarmed");
}

async function loadGoals(): Promise<GoalRecord[]> {
  const raw = await readJSON<unknown[]>(GOALS_FILE, []);
  const goals: GoalRecord[] = [];
  for (const row of raw) {
    const goal = normalizeGoal(row);
    if (goal) goals.push(goal);
  }
  return goals;
}

async function saveGoals(goals: GoalRecord[]): Promise<void> {
  await writeJSON(GOALS_FILE, goals);
}

/** Latest goal in a conversation, whatever its phase. */
export async function getGoal(conversationId: string): Promise<GoalRecord | null> {
  const goals = await loadGoals();
  return (
    goals
      .filter((goal) => goal.conversationId === conversationId)
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  );
}

function maxRoundsDefault(): number {
  const raw = Number(process.env.OMNIA_GOAL_MAX_ROUNDS);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_GOAL_ROUNDS;
}

export function buildGoalTools(
  conversationId?: string,
  opts: { goalRound?: boolean } = {},
) {
  return {
    create_goal: tool({
      description:
        "Create a persisted goal that keeps this session working across automatic continuation rounds. " +
        'Use it when the direct human request is a long-running objective, even if the user did not say "goal"; ' +
        "not for single-turn work.",
      inputSchema: z.object({
        objective: z
          .string()
          .describe("The concrete completion objective inferred from the direct human request."),
        max_goal_rounds: z
          .number()
          .optional()
          .describe("Optional positive safe-integer limit on automatic continuation rounds."),
      }),
      execute: async ({ objective, max_goal_rounds }) => {
        if (!conversationId) {
          return { error: "Goals require a conversation context." };
        }
        const goals = await loadGoals();
        const current = goals
          .filter((goal) => goal.conversationId === conversationId)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        // dsh: a completed goal may be replaced; every other phase must be
        // cleared or resumed instead of silently shadowed.
        if (current && current.phase !== "complete") {
          return {
            error: `goal "${current.id}" already exists with phase "${current.phase}"; resume, complete, or block it before creating a new one.`,
            existing_id: current.id,
          };
        }
        const goal = createGoalRecord({
          id: `goal-${nanoid(10)}`,
          conversationId,
          objective,
          maxGoalRounds: max_goal_rounds ?? maxRoundsDefault(),
        });
        goals.push(goal);
        await saveGoals(goals);
        arm(conversationId);
        return goalWire(goal, "armed");
      },
    }),

    get_goal: tool({
      description:
        "Read the current session goal, including the id and revision that update_goal requires.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!conversationId) return { error: "Goals require a conversation context." };
        const goal = await getGoal(conversationId);
        return goalWire(goal, activationOf(conversationId));
      },
    }),

    update_goal: tool({
      description: "Update the current goal.",
      inputSchema: z.object({
        goal_id: z.string().describe("Exact id returned by get_goal."),
        revision: z
          .number()
          .describe("Exact positive revision returned by get_goal."),
        action: z
          .enum(["edit", "pause", "resume", "complete", "blocked"])
          .describe(
            "edit, pause, and resume require a direct human request. complete and blocked are also allowed " +
              "during an automatic continuation of this goal.",
          ),
        objective: z
          .string()
          .optional()
          .describe("Replacement objective; valid only with action edit."),
        max_goal_rounds: z
          .number()
          .optional()
          .describe("Replacement cap; valid only with action edit."),
        blocked_reason: z
          .string()
          .optional()
          .describe(
            "Required only with action blocked: the concrete condition that persists across rounds and blocks progress.",
          ),
      }),
      execute: async ({
        goal_id,
        revision,
        action,
        objective,
        max_goal_rounds,
        blocked_reason,
      }) => {
        if (!conversationId) return { error: "Goals require a conversation context." };
        // dsh's goal-tool authority: only complete/blocked may be decided by
        // the model during an automatic round; editing, pausing, and resuming
        // need a direct human turn.
        if (
          opts.goalRound &&
          (action === "edit" || action === "pause" || action === "resume")
        ) {
          throw new Error(
            "edit, pause, and resume require a direct human request; this turn is an automatic goal round",
          );
        }
        const goals = await loadGoals();
        const index = goals.findIndex(
          (goal) => goal.id === goal_id && goal.conversationId === conversationId,
        );
        if (index === -1) {
          return { error: `No goal with id ${goal_id} for this conversation.` };
        }
        const next = updateGoalRecord(goals[index], {
          action,
          revision,
          objective,
          max_goal_rounds,
          blocked_reason,
        });
        goals[index] = next;
        await saveGoals(goals);
        if (action === "resume") arm(conversationId);
        else if (action === "pause" || action === "complete" || action === "blocked") {
          disarm(conversationId);
        }
        return goalWire(next, activationOf(conversationId));
      },
    }),
  };
}

/**
 * Admit the next automatic continuation round, if the goal is active, armed,
 * and under its cap. Returns the prompt to append as the round's user message.
 *
 * Exhaustion records a blocker and disarms, matching dsh's driver: an
 * unattended session must stop rather than spin.
 */
export async function startGoalRound(conversationId: string): Promise<{
  goal: GoalRecord;
  round: number;
  prompt: string;
} | null> {
  if (process.env.OMNIA_GOAL_DRIVER === "0") return null;
  const goals = await loadGoals();
  const index = goals
    .map((goal, i) => ({ goal, i }))
    .filter(({ goal }) => goal.conversationId === conversationId)
    .sort((a, b) => b.goal.createdAt - a.goal.createdAt)[0]?.i;
  if (index === undefined) return null;

  const current = goals[index];
  const admission = admitGoalRound(current, activationOf(conversationId));
  if (admission.kind === "none") return null;
  if (admission.kind === "exhausted") {
    goals[index] = admission.goal;
    await saveGoals(goals);
    disarm(conversationId);
    return null;
  }
  goals[index] = admission.goal;
  await saveGoals(goals);
  return {
    goal: admission.goal,
    round: admission.round,
    prompt: renderGoalRoundPrompt(admission.goal, admission.round),
  };
}

/** Re-arm an active goal after a human asks to continue (dsh resume semantics). */
export function armGoal(conversationId: string): void {
  arm(conversationId);
}

/** Drop automatic authority while keeping the durable phase. */
export function disarmGoal(conversationId: string): void {
  disarm(conversationId);
}
