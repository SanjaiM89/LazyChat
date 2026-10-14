/**
 * Action-tool tests: the agent acting on what the graph shows (Track 1).
 *
 * Writes are MERGE-keyed and linked; every test cleans up the nodes it
 * creates so the shared graph stays pristine.
 *
 * Run: `npm run test:brain`
 */
import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_FORCE_MOCK = "1";

import { askAgent } from "../../lib/brain/agent";
import { FalkorClient } from "../../lib/brain/graph";
import { coerceNode } from "../../lib/brain/graph";
import { execute } from "../../lib/brain/tools";

const CREATED: string[] = [];
const SESSIONS: string[] = [];

function trackSession(sid: string): string {
  SESSIONS.push(sid);
  return sid;
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
  if (CREATED.length > 0) {
    const ids = CREATED.splice(0);
    await client.write("MATCH (n) WHERE n.id IN $ids DETACH DELETE n", { ids });
  }
  // Procedures the suite's own runs learned (never the seeded system ones).
  await client.write("MATCH (p:ProceduralMemory) WHERE p.user_id = 'action' DETACH DELETE p", {});
  // Concepts only exist when remember_fact created them (never seeded).
  await client.write("MATCH (c:Concept) DETACH DELETE c", {});
});

after(async () => {
  // Release the graph socket so the runner can exit.
  await (await FalkorClient.get()).close();
});

async function ticketStatus(key: string): Promise<string | null> {
  const client = await FalkorClient.get();
  const rows = await client.query<{ status: string }>("MATCH (t:Ticket {key: $key}) RETURN t.status AS status", {
    key,
  });
  return rows[0]?.status ?? null;
}

describe("create_ticket", () => {
  it("files a linked ticket with the next free key", async () => {
    const client = await FalkorClient.get();
    const res = await execute("create_ticket", client, {
      title: "Test ticket from suite",
      service: "auth",
      priority: "p1",
      assignee: "Priya Raghavan",
    });
    assert.equal(res.ok, true);
    const key = (res.data as { key: string }).key;
    assert.match(key, /^MER-\d+$/);
    CREATED.push(`ticket:${key}`);
    assert.equal(await ticketStatus(key), "open");
    assert.match(res.summary, /assigned to Priya Raghavan/);
    assert.ok(res.nodes.some((n) => n.id === `ticket:${key}`));
  });
});

describe("update_ticket", () => {
  it("closes a ticket and reopens it", async () => {
    const client = await FalkorClient.get();
    const created = await execute("create_ticket", client, { title: "Flaky test ticket" });
    const key = (created.data as { key: string }).key;
    CREATED.push(`ticket:${key}`);

    const closed = await execute("update_ticket", client, { key, status: "done" });
    assert.equal(closed.ok, true);
    assert.equal(await ticketStatus(key), "done");

    const reopened = await execute("update_ticket", client, { key, status: "open" });
    assert.equal(reopened.ok, true);
    assert.equal(await ticketStatus(key), "open");
  });

  it("refuses an unknown key", async () => {
    const client = await FalkorClient.get();
    const res = await execute("update_ticket", client, { key: "MER-9999", status: "done" });
    assert.equal(res.ok, false);
  });
});

describe("record_decision", () => {
  it("stores rationale, decider and service links", async () => {
    const client = await FalkorClient.get();
    const res = await execute("record_decision", client, {
      title: "Test suite picks Postgres",
      rationale: "Transactions beat scale-out for ledger writes.",
      decided_by: "Dan Osei",
      topics: ["database", "suite"],
      services: ["ledger-service"],
    });
    assert.equal(res.ok, true);
    const nodeId = (res.data as { node_id: string }).node_id;
    CREATED.push(nodeId);
    const rows = await client.query<{ topics: string[] }>(
      "MATCH (d:Decision {id: $id}) RETURN d.topics AS topics",
      { id: nodeId },
    );
    assert.deepEqual(rows[0].topics, ["database", "suite"]);
    const decider = await client.query<{ n: number }>(
      "MATCH (:Decision {id: $id})-[:DECIDED_BY]->(p:Person) RETURN count(p) AS n",
      { id: nodeId },
    );
    assert.equal(Number(decider[0].n), 1);
  });
});

describe("note_knowledge", () => {
  it("writes the KNOWS_ABOUT edge", async () => {
    const client = await FalkorClient.get();
    const res = await execute("note_knowledge", client, {
      person: "Priya Raghavan",
      service: "ledger-service",
      level: "expert",
    });
    assert.equal(res.ok, true);
    const rows = await client.query<{ level: string }>(
      "MATCH (:Person {id: 'person:priya'})-[k:KNOWS_ABOUT]->(:Service {id: 'service:ledger'}) RETURN k.level AS level",
    );
    assert.equal(rows[0]?.level, "expert");
    // The suite created this edge (it is not seeded) — remove it again.
    await client.write(
      "MATCH (:Person {id: 'person:priya'})-[k:KNOWS_ABOUT]->(:Service {id: 'service:ledger'}) DELETE k",
    );
  });
});

describe("remember_fact", () => {
  it("maps new concepts and links existing nodes", async () => {
    const client = await FalkorClient.get();
    const res = await execute("remember_fact", client, {
      subject: "SuiteCache",
      predicate: "speeds up",
      object: "auth-service",
    });
    assert.equal(res.ok, true);
    const data = res.data as { subject_id: string; object_id: string; relationship: string };
    assert.equal(data.object_id, "service:auth");
    assert.equal(data.relationship, "SPEEDS_UP");
    CREATED.push(data.subject_id);
    const back = await client.query<{ n: unknown }>(
      "MATCH (a {id: $src})-[r:SPEEDS_UP]->(b {id: $dst}) RETURN a AS n",
      { src: data.subject_id, dst: "service:auth" },
    );
    assert.ok(coerceNode(back[0]?.n));
  });
});

describe("agent acts end to end (mock planner)", () => {
  it("files a ticket from a plain request", async () => {
    const res = await askAgent("File a p1 ticket: auth login is timing out for everyone", {
      sessionId: trackSession(`session:action-suite:${Math.random().toString(16).slice(2, 10)}`),
      userId: "action",
      multiAgent: true,
    });
    assert.equal(res.intent, "graph");
    assert.ok(res.reasoning_trace.some((s) => s.tool === "create_ticket"));
    // The answer may cite other tickets too — identify the filed one by its
    // unmistakable title, never by first-match on the prose.
    const client = await FalkorClient.get();
    const rows = await client.query<{ id: string }>(
      "MATCH (t:Ticket) WHERE t.title CONTAINS 'timing out' RETURN t.id AS id",
    );
    assert.ok(rows.length > 0, "filed ticket should exist");
    for (const r of rows) CREATED.push(r.id);
    assert.ok(/MER-\d+/.test(res.answer));
  });

  it("remembers an open fact from a plain request", async () => {
    const res = await askAgent("Remember that the gateway uses Redis for rate limits", {
      sessionId: trackSession(`session:action-suite:${Math.random().toString(16).slice(2, 10)}`),
      userId: "action",
      multiAgent: true,
    });
    assert.ok(res.reasoning_trace.some((s) => s.tool === "remember_fact"));
  });
});
