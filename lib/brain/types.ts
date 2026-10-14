/**
 * Shared Company Brain types.
 *
 * These are the *wire* shapes: everything that crosses into the UI (JSON or
 * SSE) is built from them, so the frontend and the agent cannot drift apart.
 */

/** A serialised graph node, in the shape the UI expects. */
export type BrainNode = {
  /** Business id — the `id` property, falling back to the element id. */
  id: string;
  /** First label, used for colouring and icons. */
  label: string;
  /** Human label (name/key/title). */
  name: string;
  labels: string[];
  properties: Record<string, unknown>;
  /** Driver element id, useful for de-duplication. */
  element_id?: number;
  color?: string;
};

export type BrainEdge = {
  id?: number;
  source: string;
  target: string;
  type: string;
  properties?: Record<string, unknown>;
};

export type SubGraph = { nodes: BrainNode[]; edges: BrainEdge[] };

/** One step of the agent's reasoning — the explainability record. */
export type TraceStep = {
  tool: string;
  arguments: Record<string, unknown>;
  cypher?: string | null;
  result_summary?: string | null;
  row_count?: number;
  duration_ms?: number;
  error?: string | null;
  round?: number;
};

export type Finding = {
  id?: string;
  agent: string;
  summary: string;
  turn_ref?: string | null;
  data?: unknown;
  created_at?: string;
};

export type MemoryNode = {
  id: string;
  summary: string;
  kind: "episodic" | "semantic";
  timestamp?: string | null;
  about?: string[];
};

export type ActivityItem = {
  kind: "finding" | "handoff";
  agent: string;
  detail: string;
  timestamp?: string | null;
};

export type Procedure = {
  id: string;
  task_pattern: string;
  steps: string[];
  uses?: number;
  applied?: number;
  successes?: number;
  learned?: boolean;
  rationale?: string;
  applies_when?: string;
  avoid_when?: string;
};

export type ChatResponse = {
  answer: string;
  reasoning_trace: TraceStep[];
  graph_context: SubGraph;
  session_id: string;
  user_id: string;
  sources: string[];
  agents_involved: string[];
  tool_count: number;
  memories_used: MemoryNode[];
  activity: ActivityItem[];
  intent: string;
  procedures_used: Procedure[];
  procedure_learned: Procedure | null;
};

/** A node the agent has fetched — the unit of evidence for answer grounding. */
export type EvidenceNode = {
  id: string;
  label: string;
  name: string;
};

// ---------------------------------------------------------------------------
// LLM interface (implemented by llm.ts; consumed by the agent + memory)
// ---------------------------------------------------------------------------

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LlmMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string; name?: string };

export type LlmResponse = {
  text: string;
  tool_calls: ToolCall[];
};

/** Minimal surface the agent and memory need from a model provider. */
export interface BrainLlm {
  /** Provider name, for /api/health. */
  readonly provider: string;
  complete(
    messages: LlmMessage[],
    system: string,
    tools: unknown[],
  ): Promise<LlmResponse>;
  /** Build the follow-up message carrying a tool's result. */
  toolResultMessage(call: ToolCall, content: string): LlmMessage;
}

export type ToolResult = {
  tool: string;
  ok: boolean;
  summary: string;
  data?: unknown;
  cypher?: string | null;
  nodes: BrainNode[];
  edges: BrainEdge[];
  row_count: number;
  duration_ms?: number;
  error?: string | null;
};
