import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  COMPACT_THRESHOLD_RATIO,
  contextWindow,
  isContextOverflow,
  isImageBudgetError,
  MIN_KEEP_MESSAGES,
  offloadImages,
  planCompaction,
  pruneText,
  pruneToolResult,
  pressureRatio,
  shouldCompact,
} from "@/lib/agent/compaction";
import { readSpill, spillText } from "@/lib/agent/spill";

test("a short result is not pruned", () => {
  const text = "x".repeat(100);
  assert.equal(pruneText(text), text);
});

test("a long result keeps its head and tail", () => {
  const text = "a".repeat(5000) + "b".repeat(5000);
  const pruned = pruneText(text);
  assert.ok(pruned.length < text.length);
  assert.ok(pruned.startsWith("a".repeat(100)));
  assert.ok(pruned.endsWith("b".repeat(100)));
  assert.match(pruned, /pruned/);
});

test("pruning keeps the shape of a result", () => {
  const result = { count: 2, rows: ["x".repeat(9000), "short"] };
  const pruned = pruneToolResult(result) as { count: number; rows: string[] };
  assert.equal(pruned.count, 2);
  assert.equal(pruned.rows.length, 2);
  assert.ok(pruned.rows[0].length < 9000);
  assert.equal(pruned.rows[1], "short");
});

test("pressure decides whether to compact", () => {
  const window = contextWindow("sarvam", "sarvam-105b");
  assert.ok(window > 0);
  // A tenth of the window is nowhere near the threshold; nine tenths is over it.
  assert.equal(shouldCompact(Math.floor(window * 0.1), "sarvam", "sarvam-105b"), false);
  assert.equal(shouldCompact(Math.floor(window * 0.9), "sarvam", "sarvam-105b"), true);
  assert.equal(pressureRatio(0, "sarvam", "sarvam-105b"), 0);
  assert.ok(COMPACT_THRESHOLD_RATIO > 0);
});

test("the compaction cut lands on a user boundary", () => {
  const messages = [
    { role: "user", parts: [{ type: "text", text: "1" }] },
    { role: "assistant", parts: [{ type: "text", text: "2" }] },
    { role: "user", parts: [{ type: "text", text: "3" }] },
    { role: "assistant", parts: [{ type: "text", text: "4" }] },
    { role: "user", parts: [{ type: "text", text: "5" }] },
    { role: "assistant", parts: [{ type: "text", text: "6" }] },
    { role: "user", parts: [{ type: "text", text: "7" }] },
    { role: "assistant", parts: [{ type: "text", text: "8" }] },
    { role: "user", parts: [{ type: "text", text: "9" }] },
    { role: "assistant", parts: [{ type: "text", text: "10" }] },
  ] as any;
  const plan = planCompaction(messages);
  assert.ok(plan);
  assert.equal(messages[plan.cut].role, "user");
  assert.ok(plan.kept >= MIN_KEEP_MESSAGES);
});

test("a short conversation is not compacted", () => {
  const messages = [
    { role: "user", parts: [{ type: "text", text: "1" }] },
    { role: "assistant", parts: [{ type: "text", text: "2" }] },
  ] as any;
  assert.equal(planCompaction(messages), null);
});

test("a context-window error is recognized", () => {
  assert.equal(isContextOverflow(new Error("This model's maximum context length is 8192 tokens")), true);
  assert.equal(isContextOverflow(new Error("prompt is too long: 300000 tokens > 200000")), true);
  assert.equal(isContextOverflow(new Error("connection reset")), false);
  assert.equal(isContextOverflow(undefined), false);
});

test("an image-budget error is recognized", () => {
  assert.equal(isImageBudgetError(new Error("image exceeds the image budget for this model")), true);
  assert.equal(isImageBudgetError(new Error("rate limited")), false);
});

test("offloading replaces the oldest images", () => {
  const messages = [
    { role: "user", content: [{ type: "image", image: "a" }] },
    { role: "user", content: [{ type: "image", image: "b" }] },
  ] as any;
  const { messages: next, offloaded } = offloadImages(messages, 0);
  assert.equal(offloaded, 2);
  const first = next[0].content as any[];
  assert.equal(first[0].type, "text");
  assert.match(first[0].text, /image removed/);
});

test("offloading keeps the newest images when asked", () => {
  const messages = [
    { role: "user", content: [{ type: "image", image: "a" }] },
    { role: "user", content: [{ type: "image", image: "b" }] },
  ] as any;
  const { messages: next, offloaded } = offloadImages(messages, 1);
  assert.equal(offloaded, 1);
  assert.equal((next[0].content as any[])[0].type, "text");
  assert.equal((next[1].content as any[])[0].type, "image");
});

test("a large result is spilled to a file and read back", () => {
  const text = "z".repeat(25_000);
  const spilled = spillText("conv-spill-test", text, { thresholdChars: 20_000 });
  assert.ok(spilled);
  assert.equal(spilled.chars, 25_000);
  assert.ok(spilled.preview.length <= 1200);

  const read = readSpill(spilled.path, { maxChars: 100_000 });
  assert.ok(read);
  assert.equal(read.chars, 25_000);
  assert.equal(read.text.length, 25_000);
  assert.equal(read.truncated, false);

  // The default read is capped, and says so.
  const capped = readSpill(spilled.path);
  assert.ok(capped);
  assert.equal(capped.truncated, true);
  assert.equal(capped.text.length, 20_000);
});

test("a small result is not spilled", () => {
  assert.equal(spillText("conv-spill-test", "short", { thresholdChars: 20_000 }), null);
});

test("only spilled files can be read", () => {
  assert.equal(readSpill("/etc/passwd"), null);
  assert.equal(readSpill(path.join(process.cwd(), "package.json")), null);
});
