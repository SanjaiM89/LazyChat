/**
 * Goal-domain semantics, ported from dsh-goal.
 *
 * These tests cover the parts the model actually experiences: revision
 * compare-and-set, phase transitions, round accounting, activation, and the
 * exact continuation prompt the driver appends.
 *
 * Run: npx tsx --test tests/unit/goals.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MAX_GOAL_ROUNDS,
  canStartGoalRound,
  createGoalRecord,
  goalWire,
  normalizeGoal,
  renderGoalRoundPrompt,
  updateGoalRecord,
} from "@/lib/goal-model";

const base = () =>
  createGoalRecord({
    id: "goal-1",
    conversationId: "conv-1",
    objective: "Ship the release",
    now: 1_000,
  });

describe("createGoalRecord", () => {
  it("starts active at revision 1 with the dsh default cap", () => {
    const goal = base();
    assert.equal(goal.phase, "active");
    assert.equal(goal.revision, 1);
    assert.equal(goal.roundsStarted, 0);
    assert.equal(goal.maxGoalRounds, DEFAULT_MAX_GOAL_ROUNDS);
    assert.equal(goal.objective, "Ship the release");
  });

  it("rejects non-positive caps and blank objectives", () => {
    assert.throws(
      () =>
        createGoalRecord({
          id: "g",
          conversationId: "c",
          objective: "x",
          maxGoalRounds: 0,
        }),
      /positive safe integer/,
    );
    assert.throws(
      () =>
        createGoalRecord({ id: "g", conversationId: "c", objective: "  " }),
      /non-empty/,
    );
  });
});

describe("updateGoalRecord", () => {
  it("requires the current revision", () => {
    const goal = base();
    assert.throws(
      () => updateGoalRecord(goal, { action: "pause", revision: 0 }),
      /revision mismatch/,
    );
  });

  it("bumps the revision on every successful mutation", () => {
    const paused = updateGoalRecord(base(), { action: "pause", revision: 1 });
    assert.equal(paused.phase, "paused");
    assert.equal(paused.revision, 2);
    const resumed = updateGoalRecord(paused, { action: "resume", revision: 2 });
    assert.equal(resumed.phase, "active");
    assert.equal(resumed.revision, 3);
  });

  it("edits the objective and round cap", () => {
    const edited = updateGoalRecord(base(), {
      action: "edit",
      revision: 1,
      objective: "  New objective  ",
      max_goal_rounds: 4,
    });
    assert.equal(edited.objective, "New objective");
    assert.equal(edited.maxGoalRounds, 4);
  });

  it("rejects an empty edit", () => {
    assert.throws(
      () => updateGoalRecord(base(), { action: "edit", revision: 1 }),
      /requires objective/,
    );
  });

  it("requires a reason for blocked", () => {
    assert.throws(
      () => updateGoalRecord(base(), { action: "blocked", revision: 1 }),
      /blocked_reason is required/,
    );
    const blocked = updateGoalRecord(base(), {
      action: "blocked",
      revision: 1,
      blocked_reason: "the API key is revoked",
    });
    assert.equal(blocked.phase, "blocked");
    assert.deepEqual(blocked.blockedReason, {
      code: "BLOCKED",
      message: "the API key is revoked",
    });
  });

  it("refuses to resume after the round cap is exhausted", () => {
    const exhausted = {
      ...base(),
      roundsStarted: 4,
      maxGoalRounds: 4,
      phase: "paused" as const,
    };
    assert.throws(
      () => updateGoalRecord(exhausted, { action: "resume", revision: 1 }),
      /exhausted 4 goal rounds/,
    );
  });

  it("completes the goal and clears a blocker", () => {
    const blocked = updateGoalRecord(base(), {
      action: "blocked",
      revision: 1,
      blocked_reason: "waiting",
    });
    const complete = updateGoalRecord(blocked, { action: "complete", revision: 2 });
    assert.equal(complete.phase, "complete");
    assert.equal(complete.blockedReason, undefined);
  });
});

describe("goalWire", () => {
  it("returns the dsh shape with camelCase fields and activation", () => {
    const wire = goalWire(base(), "armed");
    assert.deepEqual(wire, {
      goal: {
        id: "goal-1",
        revision: 1,
        objective: "Ship the release",
        phase: "active",
        roundsStarted: 0,
        maxGoalRounds: DEFAULT_MAX_GOAL_ROUNDS,
      },
      activation: "armed",
    });
    assert.deepEqual(goalWire(null, "disarmed"), { goal: null });
  });
});

describe("round admission", () => {
  it("requires an active, armed goal under the cap", () => {
    const goal = base();
    assert.equal(canStartGoalRound(goal, "armed"), true);
    assert.equal(canStartGoalRound(goal, "disarmed"), false);
    assert.equal(canStartGoalRound({ ...goal, phase: "paused" }, "armed"), false);
    assert.equal(
      canStartGoalRound({ ...goal, roundsStarted: goal.maxGoalRounds }, "armed"),
      false,
    );
  });

  it("renders the retained <goal_round> prompt", () => {
    const prompt = renderGoalRoundPrompt({ ...base(), maxGoalRounds: 8 }, 3);
    assert.match(prompt, /^<goal_round>/);
    assert.match(prompt, /Objective: "Ship the release"/);
    assert.match(prompt, /Round: 3\/8/);
    assert.match(prompt, /gather evidence/);
    assert.match(prompt, /<\/goal_round>$/);
  });
});

describe("normalizeGoal", () => {
  it("migrates the older status/round schema", () => {
    const goal = normalizeGoal({
      id: "g",
      conversationId: "c",
      objective: "old",
      status: "completed",
      round: 2,
      blockedReason: "stuck",
      createdAt: 1,
      updatedAt: 2,
    });
    assert.equal(goal?.phase, "complete");
    assert.equal(goal?.roundsStarted, 2);
    assert.equal(goal?.revision, 1);
    assert.equal(goal?.maxGoalRounds, DEFAULT_MAX_GOAL_ROUNDS);
    assert.deepEqual(goal?.blockedReason, { code: "BLOCKED", message: "stuck" });
  });

  it("drops malformed rows", () => {
    assert.equal(normalizeGoal(null), null);
    assert.equal(normalizeGoal({ id: "g" }), null);
  });
});
