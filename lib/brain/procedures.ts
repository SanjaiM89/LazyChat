/**
 * Procedural memory the agent writes for itself.
 *
 * The seeded `ProceduralMemory` recipes are a starting point. This module lets
 * the agent **learn its own**: after a question is answered from the graph with
 * a non-empty result, the tool sequence that worked is generalised into a
 * reusable recipe and written back as a `ProceduralMemory` node.
 *
 *     "Who knows auth-service?"          -> find_experts(service='auth-service')
 *     "Who knows the payments service?"  -> find_experts(service='payments')
 *
 * are the *same task*, so concrete argument values become slots before storage.
 *
 * A recipe is only learned from a run that actually worked — no tool errors and
 * at least one row of evidence — so a failed approach is never mistaken for a
 * skill. Recall is lexical, so the planner is nudged rather than overridden.
 */
import { createHash } from "node:crypto";

import type { FalkorClient } from "./graph";
import type { BrainLlm, TraceStep } from "./types";
import { nowIso } from "./memory/session";

// Arguments that vary per question and become slots. Anything else is kept
// verbatim, because a constant like `limit: 5` is part of the recipe.
export const SLOT_ARGS: Record<string, string> = {
  service: "$service",
  topic: "$topic",
  name: "$name",
  from_service: "$from_service",
  to_service: "$to_service",
  node_id: "$node_id",
};

// Question words carry no task signal once a procedure exists.
const STOPWORDS = new Set([
  "the", "a", "an", "what", "which", "who", "whom", "whose", "when", "why",
  "how", "does", "do", "did", "is", "are", "was", "were", "if", "and", "or",
  "of", "for", "to", "in", "on", "at", "by", "with", "from", "about", "tell",
  "me", "we", "our", "i", "my", "us", "it", "that", "this", "these", "those",
  "can", "could", "should", "would", "there", "any", "some", "much", "many",
  "most", "all", "please", "give", "show", "list", "need", "want",
]);

// Tool names imply the task, so they anchor the pattern when the question's own
// words are generic ("tell me about payments").
export const TOOL_TASK: Record<string, string> = {
  impact_of_failure: "blast radius of a service failing",
  find_bottlenecks: "services that are bottlenecks",
  central_services: "most central services",
  team_clusters: "how the org clusters by team",
  pagerank: "most central nodes overall",
  bridge_services: "services on many dependency paths",
  shortest_path: "route between two services",
  find_experts: "who knows a service",
  tickets_blocked_by: "what is blocked behind a decision",
  get_decision_context: "why a decision was made",
  tickets_for_service: "tickets for a service",
  find_people: "who a person is and what they own",
  trace_dependencies: "what a service depends on",
  graph_context: "the neighbourhood of a node",
  run_cypher: "an open graph question",
  create_ticket: "filing a ticket for work that needs doing",
  update_ticket: "changing a ticket's status, priority or assignee",
  record_decision: "recording a decision with its rationale",
  note_knowledge: "recording who knows a service",
  remember_fact: "mapping an open-ended fact between two things",
};

