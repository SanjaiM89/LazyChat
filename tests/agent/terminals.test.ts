import { test } from "node:test";
import assert from "node:assert/strict";

import {
  closeTerminal,
  listTerminals,
  openTerminal,
  readTerminal,
  runInTerminal,
  signalTerminal,
} from "@/lib/agent/terminals";

test("a command runs and its output comes back", async () => {
  const term = openTerminal(process.cwd());
  try {
    const result = await runInTerminal(term.id, "echo hello-from-terminal");
    assert.match(result.output, /hello-from-terminal/);
    assert.equal(result.timedOut, false);
  } finally {
    closeTerminal(term.id);
  }
});

test("the shell keeps its state between commands", async () => {
  const term = openTerminal(process.cwd());
  try {
    await runInTerminal(term.id, "mkdir -p omnia-term-test && cd omnia-term-test");
    const result = await runInTerminal(term.id, "pwd");
    assert.match(result.output, /omnia-term-test/);
  } finally {
    await runInTerminal(term.id, "cd .. && rm -rf omnia-term-test");
    closeTerminal(term.id);
  }
});

test("a failing command reports its output", async () => {
  const term = openTerminal(process.cwd());
  try {
    const result = await runInTerminal(term.id, "echo oops >&2; exit 3");
    assert.match(result.output, /oops/);
  } finally {
    closeTerminal(term.id);
  }
});

test("terminals can be listed, read and closed", async () => {
  const term = openTerminal(process.cwd());
  assert.ok(listTerminals().some((t) => t.id === term.id));
  await runInTerminal(term.id, "echo visible");
  assert.match(readTerminal(term.id).output, /visible/);
  assert.equal(closeTerminal(term.id), true);
  assert.equal(closeTerminal(term.id), false);
});

test("a signal reaches the process", async () => {
  const term = openTerminal(process.cwd());
  try {
    assert.equal(signalTerminal(term.id, "SIGINT"), true);
  } finally {
    closeTerminal(term.id);
  }
});
