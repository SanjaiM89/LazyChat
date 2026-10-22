/**
 * Plan-review semantics, ported from dsh-plan-mode.
 *
 * The storage half lives in `lib/plan-mode.ts` (server-only); this exercises
 * the review tool against an in-memory repository and a controllable ask-user
 * seam, so approve / keep-planning / dismissal are deterministic.
 *
 * Run: npx tsx --test tests/unit/plan-mode.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import type { AskAnswer } from "@/lib/ask-user";
import {
  APPROVE_LABEL,
  KEEP_PLANNING_LABEL,
  buildExitPlanModeTool,
  planTitle,
} from "@/lib/plan-core";

const CONV = "conv-plan";

let active = false;
let submitted = "";
let replies: AskAnswer[] = [];

function make() {
  return buildExitPlanModeTool({
    conversationId: CONV,
    isActive: async () => active,
    submit: async (_conversation, plan) => {
      submitted = plan;
      active = true;
    },
    exit: async () => {
      active = false;
      return submitted;
    },
    askUser: async () => replies,
  }).exit_plan_mode;
}

function call(args: { plan: string }, callId = "call-1") {
  return (make().execute as any)(args, { toolCallId: callId });
}

beforeEach(() => {
  active = true;
  submitted = "";
  replies = [];
});

describe("plan title", () => {
  it("uses the first markdown heading", () => {
    assert.equal(planTitle("# Release plan\n\n- step"), "Release plan");
    assert.equal(planTitle("no heading"), "Plan");
  });
});

describe("exit_plan_mode review", () => {
  it("approves, leaves plan mode, and keeps the plan", async () => {
    replies = [{ id: "plan-review", selected: [APPROVE_LABEL] }];
    const result = await call({ plan: "# Ship it\n\n1. Do A" });
    assert.deepEqual(result, { approved: true });
    assert.equal(active, false);
    assert.equal(submitted, "# Ship it\n\n1. Do A");
  });

  it("keeps planning and returns the user's feedback as a failed call", async () => {
    replies = [
      {
        id: "plan-review",
        selected: [KEEP_PLANNING_LABEL],
        custom: "add a rollback step",
      },
    ];
    await assert.rejects(
      () => call({ plan: "# Ship it" }),
      /their feedback: add a rollback step/,
    );
    assert.equal(active, true);
  });

  it("keeps planning without feedback", async () => {
    replies = [{ id: "plan-review", selected: [KEEP_PLANNING_LABEL] }];
    await assert.rejects(
      () => call({ plan: "# Ship it" }),
      /chose to keep planning; revise the plan/,
    );
    assert.equal(active, true);
  });

  it("treats a dismissed review as approved=false and stays in plan mode", async () => {
    replies = [];
    const result = await call({ plan: "# Ship it" });
    assert.deepEqual(result, { approved: false });
    assert.equal(active, true);
  });

  it("rejects a plan without a # heading", async () => {
    replies = [{ id: "plan-review", selected: [APPROVE_LABEL] }];
    await assert.rejects(() => call({ plan: "1. Do A" }), /# heading/);
    assert.equal(active, true);
  });

  it("rejects calls outside plan mode", async () => {
    active = false;
    await assert.rejects(() => call({ plan: "# Ship it" }), /only available in plan mode/);
  });

  it("rejects calls without a conversation", async () => {
    const tool = buildExitPlanModeTool({
      isActive: async () => true,
      submit: async () => {},
      exit: async () => null,
      askUser: async () => [],
    }).exit_plan_mode;
    await assert.rejects(
      () => (tool.execute as any)({ plan: "# Ship it" }, { toolCallId: "c" }),
      /conversation context/,
    );
  });
});