/** Task-bearing words of a question, in order, de-duplicated. */
export function normalizeQuestion(question: string): string[] {
  const words = ((question ?? "").match(/[A-Za-z][A-Za-z0-9-]*/g) ?? []).map((w) => w.toLowerCase());
  const out: string[] = [];
  for (const w of words) {
    if (STOPWORDS.has(w) || w.length < 3) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/** Replace per-question values with slots so the recipe is reusable. */
export function generalizeArguments(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (key in SLOT_ARGS && typeof value === "string" && value) out[key] = SLOT_ARGS[key];
    else out[key] = value;
  }
  return out;
}

/**
 * A stable, human-readable label for the kind of question this was.
 *
 * Built from the tools that ran (reliable) plus any task words the question
 * contributed, so two questions that led to the same tools collapse onto one
 * pattern instead of accumulating near-duplicates.
 */
export function describeTask(question: string, tools: string[]): string {
  const fromTools = [...new Set(tools)].filter((t) => t in TOOL_TASK).map((t) => TOOL_TASK[t]);
  const words = normalizeQuestion(question).slice(0, 3);
  if (fromTools.length > 0) return fromTools.slice(0, 2).join(" / ");
  return words.join(" ") || "an open graph question";
}

/** Content-addressed, so the same task learned twice updates one node. */
export function procedureId(userId: string, taskPattern: string, steps: string[]): string {
  const sig = taskPattern + "|" + steps.join("|");
  const digest = createHash("sha1").update(sig).digest("hex").slice(0, 12);
  return `procedural:${userId}:learned:${digest}`;
}

export type LearnedProcedure = {
  id: string;
  task_pattern: string;
  steps: string[];
  tools: string[];
  rationale: string;
  applies_when: string;
  avoid_when: string;
};

type Reflection = {
  task_pattern: string;
  rationale: string;
  applies_when: string;
  avoid_when: string;
};

/**
 * Turn a successful tool sequence into a reusable recipe.
 *
 * Returns the stored procedure, or null when the run produced nothing worth
 * learning from.
 */
export async function learnFromTurn(
  client: FalkorClient,
  userId: string,
  question: string,
  trace: TraceStep[],
  opts: { sessionId?: string | null; llm?: BrainLlm | null } = {},
): Promise<LearnedProcedure | null> {
  const { steps, tools } = recipeSteps(trace);
  if (steps.length === 0) return null;

  const reflection = await reflect(opts.llm ?? null, question, tools, steps);
  const taskPattern = reflection.task_pattern;

  const pid = procedureId(userId, taskPattern, steps);
  await client.write(
    "MERGE (p:ProceduralMemory {id: $pid}) " +
      "SET p.user_id = $uid, p.task_pattern = $pattern, p.steps = $steps, " +
      "    p.tools = $tools, p.timestamp = $ts, p.source = $source, " +
      "    p.learned = true, " +
      "    p.rationale = $rationale, p.applies_when = $applies_when, " +
      "    p.avoid_when = $avoid_when, " +
      "    p.uses = coalesce(p.uses, 0) + 1",
    {
      pid,
      uid: userId,
      pattern: taskPattern,
      steps,
      tools,
      ts: nowIso(),
      source: opts.sessionId ?? "",
      rationale: reflection.rationale,
      applies_when: reflection.applies_when,
      avoid_when: reflection.avoid_when,
    },
  );
  return {
    id: pid,
    task_pattern: taskPattern,
    steps,
    tools,
    rationale: reflection.rationale,
    applies_when: reflection.applies_when,
    avoid_when: reflection.avoid_when,
  };
}

const REFLECT_SYSTEM =
  "You explain why a sequence of graph queries answers a kind of question. " +
  "Be concrete and brief. Never invent graph features.";

/**
 * Ask why this sequence worked, so the recipe transfers to new questions.
 *
 * Offline this falls back to the tool semantics table, which still yields a
 * usable rationale — it just cannot generalise as far.
 */
export async function reflect(
  llm: BrainLlm | null,
  question: string,
  tools: string[],
  steps: string[],
): Promise<Reflection> {
  const fallback = fallbackReflection(tools);
  if (!llm) return fallback;

  const prompt =
    "A question-answering agent answered a question using graph queries.\n\n" +
    `Question: ${question}\n` +
    `Queries run: ${steps.join("; ")}\n\n` +
    "Reply with exactly these four lines and nothing else:\n" +
    "TASK: <the kind of question, at most 8 words, lowercase>\n" +
    "WHY: <one sentence on why these queries answer that kind of question>\n" +
    "WHEN: <one line saying what such a question looks like>\n" +
    "NOT: <one line saying when these queries would be the wrong choice>";
  try {
    const resp = await llm.complete([{ role: "user", content: prompt }], REFLECT_SYSTEM, []);
    const parsed = parseReflection(resp.text ?? "");
    if (parsed) return parsed;
  } catch {
    // reflection is an enrichment, never a requirement
  }
  return fallback;
}

export function parseReflection(text: string): Reflection | null {
  const out: Partial<Reflection> = {};
  const fields: Array<[string, keyof Reflection]> = [
    ["TASK:", "task_pattern"],
    ["WHY:", "rationale"],
    ["WHEN:", "applies_when"],
    ["NOT:", "avoid_when"],
  ];
  for (const rawLine of (text ?? "").split("\n")) {
    const line = rawLine.trim();
    for (const [key, field] of fields) {
      if (line.toUpperCase().startsWith(key)) {
        const value = line.slice(key.length).trim();
        if (value) out[field] = value;
      }
    }
  }
  if (!out.task_pattern) return null;
  const task = out.task_pattern.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim();
  if (task.length < 3 || task.length > 60) return null;
  return {
    task_pattern: task,
    rationale: out.rationale ?? "",
    applies_when: out.applies_when ?? "",
    avoid_when: out.avoid_when ?? "",
  };
}

/** Offline rationale derived from what the tools actually do. */
function fallbackReflection(tools: string[]): Reflection {
  const labels = tools.filter((t) => t in TOOL_TASK).map((t) => TOOL_TASK[t]);
  return {
    task_pattern: describeTaskFrom(tools),
    rationale:
      labels.length > 0
        ? `Answered with ${labels.join(" and ")}; each step returned graph rows that directly carry the answer.`
        : "Answered with a custom read-only query over the graph.",
    applies_when:
      labels.length > 0
        ? `Use when the question is about ${labels.join(", ")}.`
        : "Use for an open-ended question about the graph.",
    avoid_when:
      "Do not use when the question concerns a different kind of node or relationship.",
  };
}

export function describeTaskFrom(tools: string[]): string {
  const labels = [...new Set(tools)].filter((t) => t in TOOL_TASK).map((t) => TOOL_TASK[t]);
  return labels.slice(0, 2).join(" / ") || "an open graph question";
}

/** Tool calls that actually produced evidence, as readable recipe steps. */
function recipeSteps(trace: TraceStep[]): { steps: string[]; tools: string[] } {
  const steps: string[] = [];
  const tools: string[] = [];
  for (const step of trace ?? []) {
    if (step.error) continue; // a failed call is not a skill worth keeping
    if (!(step.row_count ?? 0)) continue;
    const name = step.tool;
    const args = generalizeArguments(step.arguments ?? {});
    const rendered = Object.entries(args)
      .map(([k, v]) => `${k}=${repr(v)}`)
      .join(", ");
    steps.push(`${name}(${rendered})`);
    if (!tools.includes(name)) tools.push(name);
  }
  return { steps, tools };
}

function repr(value: unknown): string {
  if (typeof value === "string") return `'${value}'`;
  return JSON.stringify(value) ?? String(value);
}

export type RecalledProcedure = {
  id: string;
  task_pattern: string;
  steps: string[];
  uses: number;
  learned: boolean;
  rationale: string;
  applies_when: string;
  avoid_when: string;
  score?: number;
};

/** Recipes relevant to this question — the user's own, then the seeded ones. */
export async function recallProcedures(
  client: FalkorClient,
  userId: string,
  question: string,
  limit = 4,
): Promise<RecalledProcedure[]> {
  const rows = await client.query<{
    id: string;
    pattern: string;
    steps: string[] | null;
    uses: number;
    learned: boolean;
    rationale: string;
    applies_when: string;
    avoid_when: string;
  }>(
    "MATCH (p:ProceduralMemory) WHERE p.user_id = $uid OR p.user_id = 'system' " +
      "RETURN p.id AS id, p.task_pattern AS pattern, p.steps AS steps, coalesce(p.uses, 0) AS uses, " +
      "       coalesce(p.learned, false) AS learned, coalesce(p.rationale, '') AS rationale, " +
      "       coalesce(p.applies_when, '') AS applies_when, coalesce(p.avoid_when, '') AS avoid_when " +
      "ORDER BY coalesce(p.uses, 0) DESC",
    { uid: userId },
  );
  if (rows.length === 0) return [];

  const words = new Set(normalizeQuestion(question));
  const scored = rows.map((r) => {
    const patternWords = new Set(normalizeQuestion(r.pattern ?? ""));
    const overlap = [...words].filter((w) => patternWords.has(w)).length;
    const uses = Number(r.uses) || 0;
    const learned = Boolean(r.learned);
    // A learned recipe the user has reused is the strongest signal.
    const score = overlap + (learned && overlap ? 0.5 : 0) + uses * 0.1;
    return {
      id: r.id,
      task_pattern: r.pattern,
      steps: r.steps ?? [],
      uses,
      learned,
      rationale: r.rationale,
      applies_when: r.applies_when,
      avoid_when: r.avoid_when,
      score,
    };
  });
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const relevant = scored.filter((p) => (p.score ?? 0) > 0);
  return (relevant.length > 0 ? relevant : scored).slice(0, limit);
}

/** Render recipes for the system prompt, learned ones marked as such. */
export function formatForPrompt(procedures: RecalledProcedure[]): string {
  if (procedures.length === 0) return "";
  const lines = ["## Procedures you have used before"];
  for (const p of procedures) {
    const origin = p.learned ? "learned" : "seeded";
    lines.push(`- ${p.task_pattern} [${origin}]`);
    if (p.rationale) lines.push(`    why: ${p.rationale}`);
    if (p.applies_when) lines.push(`    applies when: ${p.applies_when}`);
    if (p.avoid_when) lines.push(`    not when: ${p.avoid_when}`);
    for (const step of (p.steps ?? []).slice(0, 6)) lines.push(`    ${step}`);
  }
  lines.push(
    "Reuse a recipe when the question matches its *applies when* condition. " +
      "Substitute the current question's values for the $slots. Respect the " +
      "*not when* condition — a recipe can be the wrong tool for a question " +
      "that shares vocabulary with one it suits.",
  );
  return lines.join("\n");
}

/** Note that a recalled recipe was applied, and whether it worked. */
export async function recordUse(
  client: FalkorClient,
  _userId: string,
  procedureIdValue: string,
  success: boolean,
): Promise<void> {
  await client.write(
    "MATCH (p:ProceduralMemory {id: $pid}) " +
      "SET p.applied = coalesce(p.applied, 0) + 1, " +
      "    p.successes = coalesce(p.successes, 0) + $ok",
    { pid: procedureIdValue, ok: success ? 1 : 0 },
  );
}
