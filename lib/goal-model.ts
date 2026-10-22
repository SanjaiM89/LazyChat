/**
 * Pure goal-domain semantics, ported from dsh-goal.
 *
 * The goal is a same-session objective that survives context resets and drives
 * automatic continuation rounds. Every mutation is compare-and-set on
 * `revision`, so a stale model call cannot clobber a newer state.
 */

export type GoalAction = "edit" | "pause" | "resume" | "complete" | "blocked";
export type GoalPhase = "active" | "paused" | "blocked" | "complete";
export type GoalActivation = "armed" | "disarmed";

export interface GoalBlockedReason {
  code: string;
  message: string;
}

export interface GoalRecord {
  id: string;
  conversationId: string;
  objective: string;
  phase: GoalPhase;
  /** Positive, bumped by every successful mutation. */
  revision: number;
  /** Goal rounds admitted so far. */
  roundsStarted: number;
  maxGoalRounds: number;
  blockedReason?: GoalBlockedReason;
  createdAt: number;
  updatedAt: number;
}

/** dsh-goal's deployment default. */
export const DEFAULT_MAX_GOAL_ROUNDS = 256;

export interface GoalUpdateInput {
  action: GoalAction;
  revision: number;
  objective?: string;
  max_goal_rounds?: number;
  blocked_reason?: string;
}

/** Positive safe integer or throw, matching the domain's validation. */
function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

/** Trimmed non-empty objective or throw. */
function objectiveText(value: string): string {
  const text = value.trim();
  if (text === "") throw new Error("objective must be a non-empty string");
  return text;
}

