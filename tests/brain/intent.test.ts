/**
 * Conversational robustness tests (port of `backend/tests/test_intent.py`).
 *
 * The product fails if it only answers graph queries. A greeting, a "what can
 * you do?", a ticket key typed bare, or a time question must each get an
 * honest, useful reply — never a flat graph denial.
 *
 * These tests run against the live FalkorDB graph with the deterministic mock
 * LLM, exactly like the Python suite (which sets `LLM_FORCE_MOCK=1`).
 *
 * Run: `npm run test:brain`
 */
import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_FORCE_MOCK = "1";

import { askAgent } from "../../lib/brain/agent";
import { FalkorClient } from "../../lib/brain/graph";
import { schemaSummary } from "../../lib/brain/cypher";
import {
  CAPABILITY,
  CONVERSATIONAL,
  GRAPH,
  capabilityReply,
  classify,
  isClearlyOutOfScope,
} from "../../lib/brain/intent";

const SESSIONS: string[] = [];

function track(sessionId: string): string {
  SESSIONS.push(sessionId);
  return sessionId;
}

function freshSession(prefix = "conv-suite"): string {
  return track(`session:${prefix}:${Math.random().toString(16).slice(2, 10)}`);
}

afterEach(async () => {
  const client = await FalkorClient.get();
  while (SESSIONS.length > 0) {
    const sid = SESSIONS.pop() as string;
    // Neighbours first: the property sweep below removes the Session node,
    // after which its edge-hung Turns would be unreachable.
    await client.write("MATCH (s:Session {id: $sid}) OPTIONAL MATCH (s)-[]-(t) DETACH DELETE s, t", {
      sid,
    });
    await client.write("MATCH (n) WHERE n.session_id = $sid OR n.id = $sid DETACH DELETE n", { sid });
  }
  // Procedures the suite's own runs learned (never the seeded system ones).
  await client.write("MATCH (p:ProceduralMemory) WHERE p.user_id = 'conv' DETACH DELETE p", {});
});

after(async () => {
  // Release the graph socket so the runner can exit.
  await (await FalkorClient.get()).close();
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe("classify", () => {
  const cases: Array<[string, string]> = [
    ["hi", CONVERSATIONAL],
    ["hey", CONVERSATIONAL],
    ["good morning", CONVERSATIONAL],
    ["thanks", CONVERSATIONAL],
    ["thank you", CONVERSATIONAL],
    ["bye", CONVERSATIONAL],
    ["what can you do?", CAPABILITY],
    ["who are you?", CAPABILITY],
    ["help", CAPABILITY],
    ["MER-1001", GRAPH],
    ["ticket:MER-1001", GRAPH],
    ["auth", GRAPH],
    ["Which tickets are blocked?", GRAPH],
  ];
  for (const [text, kind] of cases) {
    it(`classifies ${JSON.stringify(text)} as ${kind}`, () => {
      assert.equal(classify(text).kind, kind);
    });
  }
});

describe("out-of-scope detection", () => {
  it("flags time/poem/weather questions", () => {
    for (const q of ["what time is it", "write me a poem about cats", "what's the weather"]) {
      assert.ok(isClearlyOutOfScope(q), q);
    }
    assert.ok(!isClearlyOutOfScope("Who knows the auth system?"));
  });
});

describe("capability reply", () => {
  it("is built from the live graph", async () => {
    const client = await FalkorClient.get();
    const text = capabilityReply(await schemaSummary(client));
    assert.ok(text.includes("FalkorDB"));
    assert.ok(text.includes("Ticket 30"), "live counts should be visible");
    assert.ok(text.includes("Which tickets are blocked"));
  });
});

// ---------------------------------------------------------------------------
// End-to-end behaviour
// ---------------------------------------------------------------------------

describe("greetings", () => {
  for (const text of ["hi", "hello", "thanks", "bye"]) {
    it(`${JSON.stringify(text)} gets a fixed answer without any tool`, async () => {
      const res = await askAgent(text, {
        sessionId: freshSession(),
        userId: "conv",
        multiAgent: true,
      });
      assert.deepEqual(res.reasoning_trace, [], "greetings must burn no tool calls");
      assert.equal(res.intent, "conversational");
      assert.ok(!res.answer.toLowerCase().includes("could not find"));
    });
  }
});

describe("capability question", () => {
  it("reflects the live graph", async () => {
    const res = await askAgent("what can you do?", {
      sessionId: freshSession(),
      userId: "conv",
      multiAgent: true,
    });
    assert.deepEqual(res.reasoning_trace, []);
    assert.equal(res.intent, "capability");
    assert.ok(res.answer.includes("FalkorDB"));
  });
});

describe("out-of-scope", () => {
  it("refuses clearly", async () => {
    const res = await askAgent("what time is it", {
      sessionId: freshSession(),
      userId: "conv",
      multiAgent: true,
    });
    assert.deepEqual(res.reasoning_trace, []);
    assert.equal(res.intent, "out_of_scope");
    assert.ok(!res.answer.toLowerCase().includes("could not find"));
    assert.ok(res.answer.includes("engineering org"));
  });
});

describe("no evidence", () => {
  it("does not hallucinate", async () => {
    const res = await askAgent("Which notebooks are stored in the voicemail service?", {
      sessionId: freshSession(),
      userId: "conv",
      multiAgent: true,
    });
    assert.ok(res.answer);
    assert.ok(
      !res.answer.toLowerCase().includes("could not find"),
      "a flat denial is the wrong reply to a sincere question",
    );
  });
});

describe("single pass", () => {
  it("never denies when evidence exists", async () => {
    const res = await askAgent("tell me about the payments system", {
      sessionId: freshSession(),
      userId: "conv",
      multiAgent: false,
    });
    assert.ok(res.answer);
  });
});
