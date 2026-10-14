/**
 * Load the synthetic Meridian company dataset into FalkorDB.
 *
 * Usage:
 *   npx tsx scripts/brain-seed.ts              # seed (idempotent MERGE, safe to re-run)
 *   npx tsx scripts/brain-seed.ts --reset      # drop the graph first, then seed
 *   npx tsx scripts/brain-seed.ts --stats      # just print what is in the graph
 *
 * The script is idempotent by design: every write is a MERGE keyed on the `id`
 * property, so re-running it updates rather than duplicates.
 *
 * The dataset lives in `lib/brain/seed-data.json`, exported verbatim from the
 * original `backend/scripts/company_data.py` (since removed) — all data is synthetic.
 */
import { FalkorClient } from "../lib/brain/graph";
import { schemaSummary } from "../lib/brain/cypher";
import { initSchema } from "../lib/brain/schema";
import data from "../lib/brain/seed-data.json";

type Row = Record<string, unknown>;

const BATCH = 250;

function batched<T>(items: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** MERGE rows as nodes of `label`. Each row: {id, ...properties}. */
async function writeNodes(client: FalkorClient, label: string, rows: Row[]): Promise<number> {
  let total = 0;
  for (const chunk of batched(rows)) {
    const payload = chunk.map((r) => {
      const { id, ...props } = r;
      return { id, props };
    });
    await client.write(`UNWIND $rows AS row MERGE (n:${label} {id: row.id}) SET n += row.props`, {
      rows: payload,
    });
    total += payload.length;
  }
  return total;
}

/** MERGE rows as relationships. Each row: {src, dst, ...edge_props}. */
async function writeEdges(
  client: FalkorClient,
  srcLabel: string,
  rel: string,
  dstLabel: string,
  rows: Row[],
): Promise<number> {
  let total = 0;
  for (const chunk of batched(rows)) {
    const payload = chunk.map((r) => {
      const { src, dst, ...props } = r;
      return { src, dst, props };
    });
    await client.write(
      `UNWIND $rows AS row MATCH (a:${srcLabel} {id: row.src}) MATCH (b:${dstLabel} {id: row.dst}) ` +
        `MERGE (a)-[r:${rel}]->(b) SET r += row.props`,
      { rows: payload },
    );
    total += payload.length;
  }
  return total;
}

/**
 * MERGE edges from one label to *any* node (looked up by id alone).
 * Used for MENTIONS, where a message can point at a Person, Service, Ticket
 * or Document. The `MATCH (b {id: row.dst})` is intentionally label-free.
 */
async function writePolymorphicEdges(
  client: FalkorClient,
  srcLabel: string,
  rel: string,
  rows: Row[],
): Promise<number> {
  let total = 0;
  for (const chunk of batched(rows)) {
    const payload = chunk.map((r) => {
      const { src, dst, ...props } = r;
      return { src, dst, props };
    });
    await client.write(
      `UNWIND $rows AS row MATCH (a:${srcLabel} {id: row.src}) MATCH (b {id: row.dst}) ` +
        `MERGE (a)-[r:${rel}]->(b) SET r += row.props`,
      { rows: payload },
    );
    total += payload.length;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Seeding steps (same order as the original: endpoints must exist before edges)
// ---------------------------------------------------------------------------

type Dataset = {
  TEAMS: Row[];
  PEOPLE: Row[];
  SERVICES: Row[];
  REPOS: Row[];
  KNOWLEDGE: Row[];
  TICKETS: Row[];
  DOCUMENTS: Row[];
  DECISIONS: Row[];
  MESSAGES: Row[];
  DEPENDENCIES: Row[];
  DECISION_DISCUSSION: Record<string, string[]>;
  EXPECTED: Record<string, number>;
  EXPECTED_EDGES: Record<string, number>;
};

const D = data as unknown as Dataset;

async function seedTeams(client: FalkorClient): Promise<number> {
  return writeNodes(client, "Team", D.TEAMS);
}

async function seedPeople(client: FalkorClient): Promise<number> {
  const rows = D.PEOPLE.map((p) => {
    const { team: _team, ...rest } = p;
    return { ...rest, key: String(p.id).split(":", 2)[1] };
  });
  const n = await writeNodes(client, "Person", rows);
  await writeEdges(
    client,
    "Person",
    "MEMBER_OF",
    "Team",
    D.PEOPLE.map((p) => ({ src: p.id, dst: p.team, since: "2024-01-15" })),
  );
  return n;
}

async function seedServices(client: FalkorClient): Promise<number> {
  const rows = D.SERVICES.map((s) => {
    const { repo: _repo, owner: _owner, ...rest } = s;
    return rest;
  });
  const n = await writeNodes(client, "Service", rows);
  await writeEdges(
    client,
    "Service",
    "DEPENDS_ON",
    "Service",
    D.DEPENDENCIES.map((d) => ({ src: d.from, dst: d.to })),
  );
  await writeEdges(
    client,
    "Team",
    "OWNS",
    "Service",
    D.SERVICES.map((s) => ({ src: s.owner, dst: s.id })),
  );
  await writeEdges(
    client,
    "Service",
    "IN_REPO",
    "Repo",
    D.SERVICES.map((s) => ({ src: s.id, dst: s.repo })),
  );
  return n;
}

async function seedRepos(client: FalkorClient): Promise<number> {
  return writeNodes(client, "Repo", D.REPOS);
}

/** Who knows which service, and how well — the backbone of 'who to ask'. */
async function seedKnowledge(client: FalkorClient): Promise<number> {
  return writeEdges(
    client,
    "Person",
    "KNOWS_ABOUT",
    "Service",
    D.KNOWLEDGE.map((k) => ({ src: k.person, dst: k.service, level: k.level })),
  );
}

async function seedTickets(client: FalkorClient): Promise<number> {
  const rows = D.TICKETS.map((t) => {
    const { service: _s, assignee: _a, blocked_by: _b, blocked_by_decisions: _bd, ...rest } = t;
    return { ...rest, key: String(t.id).split(":", 2)[1] };
  });
  const n = await writeNodes(client, "Ticket", rows);
  await writeEdges(
    client,
    "Ticket",
    "RELATES_TO",
    "Service",
    D.TICKETS.map((t) => ({ src: t.id, dst: t.service })),
  );
  await writeEdges(
    client,
    "Ticket",
    "ASSIGNED_TO",
    "Person",
    D.TICKETS.filter((t) => t.assignee).map((t) => ({ src: t.id, dst: t.assignee })),
  );
  await writeEdges(
    client,
    "Ticket",
    "BLOCKED_BY",
    "Ticket",
    D.TICKETS.flatMap((t) => ((t.blocked_by as string[]) ?? []).map((b) => ({ src: t.id, dst: b }))),
  );
  // Ticket -> Decision blocking. Distinct from the ticket->ticket edge above:
  // this is what makes "blocked by the auth migration" a traversal.
  await writeEdges(
    client,
    "Ticket",
    "BLOCKED_BY",
    "Decision",
    D.TICKETS.flatMap((t) =>
      ((t.blocked_by_decisions as string[]) ?? []).map((d) => ({ src: t.id, dst: d, kind: "decision" })),
    ),
  );
  // Ticket -> Repo, inherited from the service it belongs to.
  const repoByService = new Map(D.SERVICES.filter((s) => s.repo).map((s) => [s.id, s.repo]));
  await writeEdges(
    client,
    "Ticket",
    "IN_REPO",
    "Repo",
    D.TICKETS.filter((t) => repoByService.has(t.service)).map((t) => ({
      src: t.id,
      dst: repoByService.get(t.service),
    })),
  );
  return n;
}

async function seedDocuments(client: FalkorClient): Promise<number> {
  const rows = D.DOCUMENTS.map((d) => {
    const { author: _a, services: _s, ...rest } = d;
    return rest;
  });
  const n = await writeNodes(client, "Document", rows);
  await writeEdges(
    client,
    "Person",
    "AUTHORED",
    "Document",
    D.DOCUMENTS.map((d) => ({ src: d.author, dst: d.id })),
  );
  await writeEdges(
    client,
    "Document",
    "RELATES_TO",
    "Service",
    D.DOCUMENTS.flatMap((d) => ((d.services as string[]) ?? []).map((s) => ({ src: d.id, dst: s }))),
  );
  return n;
}

async function seedDecisions(client: FalkorClient): Promise<number> {
  const rows = D.DECISIONS.map((d) => {
    const { decided_by: _db, services: _s, ...rest } = d;
    return rest;
  });
  const n = await writeNodes(client, "Decision", rows);
  await writeEdges(
    client,
    "Decision",
    "DECIDED_BY",
    "Person",
    D.DECISIONS.map((d) => ({ src: d.id, dst: d.decided_by })),
  );
  // The decider also authored the record of the decision.
  await writeEdges(
    client,
    "Person",
    "AUTHORED",
    "Decision",
    D.DECISIONS.map((d) => ({ src: d.decided_by, dst: d.id })),
  );
  await writeEdges(
    client,
    "Decision",
    "RELATES_TO",
    "Service",
    D.DECISIONS.flatMap((d) => ((d.services as string[]) ?? []).map((s) => ({ src: d.id, dst: s }))),
  );
  return n;
}

async function seedMessages(client: FalkorClient): Promise<number> {
  const rows = D.MESSAGES.map((m) => {
    const { author, discussed_in: _di, mentions: _me, ...rest } = m;
    return { ...rest, author_id: author };
  });
  const n = await writeNodes(client, "Message", rows);
  await writeEdges(
    client,
    "Person",
    "AUTHORED",
    "Message",
    D.MESSAGES.map((m) => ({ src: m.author, dst: m.id })),
  );
  await writePolymorphicEdges(
    client,
    "Message",
    "DISCUSSED_IN",
    D.MESSAGES.filter((m) => m.discussed_in).map((m) => ({ src: m.id, dst: m.discussed_in })),
  );
  // Where each decision was argued. Seeded here because decisions are created
  // earlier in the run, so the endpoints always exist.
  await writePolymorphicEdges(
    client,
    "Message",
    "DISCUSSED_IN",
    Object.entries(D.DECISION_DISCUSSION).flatMap(([decisionId, mids]) =>
      mids.map((mid) => ({ src: mid, dst: decisionId })),
    ),
  );
  await writePolymorphicEdges(
    client,
    "Message",
    "MENTIONS",
    D.MESSAGES.flatMap((m) => ((m.mentions as string[]) ?? []).map((t) => ({ src: m.id, dst: t }))),
  );
  return n;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function seed(client: FalkorClient, reset: boolean): Promise<Record<string, number>> {
  if (reset) {
    console.info("--reset: dropping graph");
    await client.deleteGraph();
  }
  await initSchema(client);
  const stats: Record<string, number> = {
    teams: await seedTeams(client),
    people: await seedPeople(client),
    repos: await seedRepos(client),
    services: await seedServices(client),
    // after services: KNOWS_ABOUT matches on Service nodes
    knowledge_edges: await seedKnowledge(client),
    // before tickets: tickets carry Ticket -[:BLOCKED_BY]-> Decision edges,
    // so the Decision nodes must already exist or the MERGE matches nothing
    decisions: await seedDecisions(client),
    documents: await seedDocuments(client),
    tickets: await seedTickets(client),
    messages: await seedMessages(client),
  };
  console.info("seed complete:", stats);
  return stats;
}

/**
 * Assert the graph matches the dataset, loudly.
 *
 * A MERGE whose endpoints do not exist yet writes zero rows *without error* —
 * that is how an ordering bug can produce a half-empty graph. This turns that
 * into a hard failure.
 */
async function verify(client: FalkorClient): Promise<void> {
  const summary = await schemaSummary(client);
  const problems: string[] = [];
  const expectedNodes: Record<string, string> = {
    Person: "people",
    Team: "teams",
    Service: "services",
    Ticket: "tickets",
    Document: "documents",
    Decision: "decisions",
    Message: "messages",
    Repo: "repos",
  };
  for (const [label, key] of Object.entries(expectedNodes)) {
    const expected = D.EXPECTED[key];
    const actual = summary.node_counts[label] ?? 0;
    if (actual !== expected) problems.push(`nodes ${label}: expected ${expected}, got ${actual}`);
  }
  for (const [rel, expected] of Object.entries(D.EXPECTED_EDGES)) {
    const actual = summary.edge_counts[rel] ?? 0;
    if (actual !== expected) problems.push(`edges ${rel}: expected ${expected}, got ${actual}`);
  }
  if (problems.length > 0) throw new Error("seed verification failed:\n  " + problems.join("\n  "));
  console.info("verify ok:", JSON.stringify(summary.node_counts));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const client = await FalkorClient.get();
  try {
    if (args.includes("--stats")) {
      const summary = await schemaSummary(client);
      console.info(JSON.stringify(summary, null, 1));
      return;
    }
    await seed(client, args.includes("--reset"));
    await verify(client);
  } finally {
    await client.close();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("seed failed:", (err as Error).message);
    process.exit(1);
  },
);
