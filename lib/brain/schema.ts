/**
 * Graph schema constants, colours and index creation.
 *
 * The label/relationship lists are the contract between the seeder, the tools
 * and the UI legend, so they live in one place.
 */
import type { FalkorClient } from "./graph";
import type { BrainNode, SubGraph } from "./types";

export const NODE_LABELS = [
  "Person",
  "Team",
  "Service",
  "Repo",
  "Document",
  "Ticket",
  "Decision",
  "Message",
  // Memory / agent
  "Session",
  "Turn",
  "EpisodicMemory",
  "SemanticMemory",
  "ProceduralMemory",
  "Finding",
  "AgentHandoff",
] as const;

export const RELATIONSHIPS = [
  "MEMBER_OF",
  "OWNS",
  "AUTHORED",
  "ASSIGNED_TO",
  "MENTIONS",
  "DISCUSSED_IN",
  "DECIDED_BY",
  "RELATES_TO",
  "DEPENDS_ON",
  "KNOWS_ABOUT",
  "IN_REPO",
  "BLOCKED_BY",
  "CONTAINS",
  "RECORDED",
  "REMEMBERS",
] as const;

export const NODE_PROPERTIES: Record<string, string[]> = {
  Person: ["id", "key", "name", "role", "email", "seniority"],
  Team: ["id", "name", "mission"],
  Service: ["id", "name", "description", "tier", "language", "aliases"],
  Repo: ["id", "name", "url", "language"],
  Ticket: ["id", "key", "title", "status", "priority", "opened"],
  Document: ["id", "title", "kind", "summary", "url", "date"],
  Decision: ["id", "title", "rationale", "status", "topics", "date"],
  Message: ["id", "content", "channel", "timestamp", "author_id"],
  Session: ["id", "user_id", "started_at"],
  Turn: ["id", "session_id", "role", "content", "timestamp", "agent"],
  EpisodicMemory: ["id", "user_id", "summary", "timestamp"],
  SemanticMemory: ["id", "user_id", "fact", "source"],
  ProceduralMemory: ["id", "user_id", "task_pattern", "steps"],
  Finding: ["id", "session_id", "agent", "content", "timestamp"],
  AgentHandoff: ["id", "from_agent", "to_agent", "session_id", "timestamp", "reason"],
};

export const RELATIONSHIP_PROPERTIES: Record<string, string[]> = {
  MEMBER_OF: ["since"],
  KNOWS_ABOUT: ["level"],
  BLOCKED_BY: ["kind"],
};

/** Colours shared with the frontend legend so both agree on one palette. */
export const NODE_COLORS: Record<string, string> = {
  Person: "#38bdf8",
  Team: "#a78bfa",
  Service: "#34d399",
  Ticket: "#fbbf24",
  Decision: "#f472b6",
  Document: "#22d3ee",
  Message: "#94a3b8",
  Repo: "#fb923c",
  Session: "#c084fc",
  Turn: "#818cf8",
  EpisodicMemory: "#4ade80",
  SemanticMemory: "#16a34a",
  ProceduralMemory: "#15803d",
  Finding: "#e879f9",
  AgentHandoff: "#f9a8d4",
};

/** Normalise a subgraph into {nodes, edges} with a display name and colour. */
export function shapeSubgraph(sub: SubGraph): SubGraph {
  return {
    nodes: sub.nodes.map((n) => shapeNode(n)),
    edges: sub.edges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
      properties: e.properties ?? {},
    })),
  };
}

export function shapeNode(node: BrainNode): BrainNode {
  const props = node.properties ?? {};
  const labels = node.labels ?? [];
  const label = labels[0] ?? "Node";
  return {
    id: node.id,
    label,
    labels,
    name:
      (props.name as string) ||
      (props.key as string) ||
      (props.title as string) ||
      node.id,
    properties: props,
    color: NODE_COLORS[label] ?? "#64748b",
  };
}

/** Create a range index on `id` for every label (idempotent, best-effort). */
export async function initSchema(client: FalkorClient): Promise<void> {
  for (const label of NODE_LABELS) {
    await tryWrite(client, `CREATE INDEX FOR (n:${label}) ON (n.id)`);
  }
  const secondary = [
    "CREATE INDEX FOR (p:Person) ON (p.name)",
    "CREATE INDEX FOR (s:Service) ON (s.name)",
    "CREATE INDEX FOR (t:Ticket) ON (t.status)",
    "CREATE INDEX FOR (s:Session) ON (s.user_id)",
    "CREATE INDEX FOR (m:EpisodicMemory) ON (m.user_id)",
    "CREATE INDEX FOR (m:SemanticMemory) ON (m.user_id)",
  ];
  for (const cypher of secondary) await tryWrite(client, cypher);
  for (const label of NODE_LABELS) {
    await tryWrite(client, `CREATE UNIQUE INDEX FOR (n:${label}) ON (n.id)`);
  }
}

async function tryWrite(client: FalkorClient, cypher: string): Promise<void> {
  try {
    await client.write(cypher);
  } catch {
    // Index/constraint already exists (or the server lacks support) — ignore.
  }
}
