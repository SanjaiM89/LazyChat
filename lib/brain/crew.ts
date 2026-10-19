/**
 * Multi-agent coordination (Track 2).
 *
 * Two agents with different jobs, communicating *through the graph* rather
 * than through a local variable:
 *
 *     Researcher  ──writes──>  (:Finding)  ──read by──>  Synthesizer
 *          │                                                  │
 *          └────────────  (:AgentHandoff)  ──────────────────┘
 *                   "here is what I found, go compose"
 *
 * Because the handoff is a node, it is inspectable in the UI, countable in a
 * query, and auditable after the fact — which is the whole point. A handoff
 * that lived in a local variable would leave no trace.
 */
import { FalkorClient } from "./graph";
import { classify, isClearlyOutOfScope, unknownReply, capabilityReply, greetingReply } from "./intent";
import { getLlm } from "./llm";
import { recallProcedures, formatForPrompt, learnFromTurn, recordUse, type RecalledProcedure } from "./procedures";
import { buildResearcherPrompt, buildSynthesizerPrompt } from "./prompts";
import { execute, toolSpecs, compact } from "./tools";
import { schemaSummary } from "./cypher";
import type {
  ActivityItem,
  BrainEdge,
  BrainLlm,
  BrainNode,
  LlmMessage,
  MemoryNode,
  Procedure,
  TraceStep,
} from "./types";

export const RESEARCHER = "researcher";
export const SYNTHESIZER = "synthesizer";

function nowIso(): string {
  return new Date().toISOString();
}

function uid(hex: number): string {
  let out = "";
  for (let i = 0; i < hex; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

// ---------------------------------------------------------------------------
// Shared state: Finding + AgentHandoff nodes
// ---------------------------------------------------------------------------

export type FindingRecord = {
  id: string;
  content: string;
  timestamp: string | null;
  about: string[];
  cypher: string | null;
};

/**
 * Record one piece of evidence in shared graph state.
 *
 * `turnRef` scopes the finding to a single question. Without it the
 * Synthesizer would read every finding the Researcher has ever written in
 * that session and later answers would restate earlier ones.
 */
export async function writeFinding(
  client: FalkorClient,
  sessionId: string,
  agent: string,
  content: string,
  opts: { nodeIds?: string[]; cypher?: string | null; turnRef?: string | null } = {},
): Promise<string> {
  const fid = `finding:${uid(10)}`;
  // The param is named `stmt`, not `cypher`: the driver inlines parameters as
  // a `CYPHER k=v ...` query prefix, and the server lexes that keyword
  // case-insensitively — a parameter literally named `cypher` made every
  // Finding write fail with a syntax error. The stored property stays `f.cypher`.
  await client.write(
    "MERGE (f:Finding {id: $fid}) " +
      "SET f.session_id = $sid, f.agent = $agent, f.content = $content, " +
      "    f.timestamp = $ts, f.about = $about, f.cypher = $stmt, f.turn_ref = $turnRef",
    {
      fid,
      sid: sessionId,
      agent,
      content,
      ts: nowIso(),
      about: opts.nodeIds ?? [],
      stmt: opts.cypher ?? null,
      turnRef: opts.turnRef ?? null,
    },
  );
  return fid;
}

/**
 * What the Synthesizer is allowed to use: the Researcher's findings.
 *
 * Scoped to one turn when `turnRef` is given, so an answer only ever rests
 * on evidence gathered for *that* question.
 */
export async function readFindings(
  client: FalkorClient,
  sessionId: string,
  agent?: string | null,
  turnRef?: string | null,
): Promise<FindingRecord[]> {
  const clauses = ["f.session_id = $sid"];
  const params: Record<string, unknown> = { sid: sessionId };
  if (agent) {
    clauses.push("f.agent = $agent");
    params.agent = agent;
  }
  if (turnRef) {
    clauses.push("f.turn_ref = $turnRef");
    params.turnRef = turnRef;
  }
  const rows = await client.query<{
    id: string;
    content: string;
    timestamp: string | null;
    about: string[] | null;
    cypher: string | null;
  }>(
    `MATCH (f:Finding) WHERE ${clauses.join(" AND ")} ` +
      "RETURN f.id AS id, f.content AS content, f.timestamp AS timestamp, " +
      "f.about AS about, f.cypher AS cypher ORDER BY f.timestamp ASC",
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    timestamp: r.timestamp,
    about: r.about ?? [],
    cypher: r.cypher,
  }));
}

