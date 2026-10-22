import "server-only";

import { askUser } from "@/lib/ask-user";
import { buildExitPlanModeTool } from "@/lib/plan-core";
import { readJSON, writeJSON } from "@/lib/store";

/**
 * Plan mode, ported from dsh-plan-mode.
 *
 * While active, the system prompt carries the planning guidance and the model
 * presents its plan through `exit_plan_mode`. That tool pauses the stream on
 * the ask-user seam and asks the human to approve or keep planning — exactly
 * the review dsh runs. Mode state is persisted per conversation so reopening a
 * chat restores the phase (dsh logs `plan/mode` in the session).
 */
interface PlanState {
  active: boolean;
  plan: string;
}

const PLANS_FILE = "plans.json";

/** Serialize read-modify-write cycles so two conversations cannot clobber. */
let chain: Promise<unknown> = Promise.resolve();

function mutate<T>(fn: (all: Record<string, PlanState>) => T): Promise<T> {
  const next = chain.then(async () => {
    const all = await readJSON<Record<string, PlanState>>(PLANS_FILE, {});
    const result = fn(all);
    await writeJSON(PLANS_FILE, all);
    return result;
  });
  chain = next.catch(() => undefined);
  return next;
}

export async function isPlanMode(conversationId: string): Promise<boolean> {
  const all = await readJSON<Record<string, PlanState>>(PLANS_FILE, {});
  return all[conversationId]?.active ?? false;
}

export async function getPlan(conversationId: string): Promise<string | null> {
  const all = await readJSON<Record<string, PlanState>>(PLANS_FILE, {});
  return all[conversationId]?.plan ?? null;
}

export async function enterPlanMode(conversationId: string): Promise<void> {
  await mutate((all) => {
    all[conversationId] = { active: true, plan: all[conversationId]?.plan ?? "" };
  });
}

/** Record the submitted plan while the review is open. */
export async function submitPlan(conversationId: string, plan: string): Promise<void> {
  await mutate((all) => {
    all[conversationId] = { active: true, plan };
  });
}

/** Leave plan mode while retaining the last plan for the transcript. */
export async function exitPlanMode(conversationId: string): Promise<string | null> {
  return mutate((all) => {
    const state = all[conversationId];
    if (!state) return null;
    all[conversationId] = { active: false, plan: state.plan };
    return state.plan;
  });
}

export function buildPlanModeTool(opts: {
  conversationId?: string;
  runId?: string;
}) {
  return buildExitPlanModeTool({
    ...opts,
    isActive: isPlanMode,
    submit: submitPlan,
    exit: exitPlanMode,
    askUser,
  });
}

export { planTitle } from "@/lib/plan-core";
