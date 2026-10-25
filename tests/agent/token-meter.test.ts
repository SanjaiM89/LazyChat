/**
 * The token meter.
 *
 * The measurement is deterministic: the same messages always cost the same,
 * with no model call in the way. Compaction, the occupancy readout and the
 * telemetry read the same figures, so they cannot disagree.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CHARS_PER_TOKEN,
  contextPressure,
  estimateTokens,
  measureMessages,
  measureText,
  measureValue,
  MESSAGE_OVERHEAD_TOKENS,
} from "@/lib/agent/token-meter";

describe("measuring text", () => {
  it("counts roughly four characters to a token", () => {
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("abcde"), 2);
    assert.equal(estimateTokens(""), 0);
    assert.equal(estimateTokens("a"), 1);
  });

  it("measures the characters and the tokens together", () => {
    const measured = measureText("x".repeat(400));
    assert.equal(measured.chars, 400);
    assert.equal(measured.tokens, 400 / CHARS_PER_TOKEN);
  });

  it("measures a value by its JSON", () => {
    const measured = measureValue({ a: 1, b: "two" });
    assert.ok(measured.chars > 0);
    assert.ok(measured.tokens > 0);
    assert.deepEqual(measureValue(undefined), { chars: 0, tokens: 0 });
  });
});

describe("measuring messages", () => {
  it("adds the framing of every message", () => {
    const measured = measureMessages([{ role: "user", content: "abcd" }]);
    assert.equal(measured.breakdown.length, 1);
    assert.equal(measured.breakdown[0].tokens, 1 + MESSAGE_OVERHEAD_TOKENS);
    assert.equal(measured.tokens, 1 + MESSAGE_OVERHEAD_TOKENS);
  });

  it("reads the text of a model message", () => {
    const measured = measureMessages([{ role: "assistant", content: "x".repeat(40) }]);
    assert.equal(measured.breakdown[0].chars, 40);
  });

  it("reads the text of a UI message", () => {
    const measured = measureMessages([
      { role: "user", parts: [{ type: "text", text: "x".repeat(40) }] },
    ]);
    assert.equal(measured.breakdown[0].chars, 40);
  });

  it("reads a tool result's payload", () => {
    const measured = measureMessages([
      {
        role: "tool",
        parts: [{ type: "tool-result", output: { text: "y".repeat(80) } }],
      },
    ]);
    assert.ok(measured.breakdown[0].chars > 0);
  });

  it("is the same every time", () => {
    const messages = [{ role: "user", content: "hello world" }];
    assert.deepEqual(measureMessages(messages), measureMessages(messages));
  });

  it("measures an empty set as nothing", () => {
    assert.deepEqual(measureMessages([]), { chars: 0, tokens: 0, breakdown: [] });
  });
});

describe("the context pressure", () => {
  it("reports how full the window is", () => {
    const pressure = contextPressure(50_000, "sarvam", "sarvam-105b");
    assert.ok(pressure.window > 0);
    assert.ok(pressure.ratio > 0);
    assert.equal(pressure.overBudget, pressure.inputTokens + pressure.headroomTokens > pressure.window);
  });

  it("says when the request cannot fit", () => {
    const pressure = contextPressure(10_000_000, "sarvam", "sarvam-105b");
    assert.equal(pressure.overBudget, true);
    assert.equal(pressure.remainingTokens, 0);
  });

  it("leaves room for the answer", () => {
    const pressure = contextPressure(0, "sarvam", "sarvam-105b", { headroomTokens: 1000 });
    assert.equal(pressure.headroomTokens, 1000);
    assert.equal(pressure.remainingTokens, pressure.window - 1000);
  });
});