/** Make the handoff an explicit, queryable event. */
export async function recordHandoff(
  client: FalkorClient,
  sessionId: string,
  fromAgent: string,
  toAgent: string,
  reason: string,
  findingIds?: string[],
): Promise<string> {
  const hid = `handoff:${uid(10)}`;
  await client.write(
    "MERGE (h:AgentHandoff {id: $hid}) " +
      "SET h.session_id = $sid, h.from_agent = $from, h.to_agent = $to, " +
      "    h.reason = $reason, h.timestamp = $ts",
    { hid, sid: sessionId, from: fromAgent, to: toAgent, reason, ts: nowIso() },
  );
  for (const fid of findingIds ?? []) {
    await client.write(
      "MATCH (h:AgentHandoff {id: $hid}), (f:Finding {id: $fid}) " + "MERGE (h)-[:RECORDED]->(f)",
      { hid, fid },
    );
  }
  return hid;
}

/** Ordered agent activity for the 'Agent Activity' panel. */
export async function sessionActivity(client: FalkorClient, sessionId: string): Promise<ActivityItem[]> {
  const findingRows = await client.query<{ agent: string; content: string; timestamp: string | null }>(
    "MATCH (f:Finding) WHERE f.session_id = $sid " +
      "RETURN f.agent AS agent, f.content AS content, f.timestamp AS timestamp ORDER BY f.timestamp ASC",
    { sid: sessionId },
  );
  const activity: ActivityItem[] = findingRows.map((r) => ({
    kind: "finding" as const,
    agent: r.agent,
    detail: r.content,
    timestamp: r.timestamp,
  }));
  const handoffRows = await client.query<{
    from_agent: string;
    to_agent: string;
    reason: string;
    timestamp: string | null;
    count: number;
  }>(
    "MATCH (h:AgentHandoff) WHERE h.session_id = $sid " +
      "OPTIONAL MATCH (h)-[:RECORDED]->(f:Finding) " +
      "RETURN h.from_agent AS from_agent, h.to_agent AS to_agent, h.reason AS reason, " +
      "h.timestamp AS timestamp, count(f) AS count ORDER BY h.timestamp ASC",
    { sid: sessionId },
  );
  for (const r of handoffRows) {
    activity.push({
      kind: "handoff" as const,
      agent: r.from_agent,
      detail: `→ ${r.to_agent}: ${r.reason} (${r.count} finding(s))`,
      timestamp: r.timestamp,
    });
  }
  activity.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
  return activity;
}

// ---------------------------------------------------------------------------
// Researcher
// ---------------------------------------------------------------------------

export type ResearchOutput = {
  agent: typeof RESEARCHER;
  trace: TraceStep[];
  nodes: BrainNode[];
  edges: BrainEdge[];
  finding_ids: string[];
  findings: FindingRecord[];
};

async function knownServiceNames(client: FalkorClient): Promise<string[]> {
  const rows = await client.query<{ name: string }>("MATCH (s:Service) RETURN s.name AS name");
  return rows.map((r) => r.name).filter(Boolean);
}

async function knownTopics(client: FalkorClient): Promise<string[]> {
  const rows = await client.query<{ topics: string[] | null }>("MATCH (d:Decision) RETURN d.topics AS topics");
  const out: string[] = [];
  for (const r of rows) for (const t of r.topics ?? []) if (t) out.push(t);
  return out;
}

/**
 * Investigate the question and publish findings into shared state.
 *
 * `procedures` are recipes the agent learned on earlier turns; they are shown
 * to the planner as a hint, never as an instruction it must obey.
 */
export async function runResearcher(
  client: FalkorClient,
  question: string,
  sessionId: string,
  opts: {
    llm?: BrainLlm | null;
    turnRef?: string | null;
    userId?: string;
    procedures?: RecalledProcedure[];
    onStep?: (step: TraceStep) => void;
  } = {},
): Promise<ResearchOutput> {
  const services = await knownServiceNames(client);
  const topics = await knownTopics(client);
  const llm = opts.llm ?? getLlm({ knownServices: services, knownTopics: topics });

  const summary = await schemaSummary(client);
  let system = buildResearcherPrompt(JSON.stringify(summary.node_counts));
  const hint = formatForPrompt(opts.procedures ?? []);
  if (hint) system = `${system}\n\n${hint}`;
  const messages: LlmMessage[] = [{ role: "user", content: question }];

  const trace: TraceStep[] = [];
  const nodes: BrainNode[] = [];
  const edges: BrainEdge[] = [];
  const findingIds: string[] = [];

  for (let round = 0; round < 4; round += 1) {
    const resp = await llm.complete(messages, system, toolSpecs());
    if (resp.tool_calls.length === 0) break;
    for (const call of resp.tool_calls) {
      const result = await execute(call.name, client, call.arguments ?? {});
      const step: TraceStep = {
        tool: result.tool,
        arguments: call.arguments ?? {},
        cypher: result.cypher ?? null,
        result_summary: result.summary,
        row_count: result.row_count,
        duration_ms: result.duration_ms,
        error: result.error ?? null,
      };
      trace.push(step);
      opts.onStep?.(step);
      nodes.push(...result.nodes);
      edges.push(...result.edges);
      if (result.summary) {
        const fid = await writeFinding(client, sessionId, RESEARCHER, result.summary, {
          nodeIds: result.nodes.slice(0, 8).map((n) => n.id),
          cypher: result.cypher,
          turnRef: opts.turnRef ?? null,
        });
        findingIds.push(fid);
      }
      messages.push(llm.toolResultMessage(call, compact(result)));
    }
  }

  return {
    agent: RESEARCHER,
    trace,
    nodes,
    edges,
    finding_ids: findingIds,
    findings: await readFindings(client, sessionId, RESEARCHER, opts.turnRef ?? null),
  };
}

