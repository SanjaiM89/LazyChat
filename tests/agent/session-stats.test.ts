/**
 * The session figures, outline, title and export.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { buildTurnOutline, computeSessionStats } from "@/lib/agent/session-stats";
import { fallbackTitle, foldSessionTitle } from "@/lib/agent/session-title";
import { buildSessionArchive } from "@/lib/agent/session-export";
import type { SessionEvent } from "@/lib/agent/session";

let seq = 0;
function event(type: string, data: Record<string, unknown>, at: number): SessionEvent {
  seq += 1;
  return {
    id: seq,
    conversation_id: "conv-1",
    run_id: "run-1",
    seq,
    type: type as SessionEvent["type"],
    data: data as Record<string, unknown>,
    created_at: at,
  };
}

function session(): SessionEvent[] {
  return [
    event("turn/start", {}, 1_000),
    event("user/message", { text: "Please wire the workspace into the chat" }, 1_010),
    event("step/start", { step: 1 }, 1_020),
    event("tool/call", { tool: "ws_read", toolCallId: "call-1" }, 1_030),
    event("tool/result", { tool: "ws_read", toolCallId: "call-1", status: "completed" }, 1_080),
    event("step/end", { step: 1, llm_ms: 900, ttft_ms: 300 }, 1_120),
    event("assistant/message", { text: "The workspace is wired in." }, 1_130),
    event("turn/end", { status: "done" }, 1_140),
  ];
}

describe("the session figures", () => {
  it("counts the turns, steps and tools", () => {
    const stats = computeSessionStats(session());
    assert.equal(stats.turns, 1);
    assert.equal(stats.steps, 1);
    assert.equal(stats.llmMs, 900);
    assert.equal(stats.ttftMs, 300);
    assert.equal(stats.ttftSteps, 1);
    assert.equal(stats.decodeMs, 600);
  });

  it("measures the tool wall time from the call to the result", () => {
    const stats = computeSessionStats(session());
    assert.equal(stats.toolMs, 50);
  });

  it("counts the output tokens of the answers", () => {
    const stats = computeSessionStats(session());
    assert.ok(stats.decodeTokens > 0);
  });

  it("is zero for an empty session", () => {
    const stats = computeSessionStats([]);
    assert.equal(stats.turns, 0);
    assert.equal(stats.steps, 0);
    assert.equal(stats.llmMs, 0);
  });
});

describe("the turn outline", () => {
  it("names the intent, the tools and the outcome of a turn", () => {
    const turns = buildTurnOutline(session());
    assert.equal(turns.length, 1);
    assert.match(turns[0].intent, /wire the workspace/);
    assert.deepEqual(turns[0].tools, ["ws_read"]);
    assert.equal(turns[0].status, "done");
    assert.match(turns[0].summary, /wired in/);
  });
});

describe("the session title", () => {
  it("comes from the first eligible message", () => {
    const title = foldSessionTitle(session());
    assert.equal(title, "Please wire the workspace into the chat");
  });

  it("is capped to the leading words", () => {
    assert.equal(fallbackTitle("one two three four five six seven eight nine", 3, 96), "one two three");
  });

  it("is capped to the byte budget", () => {
    const title = fallbackTitle("alpha beta gamma delta", 8, 11);
    assert.ok(Buffer.byteLength(title, "utf8") <= 11);
  });

  it("lets a title the user set win", () => {
    const events = [...session(), event("session/title", { title: "My own title", source: "user" }, 2_000)];
    assert.equal(foldSessionTitle(events), "My own title");
  });

  it("is empty when the session has no eligible message", () => {
    assert.equal(foldSessionTitle([event("turn/start", {}, 1)]), null);
  });
});

describe("the session export", () => {
  it("carries the conversation, the log and a transcript", () => {
    const archive = buildSessionArchive({
      conversationId: "conv-1",
      title: "Workspace work",
      messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      events: session(),
    });
    assert.deepEqual(archive.entries, ["session.json", "events.jsonl", "transcript.md"]);
    assert.ok(archive.data.length > 0);
    assert.match(archive.filename, /^Workspace-work-\d{4}-\d{2}-\d{2}\.zip$/);

    // The archive is a real zip: the local header is there.
    assert.equal(archive.data.readUInt32LE(0), 0x04034b50);
  });

  it("writes an archive that can be read back", () => {
    const archive = buildSessionArchive({
      conversationId: "conv-1",
      title: "t",
      messages: [],
      events: session(),
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omnia-export-"));
    const file = path.join(dir, "out.zip");
    fs.writeFileSync(file, archive.data);
    const bytes = fs.readFileSync(file);
    // The end-of-central-directory record closes the archive.
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(end > 0, "the archive has no end record");
    assert.equal(bytes.readUInt32LE(end), 0x06054b50);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