/** Normalize a stored row (including goals written by the older schema). */
export function normalizeGoal(raw: any): GoalRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const legacyStatus = typeof raw.status === "string" ? raw.status : "";
  const phase: GoalPhase =
    raw.phase === "active" ||
    raw.phase === "paused" ||
    raw.phase === "blocked" ||
    raw.phase === "complete"
      ? raw.phase
      : legacyStatus === "completed"
        ? "complete"
        : legacyStatus === "paused" || legacyStatus === "blocked" || legacyStatus === "active"
          ? legacyStatus
          : "active";
  const blockedReason =
    raw.blockedReason && typeof raw.blockedReason === "object"
      ? {
          code: String(raw.blockedReason.code ?? "BLOCKED"),
          message: String(raw.blockedReason.message ?? ""),
        }
      : typeof raw.blockedReason === "string"
        ? { code: "BLOCKED", message: raw.blockedReason }
        : undefined;
  if (typeof raw.id !== "string" || typeof raw.conversationId !== "string") return null;
  if (typeof raw.objective !== "string") return null;
  return {
    id: raw.id,
    conversationId: raw.conversationId,
    objective: raw.objective,
    phase,
    revision:
      Number.isSafeInteger(raw.revision) && raw.revision > 0 ? raw.revision : 1,
    roundsStarted:
      Number.isSafeInteger(raw.roundsStarted) && raw.roundsStarted >= 0
        ? raw.roundsStarted
        : Number.isSafeInteger(raw.round) && raw.round >= 0
          ? raw.round
          : 0,
    maxGoalRounds:
      Number.isSafeInteger(raw.maxGoalRounds) && raw.maxGoalRounds > 0
        ? raw.maxGoalRounds
        : DEFAULT_MAX_GOAL_ROUNDS,
    ...(blockedReason && blockedReason.message ? { blockedReason } : {}),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

export function createGoalRecord(input: {
  id: string;
  conversationId: string;
  objective: string;
  maxGoalRounds?: number;
  now?: number;
}): GoalRecord {
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    conversationId: input.conversationId,
    objective: objectiveText(input.objective),
    phase: "active",
    revision: 1,
    roundsStarted: 0,
    maxGoalRounds:
      input.maxGoalRounds === undefined
        ? DEFAULT_MAX_GOAL_ROUNDS
        : positiveInteger(input.maxGoalRounds, "max_goal_rounds"),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Apply one mutation in place on a copy.
 *
 * @returns the next goal, or throws with a model-readable policy error.
 */
export function updateGoalRecord(
  goal: GoalRecord,
  input: GoalUpdateInput,
  now = Date.now(),
): GoalRecord {
  if (input.revision !== goal.revision) {
    throw new Error(
      `goal revision mismatch: expected ${goal.revision}, got ${input.revision}; call get_goal and retry`,
    );
  }

  const next: GoalRecord = { ...goal, updatedAt: now };
  const hasObjective = input.objective !== undefined && input.objective.trim() !== "";
  const hasRoundCap = input.max_goal_rounds !== undefined && input.max_goal_rounds !== 0;

  switch (input.action) {
    case "edit": {
      if (!hasObjective && !hasRoundCap) {
        throw new Error("goal edit requires objective and/or max_goal_rounds");
      }
      if (input.blocked_reason !== undefined) {
        throw new Error("blocked_reason is valid only with action blocked");
      }
      if (hasObjective) next.objective = objectiveText(input.objective!);
      if (hasRoundCap) {
        next.maxGoalRounds = positiveInteger(input.max_goal_rounds!, "max_goal_rounds");
      }
      break;
    }
    case "pause": {
      if (hasObjective || hasRoundCap || input.blocked_reason !== undefined) {
        throw new Error(
          "objective and max_goal_rounds are valid only with action edit; blocked_reason is valid only with action blocked",
        );
      }
      if (next.phase === "complete") {
        throw new Error(`goal "${next.id}" is complete and cannot be paused`);
      }
      next.phase = "paused";
      break;
    }
    case "resume": {
      if (hasObjective || hasRoundCap || input.blocked_reason !== undefined) {
        throw new Error(
          "objective and max_goal_rounds are valid only with action edit; blocked_reason is valid only with action blocked",
        );
      }
      if (next.roundsStarted >= next.maxGoalRounds) {
        throw new Error(
          `goal "${next.id}" exhausted ${next.maxGoalRounds} goal rounds; increase max_goal_rounds before resuming`,
        );
      }
      next.phase = "active";
      delete next.blockedReason;
      break;
    }
    case "complete": {
      if (hasObjective || hasRoundCap) {
        throw new Error("objective and max_goal_rounds are valid only with action edit");
      }
      if (input.blocked_reason !== undefined) {
        throw new Error("blocked_reason is valid only with action blocked");
      }
      next.phase = "complete";
      delete next.blockedReason;
      break;
    }
    case "blocked": {
      if (hasObjective || hasRoundCap) {
        throw new Error("objective and max_goal_rounds are valid only with action edit");
      }
      if (input.blocked_reason === undefined || input.blocked_reason.trim() === "") {
        throw new Error("blocked_reason is required for the blocked action");
      }
      next.phase = "blocked";
      next.blockedReason = { code: "BLOCKED", message: input.blocked_reason.trim() };
      break;
    }
    default:
      throw new Error(`unknown goal action: ${String(input.action)}`);
  }

  next.revision = goal.revision + 1;
  return next;
}

/** Canonical tool output (dsh's GoalToolValue). */
export function goalWire(goal: GoalRecord | null, activation: GoalActivation) {
  if (!goal) return { goal: null };
  return {
    goal: {
      id: goal.id,
      revision: goal.revision,
      objective: goal.objective,
      phase: goal.phase,
      roundsStarted: goal.roundsStarted,
      maxGoalRounds: goal.maxGoalRounds,
      ...(goal.blockedReason
        ? {
            blockedReason: {
              code: goal.blockedReason.code,
              message: goal.blockedReason.message,
            },
          }
        : {}),
    },
    activation,
  };
}

/** Whether the next automatic continuation round may be admitted. */
export function canStartGoalRound(
  goal: GoalRecord | null,
  activation: GoalActivation,
): boolean {
  return (
    goal !== null &&
    goal.phase === "active" &&
    activation === "armed" &&
    goal.roundsStarted < goal.maxGoalRounds
  );
}

/** Whether a user message is the driver's retained continuation prompt. */
export function isGoalRoundPrompt(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("<goal_round>") && trimmed.endsWith("</goal_round>");
}

/** Model-visible continuation prompt, verbatim from dsh's goal-round-driver. */
export function renderGoalRoundPrompt(goal: GoalRecord, round: number): string {  return (
    "<goal_round>\n" +
    `Objective: ${JSON.stringify(goal.objective)}\n` +
    `Round: ${round}/${goal.maxGoalRounds}\n\n` +
    "Continue working toward the objective in this same session. Treat the current workspace, " +
    "tool results, and durable session state as authoritative; inspect them instead of assuming " +
    "earlier narration is still current. Make concrete progress and verify the result. Before " +
    "claiming completion, gather evidence that the whole objective is achieved, read the current " +
    "goal, and mark it complete. If work remains, leave the goal active for the next round. Follow " +
    "the configured goal-tool policy before reporting a blocker.\n" +
    "</goal_round>"
  );
}
