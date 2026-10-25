#!/usr/bin/env node
/**
 * A fake language server: it speaks just enough LSP over stdio to answer the
 * questions the client asks.
 */
import fs from "node:fs";

let buffer = Buffer.alloc(0);

function send(id, result) {
  const body = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function handle(message) {
  if (message.method === "initialize") {
    send(message.id, { capabilities: { textDocument: { definition: {} } } });
    return;
  }
  if (message.method === "textDocument/definition") {
    send(message.id, [
      {
        uri: "file:///workspace/answer.ts",
        range: {
          start: { line: 9, character: 2 },
          end: { line: 9, character: 20 },
        },
      },
    ]);
    return;
  }
  if (message.method === "textDocument/references") {
    send(message.id, [
      { uri: "file:///workspace/answer.ts", range: { start: { line: 9, character: 2 }, end: { line: 9, character: 8 } } },
      { uri: "file:///workspace/other.ts", range: { start: { line: 3, character: 0 }, end: { line: 3, character: 4 } } },
    ]);
    return;
  }
  if (message.method === "textDocument/hover") {
    send(message.id, { contents: { kind: "markdown", value: "the answer" } });
    return;
  }
  if (message.method === "textDocument/implementation") {
    send(message.id, []);
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    try {
      handle(JSON.parse(body));
    } catch {
      /* ignore a frame we cannot read */
    }
  }
});

// The client opens the file before asking about it.
process.on("exit", () => {
  try {
    fs.statSync("/workspace");
  } catch {
    /* nothing to do */
  }
});
