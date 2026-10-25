import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { LspClient, serverFor } from "@/lib/agent/lsp";

const fixture = path.join(import.meta.dirname, "fixtures", "fake-lsp.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "omnia-lsp-"));
const sourcePath = path.join(root, "answer.ts");
fs.writeFileSync(sourcePath, "export const answer = 42;\n", "utf8");

function client(): LspClient {
  return new LspClient({ command: process.execPath, args: [fixture] }, root);
}

test("the server for a file is chosen by its extension", () => {
  const servers = { ts: { command: "typescript-language-server", args: ["--stdio"] } };
  assert.equal(serverFor(servers, "/a/b.ts")?.command, "typescript-language-server");
  assert.equal(serverFor(servers, "/a/b.py"), undefined);
});

test("a definition is found and its position is one-based", async () => {
  const lsp = client();
  try {
    const locations = await lsp.query("goToDefinition", sourcePath, 1, 1);
    assert.equal(locations.length, 1);
    assert.equal(locations[0].file, "/workspace/answer.ts");
    assert.equal(locations[0].line, 10);
    assert.equal(locations[0].character, 3);
  } finally {
    await lsp.stop();
  }
});

test("references include the declaration", async () => {
  const lsp = client();
  try {
    const locations = await lsp.query("findReferences", sourcePath, 1, 1);
    assert.equal(locations.length, 2);
    assert.equal(locations[0].file, "/workspace/answer.ts");
    assert.equal(locations[1].file, "/workspace/other.ts");
  } finally {
    await lsp.stop();
  }
});

test("hover returns the text under the cursor", async () => {
  const lsp = client();
  try {
    const locations = await lsp.query("hover", sourcePath, 1, 1);
    assert.equal(locations.length, 1);
    assert.equal(locations[0].text, "the answer");
  } finally {
    await lsp.stop();
  }
});

test("a question about a server that is not there fails clearly", async () => {
  const lsp = new LspClient({ command: "/nonexistent/language-server" }, root);
  try {
    await assert.rejects(() => lsp.query("goToDefinition", sourcePath, 1, 1));
  } finally {
    await lsp.stop();
  }
});
