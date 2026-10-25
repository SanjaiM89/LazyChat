import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { TEST_DB_PATH as dbPath } from "./setup";
import { appendEvent } from "@/lib/agent/session";
import { listInterruptedRuns } from "@/lib/agent/recovery";
import { after } from "node:test";

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* not there */
    }
  }
});

test("a run that ended is not interrupted", async () => {
  const conversationId = "recovery-ended";
  const ctx = { conversationId, runId: "run-ended" };
  appendEvent("turn/start", {}, ctx);
  appendEvent("step/start", { step: 1 }, ctx);
  appendEvent("turn/end", { status: "done" }, ctx);
  const interrupted = await listInterruptedRuns(conversationId);
  assert.equal(interrupted.length, 0);
});

test("a run that never ended is interrupted, with the tool that was in flight", async () => {
  const conversationId = "recovery-open";
  const ctx = { conversationId, runId: "run-open" };
  appendEvent("turn/start", {}, ctx);
  appendEvent("user/message", { text: "do the thing" }, ctx);
  appendEvent("step/start", { step: 1 }, ctx);
  appendEvent("tool/call", { tool: "ws_read", toolCallId: "call-1", input: { path: "a.ts" } }, ctx);

  const interrupted = await listInterruptedRuns(conversationId);
  assert.equal(interrupted.length, 1);
  const run = interrupted[0];
  assert.equal(run.runId, "run-open");
  assert.equal(run.conversationId, conversationId);
  assert.equal(run.pendingTool?.name, "ws_read");
  assert.equal(run.pendingTool?.toolCallId, "call-1");
  assert.equal(run.lastUserMessage, "do the thing");
});

test("a tool that answered is not pending", async () => {
  const conversationId = "recovery-answered";
  const ctx = { conversationId, runId: "run-answered" };
  appendEvent("turn/start", {}, ctx);
  appendEvent("tool/call", { tool: "ws_read", toolCallId: "call-1" }, ctx);
  appendEvent("tool/result", { tool: "ws_read", toolCallId: "call-1", status: "completed" }, ctx);

  const interrupted = await listInterruptedRuns(conversationId);
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].pendingTool, undefined);
});

test("several interrupted runs are listed newest first", async () => {
  const conversationId = "recovery-many";
  const older = { conversationId, runId: "run-older" };
  const newer = { conversationId, runId: "run-newer" };
  appendEvent("turn/start", { at: 1 }, older);
  appendEvent("turn/start", { at: 2 }, newer);

  const interrupted = await listInterruptedRuns(conversationId);
  assert.equal(interrupted.length, 2);
  assert.equal(interrupted[0].runId, "run-newer");
});
