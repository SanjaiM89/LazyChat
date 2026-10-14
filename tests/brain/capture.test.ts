/**
 * Auto-capture tests: durable facts land in SemanticMemory without being asked,
 * existence is checked before writing, and renames replace instead of piling up.
 *
 * Run: `npm run test:brain`
 */
import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_FORCE_MOCK = "1";

import { FalkorClient } from "../../lib/brain/graph";
import {
  captureOmniaMemory,
  extractPersonalFacts,
  writeSemanticFact,
} from "../../lib/brain/omnia-memory";
import { recallMemories } from "../../lib/brain/memory/session";
import { execute } from "../../lib/brain/tools";

const CID = `capture-suite:${Math.random().toString(16).slice(2, 10)}`;
const SID = `omnia:${CID}`;

afterEach(async () => {
  const client = await FalkorClient.get();
  await client.write("MATCH (s:Session {id: $sid}) OPTIONAL MATCH (s)-[]-(t) DETACH DELETE s, t", {
    sid: SID,
  });
  await client.write("MATCH (n) WHERE n.session_id = $sid OR n.id = $sid DETACH DELETE n", {
    sid: SID,
  });
  await client.write("MATCH (m:SemanticMemory) WHERE m.source = $sid DETACH DELETE m", { sid: SID });
  await client.write("MATCH (c:Concept) DETACH DELETE c", {});
});

after(async () => {
  await (await FalkorClient.get()).close();
});

describe("extractPersonalFacts", () => {
  it("catches names, even lowercase", () => {
    assert.deepEqual(extractPersonalFacts("my name is jev"), [
      { fact: "The user's name is Jev.", slot: "user.name" },
    ]);
    assert.deepEqual(extractPersonalFacts("Hey, call me Al"), [
      { fact: "The user's name is Al.", slot: "user.name" },
    ]);
  });

  it("ignores lowercase adjectives", () => {
    assert.deepEqual(extractPersonalFacts("i am happy today"), []);
    assert.deepEqual(extractPersonalFacts("call me maybe later"), []);
  });

  it("catches work, role and likes", () => {
    assert.deepEqual(extractPersonalFacts("I work at Acme Corp."), [
      { fact: "The user works at Acme Corp.", slot: "user.work" },
    ]);
    assert.deepEqual(extractPersonalFacts("I'm a backend engineer"), [
      { fact: "The user is a backend engineer.", slot: "user.role" },
    ]);
    assert.deepEqual(extractPersonalFacts("I love dosa"), [
      { fact: "The user likes dosa.", slot: null },
    ]);
  });
});

describe("writeSemanticFact", () => {
  it("stores, dedups and replaces by slot", async () => {
    const client = await FalkorClient.get();
    const first = await writeSemanticFact(client, "omnia", "The user's name is Jev.", SID, "user.name");
    assert.equal(first.stored, true);

    const dup = await writeSemanticFact(client, "omnia", "The user's name is Jev.", SID, "user.name");
    assert.equal(dup.stored, false);
    assert.equal(dup.id, first.id);

    const renamed = await writeSemanticFact(client, "omnia", "The user's name is Jevans.", SID, "user.name");
    assert.equal(renamed.stored, true);
    assert.equal(renamed.replaced, true);

    const rows = await client.query<{ fact: string }>(
      "MATCH (m:SemanticMemory) WHERE m.user_id = 'omnia' AND m.slot = 'user.name' RETURN m.fact AS fact",
    );
    assert.deepEqual(
      rows.map((r) => r.fact),
      ["The user's name is Jevans."],
    );
  });
});

describe("captureOmniaMemory", () => {
  it("makes a volunteered name answerable afterwards", async () => {
    const client = await FalkorClient.get();
    await captureOmniaMemory(CID, "hello, my name is jev");
    const found = await recallMemories(client, "omnia", "what is my name", 6);
    assert.ok(
      found.some((m) => m.summary.includes("Jev")),
      `expected the name in recall, got: ${JSON.stringify(found.map((m) => m.summary))}`,
    );
  });
});

describe("remember_fact existence check", () => {
  it("reports already-known instead of duplicating", async () => {
    const client = await FalkorClient.get();
    const first = await execute("remember_fact", client, {
      subject: "SuiteCache",
      predicate: "speeds up",
      object: "auth-service",
    });
    assert.equal(first.ok, true);
    assert.equal((first.data as { duplicate?: boolean }).duplicate ?? false, false);

    const second = await execute("remember_fact", client, {
      subject: "suitecache",
      predicate: "speeds up",
      object: "auth-service",
    });
    assert.equal(second.ok, true);
    assert.equal((second.data as { duplicate?: boolean }).duplicate, true);
    assert.match(second.summary, /Already known/);

    const edges = await client.query<{ n: number }>(
      "MATCH (:Concept {name: 'SuiteCache'})-[r:SPEEDS_UP]->(:Service {id: 'service:auth'}) RETURN count(r) AS n",
    );
    assert.equal(Number(edges[0].n), 1);
  });
});
