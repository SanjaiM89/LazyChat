import { test } from "node:test";
import assert from "node:assert/strict";

import { runCode } from "@/lib/agent/code-runner";

const echoTool = {
  execute: async (args: any) => ({ echoed: args.text ?? null }),
};

const failingTool = {
  execute: async () => {
    throw new Error("the tool refused");
  },
};

test("a program can call a tool and return its result", async () => {
  const result = await runCode(
    `export default async function ({ tools }) {
       const out = await tools.echo({ text: "hello" });
       return out;
     }`,
    { tools: { echo: echoTool } },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { echoed: "hello" });
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].name, "echo");
  assert.equal(result.calls[0].ok, true);
});

test("a program can make several calls", async () => {
  const result = await runCode(
    `export default async function ({ tools }) {
       const a = await tools.echo({ text: "one" });
       const b = await tools.echo({ text: "two" });
       return [a.echoed, b.echoed];
     }`,
    { tools: { echo: echoTool } },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, ["one", "two"]);
  assert.equal(result.calls.length, 2);
});

test("a program that throws is reported, not crashed on", async () => {
  const result = await runCode(
    `export default async function () { throw new Error("boom"); }`,
    { tools: {} },
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /boom/);
});

test("a program that does not compile is reported", async () => {
  const result = await runCode(`export default function ( {`, { tools: {} });
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test("calling a tool that does not exist is reported to the program", async () => {
  const result = await runCode(
    `export default async function ({ tools }) {
       try {
         await tools.nope({});
         return "no error";
       } catch (err) {
         return String(err.message);
       }
     }`,
    { tools: { echo: echoTool } },
  );
  assert.equal(result.ok, true);
  assert.match(String(result.result), /no tool called/);
});

test("a failing tool reports its error without ending the program", async () => {
  const result = await runCode(
    `export default async function ({ tools }) {
       try {
         await tools.boom({});
         return "no error";
       } catch (err) {
         return "caught: " + err.message;
       }
     }`,
    { tools: { boom: failingTool } },
  );
  assert.equal(result.ok, true);
  assert.match(String(result.result), /caught: the tool refused/);
  assert.equal(result.calls[0].ok, false);
});

test("a program that never finishes is stopped", async () => {
  const result = await runCode(
    `export default async function () { await new Promise(() => {}); }`,
    { tools: {}, timeoutMs: 1500 },
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /did not finish/);
});
