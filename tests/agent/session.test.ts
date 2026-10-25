import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Must come first: it points the log at a throwaway database.
import { TEST_DB_PATH as dbPath } from "./setup";
import {
  appendEvent,
  listEvents,
  listRunEvents,
  searchEvents,
  latestSeq,
  deleteConversationEvents,
} from "@/lib/agent/session";

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* not there */
    }
  }
});

test("events append in order with a per-conversation sequence", () => {
  const ctx = { conversationId: "conv-1", runId: "run-1" };
  const first = appendEvent("turn/start", { provider: "sarvam" }, ctx);
  const second = appendEvent("tool/call", { tool: "ws_read" }, ctx);

  assert.equal(first.seq, 1);
  assert.equal(second.seq, 2);
  assert.equal(latestSeq("conv-1"), 2);

  const events = listEvents("conv-1");
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "turn/start");
  assert.deepEqual(events[0].data, { provider: "sarvam" });
});

test("sequences are per conversation", () => {
  appendEvent("turn/start", {}, { conversationId: "conv-2" });
  assert.equal(latestSeq("conv-2"), 1);
  assert.equal(latestSeq("conv-1"), 2);
});

test("a run's events can be read on their own", () => {
  appendEvent("step/start", { step: 1 }, { conversationId: "conv-3", runId: "run-x" });
  appendEvent("step/start", { step: 1 }, { conversationId: "conv-3", runId: "run-y" });
  const forRun = listRunEvents("run-x");
  assert.equal(forRun.length, 1);
  assert.equal(forRun[0].run_id, "run-x");
});

test("events can be filtered by type", () => {
  const ctx = { conversationId: "conv-4" };
  appendEvent("tool/call", { tool: "ws_shell" }, ctx);
  appendEvent("tool/result", { tool: "ws_shell" }, ctx);
  const calls = listEvents("conv-4", { types: ["tool/call"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "tool/call");
});

test("the log is searchable", () => {
  const ctx = { conversationId: "conv-5" };
  appendEvent("assistant/message", { text: "the deployment failed on port 8443" }, ctx);
  const hits = searchEvents("8443");
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].conversation_id, "conv-5");
});

test("a malformed query degrades to a substring scan", () => {
  const hits = searchEvents('"unbalanced');
  assert.ok(Array.isArray(hits));
});

test("an oversized payload is cut and marked", () => {
  const ctx = { conversationId: "conv-6" };
  const event = appendEvent("tool/result", { text: "x".repeat(200_000) }, ctx);
  assert.equal(event.data.truncated, true);
});

test("deleting a conversation drops its history", () => {
  const ctx = { conversationId: "conv-7" };
  appendEvent("turn/start", {}, ctx);
  assert.equal(listEvents("conv-7").length, 1);
  deleteConversationEvents("conv-7");
  assert.equal(listEvents("conv-7").length, 0);
});