// ---------------------------------------------------------------------------
// Synthesizer
// ---------------------------------------------------------------------------

export type SynthesisOutput = {
  agent: typeof SYNTHESIZER;
  answer: string;
  findings: FindingRecord[];
};

/** Compose the user-facing answer using only what the Researcher found. */
export async function runSynthesizer(
  client: FalkorClient,
  question: string,
  sessionId: string,
  opts: { llm?: BrainLlm | null; extraContext?: string; turnRef?: string | null } = {},
): Promise<SynthesisOutput> {
  const findings = await readFindings(client, sessionId, RESEARCHER, opts.turnRef ?? null);
  if (findings.length === 0) {
    return {
      agent: SYNTHESIZER,
      answer: "I could not find anything in the graph for that question.",
      findings: [],
    };
  }

  const services = await knownServiceNames(client);
  const topics = await knownTopics(client);
  const llm = opts.llm ?? getLlm({ knownServices: services, knownTopics: topics });

  const system = buildSynthesizerPrompt();
  // The Synthesizer's ONLY input is the findings plus optional memory recall.
  const prompt =
    `Question: ${question}\n\n` +
    "Findings from the Researcher agent:\n" +
    findings.map((f) => `- ${f.content}`).join("\n") +
    (opts.extraContext ? `\n\nRecalled memory for this user:\n${opts.extraContext}` : "") +
    "\n\nWrite the answer using only the findings above. Cite node names.";

  const messages: LlmMessage[] = [{ role: "user", content: prompt }];
  const resp = await llm.complete(messages, system, []);
  let answer = (resp.text ?? "").trim();
  if (!answer) answer = findings.map((f) => `- ${f.content}`).join("\n");

  return { agent: SYNTHESIZER, answer, findings };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Answer a non-graph turn without running any tools. */
async function directAnswer(client: FalkorClient, intent: { kind: string; reason: string }): Promise<string> {
  if (intent.kind === "conversational") {
    // Thanks and farewells get a short reply; greetings invite a question.
    if (intent.reason.includes("greeting")) return greetingReply();
    return "Any time.";
  }
  if (intent.kind === "capability") {
    try {
      return capabilityReply(await schemaSummary(client));
    } catch {
      return capabilityReply(null);
    }
  }
  return unknownReply();
}

export type CrewResult = {
  answer: string;
  reasoning_trace: TraceStep[];
  nodes: BrainNode[];
  edges: BrainEdge[];
  findings: FindingRecord[];
  handoff_id: string | null;
  agents_involved: string[];
  activity: ActivityItem[];
  memories_used: MemoryNode[];
  procedures_used: RecalledProcedure[];
  procedure_learned: Procedure | null;
  intent: string;
};

/** Research -> handoff -> synthesize, with everything written to the graph. */
export async function askCrew(
  client: FalkorClient,
  question: string,
  sessionId: string,
  opts: {
    userId?: string;
    llm?: BrainLlm | null;
    memories?: MemoryNode[];
    onStep?: (step: TraceStep) => void;
  } = {},
): Promise<CrewResult> {
  const userId = opts.userId ?? "demo";
  const memories = opts.memories ?? [];

  const newTurnRef = () => `turn-${uid(8)}`;

  // Not every turn is a graph question. "hi" and "what can you do?" must not
  // be planned as Cypher — they get a direct, honest answer instead.
  const intent = classify(question);
  if (!intent.is_graph) {
    const answer = await directAnswer(client, intent);
    const turnRef = newTurnRef();
    await writeFinding(client, sessionId, intent.kind, answer, { turnRef });
    return {
      answer,
      reasoning_trace: [],
      nodes: [],
      edges: [],
      findings: [],
      handoff_id: null,
      agents_involved: ["company-brain"],
      activity: await sessionActivity(client, sessionId),
      memories_used: memories,
      procedures_used: [],
      procedure_learned: null,
      intent: intent.kind,
    };
  }

  // Things this product will never answer. Route them *before* the planner
  // so the model burns no tool calls, and afterwards so there is no path
  // where it restates a "no results" summary as "something".
  if (isClearlyOutOfScope(question)) {
    const answer = unknownReply();
    const turnRef = newTurnRef();
    await writeFinding(client, sessionId, "out_of_scope", answer, { turnRef });
    return {
      answer,
      reasoning_trace: [],
      nodes: [],
      edges: [],
      findings: [],
      handoff_id: null,
      agents_involved: ["company-brain"],
      activity: await sessionActivity(client, sessionId),
      memories_used: memories,
      procedures_used: [],
      procedure_learned: null,
      intent: "out_of_scope",
    };
  }

  // One turn_ref per question keeps each answer grounded only in the evidence
  // gathered for that question, not the whole session's history.
  const turnRef = newTurnRef();

  // Recall recipes this user (or we) learned on earlier questions. They are a
  // planning hint; the Researcher decides whether they apply.
  const procedures = await recallProcedures(client, userId, question);

  const research = await runResearcher(client, question, sessionId, {
    llm: opts.llm,
    turnRef,
    userId,
    procedures,
    onStep: opts.onStep,
  });

  const handoffId = await recordHandoff(
    client,
    sessionId,
    RESEARCHER,
    SYNTHESIZER,
    `researched '${question.slice(0, 80)}' with ${research.trace.length} tool call(s)`,
    research.finding_ids,
  );

  let recallText = "";
  if (memories.length > 0) {
    recallText = memories.map((m) => `- [${m.kind}] ${m.summary.slice(0, 160)}`).join("\n");
  }

  // Nothing answered the question: do not hand empty evidence to the
  // Synthesizer, where "no rows" decays into invented content. Say so plainly.
  if (!research.trace.some((s) => s.row_count)) {
    let answer = unknownReply();
    if (memories.length > 0) {
      const recalled = memories
        .slice(0, 3)
        .map((m) => `- [${m.kind}] ${m.summary.slice(0, 140)}`)
        .join("\n");
      answer = unknownReply() + `\n\nFrom your earlier sessions:\n${recalled}`;
    }
    await writeFinding(client, sessionId, SYNTHESIZER, answer.slice(0, 500), { turnRef });
    return {
      answer,
      reasoning_trace: research.trace,
      nodes: research.nodes,
      edges: research.edges,
      findings: research.findings,
      handoff_id: handoffId,
      agents_involved: [RESEARCHER, SYNTHESIZER],
      activity: await sessionActivity(client, sessionId),
      memories_used: memories,
      procedures_used: procedures,
      procedure_learned: null,
      intent: "no_evidence",
    };
  }

  const synthesis = await runSynthesizer(client, question, sessionId, {
    llm: opts.llm,
    extraContext: recallText,
    turnRef,
  });
  await writeFinding(client, sessionId, SYNTHESIZER, synthesis.answer.slice(0, 500), {
    nodeIds: memories.flatMap((m) => m.about ?? []).slice(0, 8),
    turnRef,
  });

  // Learn from what actually worked: only tool calls that returned rows and
  // did not error become a recipe.
  let learned: Procedure | null = null;
  try {
    const raw = await learnFromTurn(client, userId, question, research.trace, {
      sessionId,
      llm: opts.llm,
    });
    if (raw) {
      learned = {
        id: raw.id,
        task_pattern: raw.task_pattern,
        steps: raw.steps,
        rationale: raw.rationale,
        applies_when: raw.applies_when,
        avoid_when: raw.avoid_when,
        learned: true,
      };
    }
  } catch {
    // learning must never fail an answer
  }

  for (const p of procedures) {
    try {
      await recordUse(client, userId, p.id, Boolean(learned));
    } catch {
      // usage stats must never fail an answer
    }
  }

  return {
    answer: synthesis.answer,
    reasoning_trace: research.trace,
    nodes: research.nodes,
    edges: research.edges,
    findings: research.findings,
    handoff_id: handoffId,
    agents_involved: [RESEARCHER, SYNTHESIZER],
    activity: await sessionActivity(client, sessionId),
    memories_used: memories,
    procedures_used: procedures,
    procedure_learned: learned,
    intent: "graph",
  };
}
