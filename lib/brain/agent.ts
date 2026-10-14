/**
 * The Company Brain agent loop.
 *
 *     question + session
 *         -> plan tools        (LLM)
 *         -> execute Cypher    (FalkorDB)
 *         -> compose answer    (LLM, grounded in tool output)
 *         -> reasoning trace + contributing subgraph
 *
 * `askAgent()` is the single entry point used by the API layer.
 */
import { capabilityReply, unknownReply } from "./intent";
import { getLlm } from "./llm";
import { askCrew } from "./crew";
import { buildSystemPrompt } from "./prompts";
import { schemaSummary } from "./cypher";
import { FalkorClient } from "./graph";
import { ensureSession, newSessionId, recordTurn, recallMemories } from "./memory/session";
import { compact, execute, toolSpecs } from "./tools";
import type {
  BrainEdge,
  BrainLlm,
  BrainNode,
  ChatResponse,
  LlmMessage,
  MemoryNode,
  SubGraph,
  TraceStep,
} from "./types";

export const MAX_TOOL_ROUNDS = 6;

export class AgentError extends Error {}

/** Service names + aliases — the vocabulary the graph can match on. Exported for API routes. */
export async function knownServices(client: FalkorClient): Promise<string[]> {  const rows = await client.query<{ name: string | null; aliases: string[] | null }>(
    "MATCH (s:Service) RETURN s.name AS name, s.aliases AS aliases",
  );
  const names: string[] = [];
  for (const row of rows) {
    for (const candidate of [row.name, ...(row.aliases ?? [])]) {
      if (candidate) names.push(candidate);
    }
  }
  return names;
}

/** Decision topics — the vocabulary the graph can match on. Exported for API routes. */
export async function knownTopics(client: FalkorClient): Promise<string[]> {
  const rows = await client.query<{ topics: string[] | null }>("MATCH (d:Decision) RETURN d.topics AS topics");
  const topics: string[] = [];
  for (const row of rows) {
    for (const t of row.topics ?? []) {
      if (t && !topics.includes(t)) topics.push(t);
    }
  }
  return topics;
}

/**
 * Fetch the real edges connecting nodes a tool touched.
 *
 * Tools report the nodes they reached but not always the relationships that
 * connected them, so the contributing subgraph would arrive edge-less and the
 * UI could not draw the traversal path. One extra query recovers them.
 */
async function edgesBetween(client: FalkorClient, nodeIds: string[]): Promise<BrainEdge[]> {
  if (nodeIds.length < 2) return [];
  let rows: Array<{ src: string; rel: string; dst: string }>;
  try {
    rows = await client.query(
      "MATCH (a)-[r]->(b) WHERE a.id IN $ids AND b.id IN $ids " + "RETURN a.id AS src, type(r) AS rel, b.id AS dst",
      { ids: nodeIds.slice(0, 200) },
    );
  } catch {
    // never let visualisation break the answer
    return [];
  }
  const seen = new Set<string>();
  const edges: BrainEdge[] = [];
  for (const row of rows) {
    const key = `${row.src}|${row.rel}|${row.dst}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: row.src, target: row.dst, type: row.rel });
  }
  return edges;
}

/**
 * Merge tool results into one subgraph for the UI.
 *
 * Tools frequently touch the same node; dedupe by id so the graph does not
 * flicker with duplicates between answers.
 */
function dedupeSubgraph(nodes: BrainNode[], edges: BrainEdge[], maxNodes = 80): SubGraph {
  const byId = new Map<string, BrainNode>();
  for (const n of nodes) {
    if (!byId.has(n.id)) byId.set(n.id, n);
  }
  const trimmed = [...byId.values()].slice(0, maxNodes);
  const keep = new Set(trimmed.map((n) => n.id));
  const seenEdges = new Set<string>();
  const outEdges: BrainEdge[] = [];
  for (const e of edges) {
    const key = `${e.source}|${e.target}|${e.type}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    if (keep.has(e.source) && keep.has(e.target)) outEdges.push(e);
  }
  return { nodes: trimmed, edges: outEdges };
}

export type AskAgentOptions = {
  sessionId?: string | null;
  userId?: string;
  client?: FalkorClient;
  llm?: BrainLlm | null;
  knownServices?: string[];
  useMemory?: boolean;
  multiAgent?: boolean;
  /** Called with each reasoning step as it completes (drives live streaming). */
  onStep?: (step: TraceStep) => void;
};

/**
 * Answer `question` from the graph, returning the answer plus its full trace.
 *
 * When `multiAgent` is set (the default) the answer is produced by a
 * Researcher -> Synthesizer handoff through the graph; otherwise a single
 * planning pass answers directly. Either way the return shape is identical so
 * the API and UI do not care which ran.
 */
