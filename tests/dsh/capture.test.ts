/**
 * Deterministic workspace capture tests: the user's own statements land in
 * workspace memory with no model call, duplicates are skipped, and
 * question-forms never become tasks.
 *
 * Run: `npm run test:brain` (sequential files; live graph required)
 */
import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FalkorClient } from "../../lib/brain/graph";
import { createWorkspace } from "../../lib/dsh/workspaces";
import {
  captureWorkspaceFacts,
  extractWorkspaceFacts,
  listTodos,
  readWorkspaceRecords,
  recallShared,
} from "../../lib/dsh/memory";

const WS_IDS: string[] = [];
const TMPDIRS: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cap-"));
  TMPDIRS.push(dir);
  return dir;
}

afterEach(async () => {
  const client = await FalkorClient.get();
  while (WS_IDS.length > 0) {
    const id = WS_IDS.pop() as string;
    await client.write(
      "MATCH (w:Workspace {id: $id}) OPTIONAL MATCH (w)-[]-(x) DETACH DELETE w, x",
      { id },
    );
    await client.write("MATCH (n) WHERE n.workspace_id = $id DETACH DELETE n", { id });
    await client.write(
      "MATCH (m:SharedMemory) WHERE m.scope = $scope DETACH DELETE m",
      { scope: `workspace:${id}` },
    );
  }
});

after(async () => {
  for (const dir of TMPDIRS.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  await (await FalkorClient.get()).close();
});

describe("extractWorkspaceFacts", () => {
  it("catches explicit remembers", () => {
    const f = extractWorkspaceFacts("Remember that the deploy needs node 22.");
    assert.equal(f.memories.length, 1);
    assert.ok(f.memories[0].text.includes("node 22"));
    assert.deepEqual(f.todos, []);
  });

  it("turns 'remember to' into a todo, not a fact", () => {
    const f = extractWorkspaceFacts("Remember to restart the server after deploy");
    assert.deepEqual(f.todos, ["restart the server after deploy"]);
    assert.deepEqual(f.memories, []);
  });

  it("catches TODO markers and stated decisions", () => {
    const f = extractWorkspaceFacts("TODO: fix the login redirect\nWe decided to use Postgres.");
    assert.deepEqual(f.todos, ["fix the login redirect"]);
    assert.equal(f.decisions.length, 1);
    assert.ok(f.decisions[0].title.toLowerCase().includes("postgres"));
  });

  it("ignores questions and chatter", () => {
    assert.deepEqual(extractWorkspaceFacts("how do I add a todo in linear?").todos, []);
    assert.deepEqual(extractWorkspaceFacts("what did we decide about lunch?").decisions, []);
    assert.deepEqual(extractWorkspaceFacts("remember me on this device").memories, []);
  });
});

describe("captureWorkspaceFacts round trip", () => {
  it("stores memories, todos and decisions with existence checks", async () => {
    const client = await FalkorClient.get();
    const ws = await createWorkspace(client, { name: "Cap WS", path: tmpDir() });
    WS_IDS.push(ws.id);

    const first = await captureWorkspaceFacts(
      client,
      ws.id,
      "Remember that the deploy needs node 22.\nTODO: fix the login redirect\nWe decided to use Postgres.",
    );
    assert.deepEqual(first, { memories: 1, todos: 1, decisions: 1 });

    // Second identical pass stores nothing new.
    const second = await captureWorkspaceFacts(
      client,
      ws.id,
      "Remember that the deploy needs node 22.\nTODO: fix the login redirect\nWe decided to use Postgres.",
    );
    assert.equal(second.todos, 0);
    assert.equal(second.decisions, 0);
    const scoped = await client.query<{ n: number }>(
      "MATCH (m:SharedMemory) WHERE m.scope = $scope RETURN count(m) AS n",
      { scope: `workspace:${ws.id}` },
    );
    assert.equal(Number(scoped[0].n), 1, "no duplicate memory nodes");

    const recalled = await recallShared(client, ws.id, "deploy node");
    assert.ok(recalled.some((m) => m.text.includes("node 22")));

    const todos = await listTodos(client, ws.id);
    assert.equal(todos.filter((t) => t.status !== "done").length, 1);

    const decisions = await readWorkspaceRecords(client, ws.id, "decision");
    assert.equal(decisions.length, 1);
  });
});
