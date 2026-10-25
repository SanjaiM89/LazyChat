import { test } from "node:test";
import assert from "node:assert/strict";

// Must come first: it points the database at a throwaway file.
import { TEST_DB_PATH as dbPath } from "./setup";
import {
  createTask,
  getTask,
  isTaskReady,
  listTasks,
  updateTask,
  waitForTeam,
} from "@/lib/agent/teams";
import { after } from "node:test";
import fs from "node:fs";

const conversationId = "team-test";

function newTask(subject: string, blockedBy?: string[]) {
  return createTask({
    conversationId,
    subject,
    description: `details for ${subject}`,
    blockedBy,
  });
}

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* not there */
    }
  }
});

test("a new task is pending, unowned and at revision 1", () => {
  const task = newTask("write the report");
  assert.equal(task.status, "pending");
  assert.equal(task.ownerName, undefined);
  assert.equal(task.revision, 1);
  assert.equal(task.subject, "write the report");
});

test("claiming a task takes it and bumps the revision", () => {
  const task = newTask("claim me");
  const result = updateTask({
    conversationId,
    taskId: task.id,
    expectedRevision: task.revision,
    action: "claim",
    owner: "auditor",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.task.status, "in_progress");
  assert.equal(result.task.ownerName, "auditor");
  assert.equal(result.task.revision, 2);
});

test("a stale revision is refused and the current state comes back", () => {
  const task = newTask("stale");
  const first = updateTask({
    conversationId,
    taskId: task.id,
    expectedRevision: task.revision,
    action: "claim",
    owner: "auditor",
  });
  assert.equal(first.ok, true);

  const stale = updateTask({
    conversationId,
    taskId: task.id,
    expectedRevision: task.revision, // the revision from before the claim
    action: "complete",
  });
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.match(stale.error, /revision/);
  assert.equal(stale.current?.revision, 2);
});

test("releasing a task frees it again", () => {
  const task = newTask("release me");
  updateTask({
    conversationId,
    taskId: task.id,
    expectedRevision: task.revision,
    action: "claim",
    owner: "auditor",
  });
  const released = updateTask({
    conversationId,
    taskId: task.id,
    expectedRevision: task.revision + 1,
    action: "release",
  });
  assert.equal(released.ok, true);
  if (!released.ok) return;
  assert.equal(released.task.status, "pending");
  assert.equal(released.task.ownerName, undefined);
});

test("completing a task finishes it", () => {
  const task = newTask("finish me");
  const done = updateTask({
    conversationId,
    taskId: task.id,
    expectedRevision: task.revision,
    action: "complete",
  });
  assert.equal(done.ok, true);
  if (!done.ok) return;
  assert.equal(done.task.status, "completed");
});

test("a blocked task is not ready until its blocker is done", () => {
  const blocker = newTask("blocker");
  const blocked = newTask("blocked", [blocker.id]);
  assert.equal(isTaskReady(blocker), true);
  assert.equal(isTaskReady(blocked), false);

  updateTask({
    conversationId,
    taskId: blocker.id,
    expectedRevision: blocker.revision,
    action: "complete",
  });
  assert.equal(isTaskReady(getTask(blocked.id)!), true);
});

test("the board can be filtered and read", () => {
  const task = newTask("filter me");
  updateTask({
    conversationId,
    taskId: task.id,
    expectedRevision: task.revision,
    action: "claim",
    owner: "auditor",
  });

  const inProgress = listTasks({ status: "in_progress" });
  assert.ok(inProgress.some((row) => row.id === task.id));

  const owned = listTasks({ owner: "auditor" });
  assert.ok(owned.some((row) => row.id === task.id));

  const unowned = listTasks({ owner: "unowned" });
  assert.ok(!unowned.some((row) => row.id === task.id));

  const read = getTask(task.id);
  assert.ok(read);
  assert.equal(read.ownerName, "auditor");
});

test("waiting with nobody working answers at once", async () => {
  const result = await waitForTeam("empty-team", 5000);
  assert.equal(result.progress, false);
  assert.match(result.reason ?? "", /No other Team member/);
});