export async function askAgent(question: string, opts: AskAgentOptions = {}): Promise<ChatResponse> {
  if (!question || !question.trim()) throw new AgentError("question must not be empty");

  const client = opts.client ?? (await FalkorClient.get());
  const userId = opts.userId ?? "demo";
  const sessionId = await ensureSession(client, userId, opts.sessionId ?? newSessionId(userId));

  const services = opts.knownServices ?? (await knownServices(client));
  const topics = await knownTopics(client);
  const llm = opts.llm ?? getLlm({ knownServices: services, knownTopics: topics });

  // Recall happens BEFORE research so the Synthesizer can cite what the user
  // already established in an earlier session.
  let memories: MemoryNode[] = [];
  if (opts.useMemory !== false) {
    try {
      memories = await recallMemories(client, userId, question);
    } catch {
      // recall must never block an answer
    }
  }

  await recordTurn(client, sessionId, "user", question);

  const multiAgent = opts.multiAgent !== false;
  let answer: string;
  let trace: TraceStep[];
  let allNodes: BrainNode[];
  let allEdges: BrainEdge[];
  let agentsInvolved: string[];
  let activity: ChatResponse["activity"];
  let intent: string;
  let proceduresUsed: ChatResponse["procedures_used"];
  let procedureLearned: ChatResponse["procedure_learned"];

  if (multiAgent) {
    const result = await askCrew(client, question, sessionId, {
      userId,
      llm,
      memories,
      onStep: opts.onStep,
    });
    answer = result.answer;
    trace = result.reasoning_trace;
    allNodes = result.nodes;
    allEdges = result.edges;
    agentsInvolved = result.agents_involved;
    activity = result.activity;
    intent = result.intent;
    proceduresUsed = result.procedures_used;
    procedureLearned = result.procedure_learned;
  } else {
    const single = await singlePass(client, question, llm, services, topics, opts.onStep);
    answer = single.answer;
    trace = single.trace;
    allNodes = single.nodes;
    allEdges = single.edges;
    agentsInvolved = ["agent"];
    activity = [];
    intent = "graph";
    proceduresUsed = [];
    procedureLearned = null;
  }

  await recordTurn(client, sessionId, "assistant", answer, agentsInvolved[0]);

  // Recover the relationships between touched nodes so the UI can draw the
  // traversal path, not just a cloud of nodes.
  if (allEdges.length === 0 && allNodes.length > 0) {
    allEdges = await edgesBetween(
      client,
      allNodes.map((n) => n.id),
    );
  }

  const subgraph = dedupeSubgraph(allNodes, allEdges);
  const sources = [
    ...new Set(
      allNodes.map((n) => {
        const props = n.properties ?? {};
        const label = n.label || (n.labels[0] ?? "Node");
        const ident =
          (props.key as string) || (props.name as string) || (props.title as string) || n.name || n.id;
        return `${label}:${ident}`;
      }),
    ),
  ]
    .sort()
    .slice(0, 20);

  return {
    answer,
    reasoning_trace: trace,
    graph_context: subgraph,
    session_id: sessionId,
    user_id: userId,
    sources,
    agents_involved: agentsInvolved,
    tool_count: trace.length,
    memories_used: memories,
    activity,
    intent,
    procedures_used: proceduresUsed,
    procedure_learned: procedureLearned,
  };
}

/** One agent plans and answers directly (no Researcher/Synthesizer split). */
async function singlePass(
  client: FalkorClient,
  question: string,
  llm: BrainLlm,
  _services: string[],
  _topics: string[],
  onStep?: (step: TraceStep) => void,
): Promise<{ answer: string; trace: TraceStep[]; nodes: BrainNode[]; edges: BrainEdge[] }> {
  const summary = await schemaSummary(client);
  const summaryText =
    `${Object.values(summary.node_counts).reduce((a, b) => a + b, 0)} nodes ` +
    `(${Object.entries(summary.node_counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")})`;
  const system = buildSystemPrompt(summaryText);
  const messages: LlmMessage[] = [{ role: "user", content: question }];
  const trace: TraceStep[] = [];
  const allNodes: BrainNode[] = [];
  const allEdges: BrainEdge[] = [];
  let answer = "";

  for (let roundNo = 0; roundNo < MAX_TOOL_ROUNDS; roundNo += 1) {
    const response = await llm.complete(messages, system, toolSpecs());
    if (response.tool_calls.length === 0) {
      answer = response.text.trim() || (await fallbackAnswer(trace, client));
      break;
    }
    for (const call of response.tool_calls) {
      const result = await execute(call.name, client, call.arguments ?? {});
      const step: TraceStep = {
        tool: result.tool,
        arguments: call.arguments ?? {},
        cypher: result.cypher ?? null,
        result_summary: result.summary,
        row_count: result.row_count,
        duration_ms: result.duration_ms,
        error: result.error ?? null,
        round: roundNo + 1,
      };
      trace.push(step);
      onStep?.(step);
      allNodes.push(...result.nodes);
      allEdges.push(...result.edges);
      messages.push(llm.toolResultMessage(call, compact(result)));
    }
    if (roundNo === MAX_TOOL_ROUNDS - 1) answer = await fallbackAnswer(trace, client);
  }

  return { answer, trace, nodes: allNodes, edges: allEdges };
}

/**
 * Used when a model returns neither text nor a tool call.
 *
 * If the run did fetch evidence, summarise that rather than giving up. If it
 * fetched nothing, say something useful instead of a flat denial — "I could
 * not find anything in the graph" is the wrong reply to "hi".
 */
async function fallbackAnswer(trace: TraceStep[], client?: FalkorClient): Promise<string> {
  const lines = trace.map((t) => t.result_summary).filter(Boolean) as string[];
  if (lines.length > 0) return "From the graph:\n" + lines.map((line) => `- ${line}`).join("\n");

  let stats = null;
  if (client) {
    try {
      stats = await schemaSummary(client);
    } catch {
      stats = null;
    }
  }
  if (stats && Object.keys(stats.node_counts).length > 0) return capabilityReply(stats);
  return unknownReply();
}
