import { test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";

test("appendTurn + readTurns round-trip", async () => {
  const { appendTurn, readTurns, countAllTurns } = await import("@/lib/session-log");
  const convId = "test-conv-roundtrip";
  const logPath = path.join(process.cwd(), "data", "sessions", `${convId}.jsonl`);

  // Clean up from any prior run.
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);

  const seq1 = appendTurn(convId, {
    type: "turn",
    role: "user",
    content: "Hello world",
    ts: Date.now(),
  });
  assert.equal(seq1, 1);

  const seq2 = appendTurn(convId, {
    type: "turn",
    role: "assistant",
    content: "Hi there",
    ts: Date.now(),
  });
  assert.equal(seq2, 2);

  const turns = readTurns(convId);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].content, "Hello world");
  assert.equal(turns[0].role, "user");
  assert.equal(turns[1].content, "Hi there");
  assert.equal(turns[1].role, "assistant");

  // Cleanup
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
  assert.equal(countAllTurns(), 0);
});
