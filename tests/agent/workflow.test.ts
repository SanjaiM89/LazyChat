import { test } from "node:test";
import assert from "node:assert/strict";

import { runWorkflowScript, validateSchema } from "@/lib/agent/workflow";

function hooks(agentImpl?: (prompt: string) => Promise<unknown>) {
  const notes: string[] = [];
  return {
    notes,
    hooks: {
      agent: agentImpl ?? (async (prompt: string) => `answer:${prompt}`),
      note: (_kind: "phase" | "log", message: string) => {
        notes.push(message);
      },
    },
  };
}

test("a script calls the agent hook and returns a value", async () => {
  const { hooks: h } = hooks();
  const result = await runWorkflowScript(
    `(async () => { const a = await agent("look at this"); return { got: a }; })()`,
    {},
    h,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { got: "answer:look at this" });
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].prompt, "look at this");
});

test("the script has no filesystem, process or require", async () => {
  const { hooks: h } = hooks();
  const result = await runWorkflowScript(
    `(async () => ({ process: typeof process, require: typeof require, fs: typeof require === "function" }))()`,
    {},
    h,
  );
  assert.equal(result.ok, true);
  const value = result.value as Record<string, unknown>;
  assert.equal(value.process, "undefined");
  assert.equal(value.require, "undefined");
});

test("args reach the script", async () => {
  const { hooks: h } = hooks();
  const result = await runWorkflowScript(`(async () => args.files)()`, { files: ["a", "b"] }, h);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, ["a", "b"]);
});

test("pipeline runs every item through every stage", async () => {
  const { hooks: h } = hooks();
  // The first stage's `prev` is the item itself; later stages get the
  // previous stage's result.
  const result = await runWorkflowScript(
    `(async () => pipeline([1, 2, 3],
        async (prev, item) => prev + item,
        async (prev) => prev * 10))()`,
    {},
    h,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, [20, 40, 60]);
});

test("a stage that throws drops its item and skips the rest", async () => {
  const { hooks: h } = hooks();
  const result = await runWorkflowScript(
    `(async () => pipeline([1, 2],
        async (prev, item) => { if (item === 1) throw new Error("nope"); return prev; },
        async (prev) => { throw new Error("never reached"); }))()`,
    {},
    h,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, [null, null]);
});

test("parallel runs the thunks and waits for all of them", async () => {
  const { hooks: h } = hooks();
  const result = await runWorkflowScript(
    `(async () => parallel([async () => 1, async () => { throw new Error("x"); }, async () => 3]))()`,
    {},
    h,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, [1, null, 3]);
});

test("a misused hook ends the script", async () => {
  const { hooks: h } = hooks();
  const result = await runWorkflowScript(`(async () => pipeline("not an array"))()`, {}, h);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /array/);
});

test("phases and logs are collected", async () => {
  const { hooks: h, notes } = hooks();
  const result = await runWorkflowScript(
    `(async () => { phase("first"); log("hello"); return 1; })()`,
    {},
    h,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(notes, ["first", "hello"]);
});

test("the schema subset validates what it should", () => {
  const schema = {
    type: "object",
    required: ["name"],
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      count: { type: "integer" },
      kind: { enum: ["a", "b"] },
      tags: { type: "array", items: { type: "string" } },
    },
  };
  assert.equal(validateSchema({ name: "x", count: 2, kind: "a", tags: ["t"] }, schema), null);
  assert.match(validateSchema({}, schema) ?? "", /name/);
  assert.match(validateSchema({ name: "x", extra: 1 }, schema) ?? "", /not allowed/);
  assert.match(validateSchema({ name: "x", count: 1.5 }, schema) ?? "", /integer/);
  assert.match(validateSchema({ name: "x", kind: "c" }, schema) ?? "", /one of/);
  assert.match(validateSchema({ name: "x", tags: [1] }, schema) ?? "", /string/);
});

test("oneOf accepts a value that fits any branch", () => {
  const schema = { oneOf: [{ type: "string" }, { type: "number" }] };
  assert.equal(validateSchema("x", schema), null);
  assert.equal(validateSchema(4, schema), null);
  assert.match(validateSchema({ a: 1 }, schema) ?? "", /matches none/);
});
