/**
 * Tests for the ported dsh-tool-goal and dsh-tool-schedule modules.
 *
 * Run: npx tsx --test tests/unit/goals-schedules.test.ts
 */
import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { DATA_DIR } from "@/lib/store";
import { buildGoalTools } from "@/lib/goals";
import { buildScheduleTools } from "@/lib/schedules";

const CONV_ID = "test-conv-" + Date.now();

beforeEach(async () => {
  // Clean up test data
  if (fs.existsSync(path.join(DATA_DIR, "goals.json"))) {
    fs.unlinkSync(path.join(DATA_DIR, "goals.json"));
  }
});

after(async () => {
  // Cleanup
  ["goals.json", "schedules.json", "pending-reminders.json"].forEach((f) => {
    const fp = path.join(DATA_DIR, f);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
});

describe("goals", () => {
  const exec = (tools: ReturnType<typeof buildGoalTools>, t: any, args: Record<string, unknown>) =>
    t.execute(args, { toolCallId: "test-call" });

  it("creates and retrieves a goal in the dsh wire shape", async () => {
    const tools = buildGoalTools(CONV_ID);
    // No goal initially.
    const getResult = (await exec(tools, tools.get_goal, {})) as {
      goal: { id: string; objective: string } | null;
    };
    assert.equal(getResult.goal, null);

    const createResult = (await exec(tools, tools.create_goal, {
      objective: "Test the goal feature",
    })) as {
      goal: { id: string; objective: string; phase: string; revision: number; roundsStarted: number };
      activation: string;
    };
    assert.equal(createResult.goal.phase, "active");
    assert.equal(createResult.activation, "armed");
    assert.equal(createResult.goal.revision, 1);
    assert.ok(createResult.goal.id);

    const getResult2 = (await exec(tools, tools.get_goal, {})) as {
      goal: { id: string; objective: string };
    };
    assert.equal(getResult2.goal?.id, createResult.goal.id);
    assert.equal(getResult2.goal?.objective, "Test the goal feature");
  });

  it("prevents creating a second live goal", async () => {
    const tools = buildGoalTools(CONV_ID + "-dup");
    await exec(tools, tools.create_goal, { objective: "First goal" });
    const result = (await exec(tools, tools.create_goal, {
      objective: "Second goal",
    })) as { error: string };
    assert.ok(result.error?.includes("already exists"));
  });

  it("completes a goal and allows a new one", async () => {
    const tools = buildGoalTools(CONV_ID + "-complete");
    const created = (await exec(tools, tools.create_goal, {
      objective: "Will complete",
    })) as { goal: { id: string; revision: number } };
    const completed = (await exec(tools, tools.update_goal, {
      goal_id: created.goal.id,
      revision: created.goal.revision,
      action: "complete",
    })) as { goal: { phase: string }; activation: string };
    assert.equal(completed.goal.phase, "complete");
    assert.equal(completed.activation, "disarmed");

    const next = (await exec(tools, tools.create_goal, {
      objective: "The next goal",
    })) as { goal: { phase: string } };
    assert.equal(next.goal.phase, "active");
  });

  it("requires the current revision for updates", async () => {
    const tools = buildGoalTools(CONV_ID + "-cas");
    const created = (await exec(tools, tools.create_goal, {
      objective: "Revision test",
    })) as { goal: { id: string } };
    await assert.rejects(
      () =>
        exec(tools, tools.update_goal, {
          goal_id: created.goal.id,
          revision: 99,
          action: "pause",
        }),
      /revision mismatch/,
    );
  });
});

describe("schedules", () => {
  it("creates and lists a schedule", async () => {
    const tools = buildScheduleTools(CONV_ID + "-sched");
    const exec = (t: any, args: Record<string, unknown>) => t.execute(args);

    const created = (await exec(tools.schedule_create, {
      prompt: "Stand up",
      title: "Morning standup",
      after_seconds: 60,
    })) as { id: string; next_delivery: number };
    assert.ok(created.id);
    assert.ok(created.next_delivery > Date.now());

    const listed = (await exec(tools.schedule_list, {})) as { schedules: Array<{ id: string; title: string }> };
    assert.ok(listed.schedules.some((s) => s.id === created.id));
    assert.equal(listed.schedules[0].title, "Morning standup");
  });

  it("deletes a schedule", async () => {
    const tools = buildScheduleTools(CONV_ID + "-sched-del");
    const exec = (t: any, args: Record<string, unknown>) => t.execute(args);

    const created = (await exec(tools.schedule_create, {
      prompt: "Test",
      title: "Test reminder",
      after_seconds: 30,
    })) as { id: string };

    const deleted = (await exec(tools.schedule_delete, { id: created.id })) as { deleted: string };
    assert.equal(deleted.deleted, created.id);

    const listed = (await exec(tools.schedule_list, {})) as { schedules: any[] };
    assert.equal(listed.schedules.length, 0);
  });

  it("updates a schedule timing", async () => {
    const tools = buildScheduleTools(CONV_ID + "-sched-upd");
    const exec = (t: any, args: Record<string, unknown>) => t.execute(args);

    const created = (await exec(tools.schedule_create, {
      prompt: "Old",
      title: "Update test",
      after_seconds: 60,
    })) as { id: string; next_delivery: number };

    const updated = (await exec(tools.schedule_update, {
      id: created.id,
      prompt: "New prompt",
      every_seconds: 300,
    })) as { id: string; title: string; next_delivery: number };
    assert.equal(updated.id, created.id);
    assert.ok(updated.next_delivery >= created.next_delivery); // might be same second
  });
});
