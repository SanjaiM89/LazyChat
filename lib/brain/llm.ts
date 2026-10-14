/**
 * LLM abstraction for the Company Brain agent.
 *
 * Three implementations share one interface:
 *
 * - `AnthropicLlm` — real Claude via the Messages API, using native tool use.
 * - `SarvamLlm`    — an OpenAI-compatible endpoint that has no native function
 *                    calling, so tool definitions ride in the system prompt and
 *                    tool calls are parsed out of a fenced JSON block.
 * - `MockLlm`      — a deterministic, rule-based planner.
 *
 * `MockLlm` is not a stub that returns canned strings. It parses the question,
 * chooses tools with the same tool-calling protocol the real model uses, then
 * composes a grounded answer from the tool results. That keeps the entire
 * pipeline — tool dispatch, reasoning trace, graph context, multi-agent
 * handoff — exercisable and testable with no API key and no network.
 *
 * `getLlm()` falls back to `MockLlm` whenever the selected provider has no key.
 */
import { brainConfig } from "./config";
import { extractNameMention } from "./omnia-memory";
import type { BrainLlm, LlmMessage, LlmResponse, ToolCall } from "./types";

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Narrow an `unknown` into a plain object without reaching for `any`. */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class LlmError extends Error {}

/** A non-2xx HTTP response, carrying the fields `_brief`/`_is_transient` read. */
class HttpError extends Error {
  readonly status_code: number;
  readonly body: string;
  constructor(status: number, body: string, url: string) {
    super(`HTTP ${status} from ${url}`);
    this.name = "HttpError";
    this.status_code = status;
    this.body = body;
  }
}

/** A transport failure; named so `_is_transient` treats it as retryable. */
class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

/** POST/GET a URL and parse JSON, raising an error that keeps the status. */
async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (exc) {
    throw new ConnectionError(exc instanceof Error ? exc.message : String(exc));
  }
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, text.trim().slice(0, 2000), url);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LlmError(`invalid JSON response from ${url}`);
  }
}

/** A short, useful error string. */
function brief(exc: unknown): string {
  if (exc === null || exc === undefined) return "unknown error";
  const record = asRecord(exc);
  const status =
    typeof record.status_code === "number"
      ? record.status_code
      : typeof record.status === "number"
        ? record.status
        : undefined;
  const body = record.body;
  if (body !== undefined && body !== null) {
    const text = String(body).trim().slice(0, 200);
    return status !== undefined ? `HTTP ${status}: ${text}` : `API error: ${text}`;
  }
  if (status !== undefined) return `HTTP ${status}`;
  const response = record.response;
  if (response !== null && typeof response === "object") {
    const resp = asRecord(response);
    const rstatus =
      typeof resp.status_code === "number"
        ? resp.status_code
        : typeof resp.status === "number"
          ? resp.status
          : undefined;
    let rbody = "";
    try {
      rbody = String(resp.text ?? "").trim().slice(0, 200);
    } catch {
      rbody = "";
    }
    if (rbody) return `HTTP ${rstatus ?? ""}: ${rbody}`;
    if (rstatus !== undefined) return `HTTP ${rstatus}`;
  }
  const name =
    typeof record.name === "string"
      ? record.name
      : exc instanceof Error
        ? exc.constructor.name
        : "Error";
  const message = exc instanceof Error ? exc.message : String(exc);
  return `${name}: ${message.slice(0, 200)}`;
}

/** Worth retrying? Rate limits and server errors are; 4xx are not. */
function isTransient(exc: unknown): boolean {
  const record = asRecord(exc);
  let status =
    typeof record.status_code === "number"
      ? record.status_code
      : typeof record.status === "number"
        ? record.status
        : undefined;
  if (status === undefined) {
    const response = record.response;
    if (response !== null && typeof response === "object") {
      const resp = asRecord(response);
      status =
        typeof resp.status_code === "number"
          ? resp.status_code
          : typeof resp.status === "number"
            ? resp.status
            : undefined;
    }
  }
  if (status !== undefined) return status === 429 || status >= 500;
  // Connection errors and timeouts are transient even without a status code.
  const name = (
    typeof record.name === "string"
      ? record.name
      : exc instanceof Error
        ? exc.name
        : ""
  ).toLowerCase();
  return ["timeout", "connection", "connect"].some((k) => name.includes(k));
}

// ---------------------------------------------------------------------------
// Tool-spec + JSON extraction helpers
// ---------------------------------------------------------------------------

type ToolSpec = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

/** Normalise a tool definition into the shape the adapters use. */
function asToolSpec(tool: unknown): ToolSpec {
  const record = asRecord(tool);
  return {
    name: typeof record.name === "string" ? record.name : "",
    description: typeof record.description === "string" ? record.description : "",
    input_schema: asRecord(record.input_schema),
  };
}

function jsonType(schema: Record<string, unknown>): string {
  const type = typeof schema.type === "string" ? schema.type : "string";
  const table: Record<string, string> = {
    string: "str",
    integer: "int",
    number: "number",
    boolean: "bool",
    array: "list",
    object: "object",
  };
  return table[type] ?? "str";
}

/** A planned call, before ids are assigned. */
type PlannedCall = { name: string; arguments: Record<string, unknown> };

/** Normalise a tool argument payload into a dict. */
function coerceArgs(item: Record<string, unknown>): Record<string, unknown> {
  const raw = item.arguments ?? item.input ?? item.args ?? {};
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[String(k)] = v;
    }
    return out;
  }
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (Array.isArray(raw)) {
    // Positional values with no names: keep them under generic keys so the call
    // is still attempted rather than lost.
    const out: Record<string, unknown> = {};
    raw.forEach((v, i) => {
      out[`arg${i}`] = v;
    });
    return out;
  }
  return {};
}

/** Normalise the several JSON shapes a model might emit into invocations. */
function invocationsFrom(parsed: unknown): PlannedCall[] {
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.tool_calls)) return invocationsFrom(record.tool_calls);
    // A single call with name/arguments at the top level.
    if ("name" in record || "tool" in record) return invocationsFrom([record]);
    return [];
  }
  if (Array.isArray(parsed)) {
    const out: PlannedCall[] = [];
    for (const item of parsed) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const name = record.name || record.tool || record.tool_name;
      if (typeof name !== "string" || !name) continue;
      out.push({ name, arguments: coerceArgs(record) });
    }
    return out;
  }
  return [];
}

/** Yield likely-JSON substrings, most promising first. */
function jsonCandidates(text: string): string[] {
  const stripped = (text ?? "").trim();
  const out: string[] = [];
  // Fenced block, with or without a language tag.
  for (const match of stripped.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    out.push(match[1].trim());
  }
  // A bare {...} or [...] object that spans the whole response.
  out.push(stripped);
  // Any {...} block, in case prose surrounds it.
  for (const match of stripped.matchAll(/\{[\s\S]*\}/g)) {
    out.push(match[0].trim());
  }
  return out;
}

function tryParse(candidate: string): unknown | null {
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    // fall through
  }
  // Trim to the outermost braces, in case prose follows the object.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Extract tool invocations from a model's JSON output.
 *
 * Deliberately tolerant: models emit the blob inside a fence, bare, with a
 * language tag, or with surrounding prose. Only structurally valid calls are
 * returned — anything else falls through as plain text.
 */
export function parseToolCalls(text: string): ToolCall[] {
  for (const candidate of jsonCandidates(text ?? "")) {
    const parsed = tryParse(candidate);
    if (parsed === null) continue;
    const invocations = invocationsFrom(parsed);
    if (invocations.length > 0) {
      // Python's ToolInvocation had no id; the TS ToolCall requires one, so we
      // synthesise them in call order.
      return invocations.map((inv, i) => ({
        id: `call_${i}`,
        name: inv.name,
        arguments: inv.arguments,
      }));
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Sarvam (OpenAI-compatible, no native tool use)
// ---------------------------------------------------------------------------

const SARVAM_TOOL_INSTRUCTIONS = `You are a tool-using agent. You do not answer from memory — you call tools
and answer only from what they return.

## How to call tools

When you need a tool, respond with ONLY a JSON object inside a \`\`\`json code
block and no other text:

\`\`\`json
{
  "tool_calls": [
    {"name": "find_experts", "arguments": {"service": "auth-service"}}
  ]
}
\`\`\`

Rules:
- Call as many tools as you need in one block — they run in parallel.
- \`arguments\` must match the tool's parameter list exactly.
- When you have enough evidence to answer, respond with plain text only and
  no JSON block. That is your final answer.
- Never claim a result you did not get back from a tool.
`;

type OpenAiToolCall = {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  function?: unknown;
};

type OpenAiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Map the shared `LlmMessage` union onto OpenAI chat-completions messages. */
function toOpenAiMessages(messages: LlmMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      const entry: OpenAiMessage = { role: "assistant", content: message.content };
      if (message.tool_calls && message.tool_calls.length > 0) {
        entry.tool_calls = message.tool_calls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
        }));
      }
      out.push(entry);
    } else {
      out.push({ role: "tool", tool_call_id: message.tool_call_id, content: message.content });
    }
  }
  return out;
}

/** Build the tool-laden system prompt for a model without function calling. */
function augmentedSystem(system: string, tools: ToolSpec[]): string {
  if (tools.length === 0) return system;
  const lines = [SARVAM_TOOL_INSTRUCTIONS, "## Available tools"];
  for (const tool of tools) {
    const params = asRecord(tool.input_schema.properties);
    const requiredRaw = tool.input_schema.required;
    const required = Array.isArray(requiredRaw) ? requiredRaw : [];
    const signature = Object.entries(params)
      .map(([key, value]) => `${key}${required.includes(key) ? "*" : ""}: ${jsonType(asRecord(value))}`)
      .join(", ");
    lines.push(`- \`${tool.name}(${signature})\` — ${tool.description}`);
  }
  return `${system}\n\n` + lines.join("\n");
}

/**
 * sarvam-105b via an OpenAI-compatible endpoint.
 *
 * **This model has no native tool use.** Asked to call a tool it returns
 * `tool_calls: None` and instead writes a JSON blob in a code fence. Rather
 * than give up tool calling, this adapter speaks the same protocol the other
 * providers do by parsing that JSON back into `ToolCall`s.
 *
 * That is the only way a model without function calling can drive this agent,
 * and it makes the loop provider-agnostic rather than Anthropic-shaped.
 */
export class SarvamLlm implements BrainLlm {
  readonly provider = "sarvam" as const;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  // This model has no native tool calls, so it cannot supply tool_call_ids of
  // its own. The API still requires one on every tool message, so we synthesise
  // ids here.
  private counter = 0;

  constructor(apiKey: string, model?: string) {
    if (!apiKey) throw new LlmError("SARVAM_API_KEY is not set");
    const config = brainConfig();
    this.apiKey = apiKey;
    this.model = model ?? config.sarvam.model;
    this.baseUrl = config.sarvam.baseUrl;
  }

  get modelId(): string {
    return this.model;
  }

  async complete(messages: LlmMessage[], system: string, tools: unknown[]): Promise<LlmResponse> {
    const specs = tools.map(asToolSpec);
    const augmented = augmentedSystem(system, specs);
    // sarvam-105b has no `system=` kwarg: the system prompt travels as the
    // first message with role "system".
    const fullMessages: OpenAiMessage[] = [
      { role: "system", content: augmented },
      ...toOpenAiMessages(messages),
    ];

    let text = "";
    let native: OpenAiToolCall[] | null = null;

    // This model intermittently returns an empty message with
    // finish_reason=length instead of answering — no JSON block, no text.
    // Treated as retryable: it is a degenerate response, not an answer.
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.request(fullMessages, specs);
      text = cleanMarkdown(result.content);
      native = result.toolCalls;
      if (native || text.trim() || specs.length === 0) break;
      console.warn(`sarvam returned an empty response; retry ${attempt + 1}/3`);
      await sleep(600 * (attempt + 1));
    }

    // Native tool calls first — some models do support them.
    if (native) {
      const calls: ToolCall[] = [];
      for (const toolCall of native) {
        const fn = asRecord(toolCall.function);
        const name = fn.name ?? toolCall.name;
        if (typeof name !== "string" || !name) continue;
        const id =
          typeof toolCall.id === "string" && toolCall.id
            ? toolCall.id
            : `call_${this.counter++}`;
        calls.push({
          id,
          name,
          arguments: coerceArgs({ arguments: fn.arguments }),
        });
      }
      if (calls.length > 0) return { text, tool_calls: calls };
    }

    const invocations = parseToolCalls(text);
    if (invocations.length > 0) {
      // Synthesise ids in call order; results are appended in the same order.
      const calls = invocations.map((inv) => ({ ...inv, id: `call_${this.counter++}` }));
      return { text, tool_calls: calls };
    }

    return { text, tool_calls: [] };
  }

  /**
   * Attach the synthesised id the API requires on tool messages.
   *
   * Python paired a pending-id queue here; the TS `ToolCall` carries its own id,
   * so echoing it is exactly equivalent.
   */
  toolResultMessage(call: ToolCall, content: string): LlmMessage {
    return { role: "tool", tool_call_id: call.id, content };
  }

  /**
   * Call the API, retrying transient failures.
   *
   * The agent loop makes several sequential calls per question, and this
   * endpoint rate-limits bursts — a bare 429 would otherwise fail an answer
   * that a retry a second later would have answered.
   *
   * `tools` must be supplied whenever tool messages are present: the API
   * rejects a conversation that mixes tool results with no tool definitions.
   */
  private async request(
    messages: OpenAiMessage[],
    tools: ToolSpec[],
  ): Promise<{ content: string; toolCalls: OpenAiToolCall[] | null }> {
    const body: Record<string, unknown> = { model: this.model, messages };
    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters:
            Object.keys(tool.input_schema).length > 0
              ? tool.input_schema
              : { type: "object" },
        },
      }));
    }

    const attempts = 4;
    let lastExc: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const data = asRecord(
          await requestJson(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          }),
        );
        const choices = Array.isArray(data.choices) ? data.choices : [];
        const message = asRecord(asRecord(choices[0]).message);
        const content = typeof message.content === "string" ? message.content : "";
        const rawCalls = Array.isArray(message.tool_calls)
          ? (message.tool_calls as OpenAiToolCall[])
          : [];
        return { content, toolCalls: rawCalls.length > 0 ? rawCalls : null };
      } catch (exc) {
        lastExc = exc;
        if (!isTransient(exc) || attempt === attempts - 1) break;
        const delay = 2 ** attempt;
        console.warn(`sarvam transient error (${brief(exc)}); retrying in ${delay}s`);
        await sleep(delay * 1000);
      }
    }
    throw new LlmError(`sarvam request failed: ${brief(lastExc)}`);
  }
}

/** Strip code fences so the final answer is not wrapped in ```. */
function cleanMarkdown(text: string): string {
  let t = (text ?? "").trim();
  if (t.startsWith("```")) {
    let lines = t.split("\n");
    // drop the opening fence (with or without a language tag)
    if (lines.length > 0) lines = lines.slice(1);
    if (lines.length > 0 && lines[lines.length - 1].trim() === "```") {
      lines = lines.slice(0, -1);
    }
    t = lines.join("\n").trim();
  }
  return t;
}

// ---------------------------------------------------------------------------
// Anthropic (Messages API + native tool use)
// ---------------------------------------------------------------------------

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type AnthropicToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;
type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicContentBlock[] };

/** Map the shared `LlmMessage` union onto Anthropic Messages API messages. */
function toAnthropicMessages(messages: LlmMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.tool_calls ?? []) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments ?? {} });
      }
      out.push({ role: "assistant", content: blocks });
    } else {
      const block: AnthropicToolResultBlock = {
        type: "tool_result",
        tool_use_id: message.tool_call_id,
        content: message.content,
      };
      const last = out[out.length - 1];
      // Consecutive tool results must share one user turn in the Messages API.
      if (last !== undefined && last.role === "user" && Array.isArray(last.content)) {
        (last.content as AnthropicContentBlock[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

/** Claude via the Messages API, using native tool use. */
export class AnthropicLlm implements BrainLlm {
  readonly provider = "anthropic" as const;

  private readonly apiKey: string;
  private readonly model: string;
  // Token ids for tool results need to echo the assistant's tool_use id.
  private toolUseIds: string[] = [];

  constructor(apiKey: string, model?: string) {
    if (!apiKey) throw new LlmError("ANTHROPIC_API_KEY is not set");
    const config = brainConfig();
    this.apiKey = apiKey;
    this.model = model ?? config.anthropic.model;
  }

  get lastToolUseIds(): string[] {
    return [...this.toolUseIds];
  }

  async complete(messages: LlmMessage[], system: string, tools: unknown[]): Promise<LlmResponse> {
    const specs = tools.map(asToolSpec);
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 2048,
      system,
      messages: toAnthropicMessages(messages),
    };
    if (specs.length > 0) {
      body.tools = specs.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema:
          Object.keys(tool.input_schema).length > 0
            ? tool.input_schema
            : { type: "object" },
      }));
    }

    const data = asRecord(
      await requestJson(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );

    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    this.toolUseIds = [];
    const content = Array.isArray(data.content) ? data.content : [];
    for (const raw of content) {
      const block = asRecord(raw);
      if (block.type === "text") {
        textParts.push(typeof block.text === "string" ? block.text : "");
      } else if (block.type === "tool_use") {
        const id = typeof block.id === "string" ? block.id : "";
        const name = typeof block.name === "string" ? block.name : "";
        this.toolUseIds.push(id);
        toolCalls.push({ id, name, arguments: asRecord(block.input) });
      }
    }
    return {
      text: textParts.filter((part) => part).join("\n").trim(),
      tool_calls: toolCalls,
    };
  }

  /** Anthropic needs the tool_use id echoed back on each result. */
  toolResultMessage(call: ToolCall, content: string): LlmMessage {
    return { role: "tool", tool_call_id: call.id, content };
  }
}

// ---------------------------------------------------------------------------
// Deterministic offline planner
// ---------------------------------------------------------------------------

// (regex, tool name, argument builder key). First match per tool wins; all
// matching tools are planned together so one question can traverse several
// aspects of the graph.
const PLAN_RULES: Array<{ pattern: RegExp; tool: string; extra: Record<string, unknown> }> = [
  {
    pattern: /\b(who|whom)\b.*\b(know|knows|expert|familiar|own|owns|maintain)/i,
    tool: "find_experts",
    extra: {},
  },
  { pattern: /\b(knows?|experts?|familiar with)\b/i, tool: "find_experts", extra: {} },
  {
    pattern: /\b(break|breaks|breaking|blast radius|impact|down|outage|fail|fails)\b/i,
    tool: "impact_of_failure",
    extra: {},
  },
  {
    pattern: /\b(depend|depends|dependency|dependencies)\b/i,
    tool: "trace_dependencies",
    extra: {},
  },
  {
    pattern: /\b(block|blocks|blocked|blocking|waiting on|stuck behind)\b/i,
    tool: "tickets_blocked_by",
    extra: {},
  },
  {
    pattern: /\b(decide|decides|decided|deciding|decision|decisions|why did|rationale|adr)\b/i,
    tool: "get_decision_context",
    extra: {},
  },
  {
    pattern: /\b(ticket|tickets|jira|issue|issues|work item|work items)\b/i,
    tool: "tickets_for_service",
    extra: {},
  },
  { pattern: /\b(shortest|path between|route|how .* reach)\b/i, tool: "shortest_path", extra: {} },
  {
    pattern: /\b(pagerank|central|hub|most important|busiest)\b/i,
    tool: "pagerank",
    extra: {},
  },
  {
    pattern: /\b(bottleneck|bottlenecks|bridge|bridges|single point|critical path|fix first)\b/i,
    tool: "find_bottlenecks",
    extra: {},
  },
  {
    pattern: /\b(central|centrally|closest to|average distance)\b/i,
    tool: "central_services",
    extra: {},
  },
  {
    pattern: /\b(cluster|clusters|community|communities|group|groups|together|team shape)\b/i,
    tool: "team_clusters",
    extra: {},
  },
  {
    pattern: /\b(person|people|engineer|engineers|team|teams|who is)\b/i,
    tool: "find_people",
    extra: {},
  },
  {
    pattern: /\b(around|neighbourhood|neighborhood|connected to|context for)\b/i,
    tool: "graph_context",
    extra: {},
  },
  // --- actions: the agent acting on what the graph shows ---
  {
    pattern: /\b(file|create|open|raise|log)\b.*\bticket|\bticket\b.*\b(file|create|open|raise|log)\b/i,
    tool: "create_ticket",
    extra: {},
  },
  {
    pattern: /\b(assign|reassign|reopen|update|mark|priorit\w*|closed?)\b/i,
    tool: "update_ticket",
    extra: {},
  },
  {
    pattern: /\b(record|note|log)\b.*\bdecision|\bwe (decided|chose|will|have decided)\b/i,
    tool: "record_decision",
    extra: {},
  },
  {
    pattern: /\b(note|record|add)\b.*\b(know|expert|familiar|knowledge)\b/i,
    tool: "note_knowledge",
    extra: {},
  },
  {
    pattern: /\b(remember|note that|keep in mind|don't forget|dont forget|map that)\b/i,
    tool: "remember_fact",
    extra: {},
  },
  {
    pattern: /\b(my name is|call me)\b/i,
    tool: "remember_fact",
    extra: {},
  },
];

// Service / topic extraction: longest alias wins so "notification service" does
// not get clipped to "notif".
const SERVICE_RE = /\b([a-z][a-z0-9\- ]{2,30}?)(?:\s+service)?\b/i;
const STOPWORDS = new Set([
  "the", "a", "an", "what", "which", "who", "whom", "whose", "when", "why", "how",
  "does", "do", "did", "is", "are", "was", "were", "if", "and", "or", "of", "for",
  "to", "in", "on", "at", "by", "with", "from", "about", "tell", "me", "we", "our",
  "i", "my", "our", "us", "it", "that", "this", "these", "those", "can", "could",
  "should", "would", "there", "any", "some", "much", "many", "most", "all",
]);

/** Read the tool-result payloads out of the message history. */
function collectResults(messages: LlmMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role !== "tool") continue;
    let payload: unknown = message.content;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload) as unknown;
      } catch {
        continue;
      }
    }
    if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
      out.push(payload as Record<string, unknown>);
    }
  }
  return out;
}

/**
 * Deterministic planner used when no API key is configured.
 *
 * It speaks the same tool-calling protocol as `AnthropicLlm`: the first turn
 * emits tool invocations, the agent runs them, and the second turn composes an
 * answer strictly from the returned results.
 *
 * Planning is driven by the graph's *own* vocabulary — service names, aliases
 * and decision topics are loaded up front — rather than by guessing a search
 * term out of the question. That is what lets "which tickets are blocked by the
 * auth migration?" resolve to the Auth v3 decision.
 */
export class MockLlm implements BrainLlm {
  readonly provider = "mock" as const;

  private readonly knownServices: string[];
  private readonly knownTopics: string[];
  private seenResults = false;
  private counter = 0;

  constructor(knownServices?: string[], knownTopics?: string[]) {
    this.knownServices = knownServices ?? [];
    this.knownTopics = knownTopics ?? [];
  }

  // -- helpers ----------------------------------------------------------

  private nextId(): string {
    return `call_${this.counter++}`;
  }

  private extractService(text: string): string | null {
    const lowered = text.toLowerCase();
    let best: string | null = null;
    for (const service of this.knownServices) {
      // Prefer the longest alias contained in the question.
      if (lowered.includes(service.toLowerCase())) {
        if (best === null || service.length > best.length) best = service;
      }
    }
    if (best) return best;
    const match = SERVICE_RE.exec(lowered);
    if (match) {
      const candidate = (match[1] ?? "").replace(/^[ -]+|[ -]+$/g, "");
      if (candidate && !STOPWORDS.has(candidate)) return candidate;
    }
    return null;
  }

  private extractTwoServices(text: string): string[] {
    const lowered = text.toLowerCase();
    const found: string[] = [];
    for (const service of [...this.knownServices].sort((a, b) => b.length - a.length)) {
      if (lowered.includes(service.toLowerCase()) && !found.includes(service)) {
        found.push(service);
      }
    }
    return found;
  }

  /**
   * Pick a search term from the graph's own vocabulary.
   *
   * "blocked by the auth migration" -> "auth", which is a real Decision topic.
   * Falls back to cleaned question words only when nothing in the graph
   * vocabulary matches.
   */
  private topic(text: string): string {
    const lowered = text.toLowerCase();
    let best: string | null = null;
    for (const topic of [...this.knownTopics].sort((a, b) => b.length - a.length)) {
      const t = topic.toLowerCase();
      // Whole-word match keeps "auth" from matching inside "author".
      if (new RegExp(`\\b${escapeRegExp(t)}\\b`).test(lowered)) {
        if (best === null || t.length > best.length) best = topic;
      }
    }
    if (best) return best;
    const words = (text.match(/[a-zA-Z][a-zA-Z0-9\-]+/g) ?? []).filter(
      (word) => !STOPWORDS.has(word.toLowerCase()) && word.length > 2,
    );
    return words.slice(0, 4).join(" ").toLowerCase();
  }

  // -- protocol ---------------------------------------------------------

  async complete(messages: LlmMessage[], _system: string, tools: unknown[]): Promise<LlmResponse> {
    const available = new Set(
      tools.map((tool) => asToolSpec(tool).name).filter((name) => name !== ""),
    );
    let question = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === "user") {
        question = message.content;
        break;
      }
    }
    const results = collectResults(messages);

    // Composer role (Synthesizer): no tools are offered, so the prompt already
    // carries the evidence and we must not try to plan anything.
    if (tools.length === 0) {
      return { text: this.composeFromPrompt(question), tool_calls: [] };
    }

    // Turn 2+: we have tool output — compose the answer from it.
    if (results.length > 0) {
      return { text: this.compose(question, results), tool_calls: [] };
    }

    const planned: ToolCall[] = [];
    const plannedNames = new Set<string>();
    for (const rule of PLAN_RULES) {
      if (!available.has(rule.tool) || plannedNames.has(rule.tool)) continue;
      if (!rule.pattern.test(question)) continue;
      planned.push(this.buildCall(rule.tool, question, rule.extra));
      plannedNames.add(rule.tool);
    }

    if (planned.length === 0) {
      // Nothing matched: fall back to a bounded read-only graph probe so the
      // answer is still grounded rather than invented.
      planned.push({
        id: this.nextId(),
        name: "run_cypher",
        arguments: {
          cypher:
            "MATCH (n) RETURN head(labels(n)) AS label, count(*) AS c " +
            "ORDER BY c DESC LIMIT 8",
        },
      });
    }

    this.seenResults = true;
    return { text: "", tool_calls: planned };
  }

  private buildCall(tool: string, question: string, extra: Record<string, unknown>): ToolCall {
    const service = this.extractService(question);
    const args: Record<string, unknown> = { ...extra };
    if (
      tool === "find_experts" ||
      tool === "impact_of_failure" ||
      tool === "trace_dependencies" ||
      tool === "tickets_for_service"
    ) {
      args.service = service ?? "auth-service";
    } else if (tool === "get_decision_context" || tool === "tickets_blocked_by") {
      args.topic = this.topic(question);
    } else if (tool === "shortest_path") {
      const pair = this.extractTwoServices(question);
      args.from_service = pair.length > 0 ? pair[0] : "auth-service";
      args.to_service = pair.length > 1 ? pair[1] : "payments-api";
    } else if (tool === "find_people") {
      args.name = this.topic(question);
    } else if (tool === "graph_context") {
      args.node_id = service ?? "service:auth";
    } else if (tool === "create_ticket") {
      const title = question.trim().replace(/\s+/g, " ").slice(0, 140) || "Untitled ticket";
      args.title = title;
      if (service) args.service = service;
      const lowered = question.toLowerCase();
      args.priority = /p0|critical|urgent|outage/.test(lowered)
        ? "p0"
        : /p1|high/.test(lowered)
          ? "p1"
          : "p2";
    } else if (tool === "update_ticket") {
      const key = /MER-\d+/.exec(question)?.[0];
      if (key) args.key = key;
      const lowered = question.toLowerCase();
      if (/close|resolve|done|fixed/.test(lowered)) args.status = "done";
      else if (/reopen/.test(lowered)) args.status = "open";
      else if (/block/.test(lowered)) args.status = "blocked";
      const assignee = /assign(?:ed)? to ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/.exec(question)?.[1];
      if (assignee) args.assignee = assignee;
    } else if (tool === "record_decision") {
      args.title = question.trim().replace(/\s+/g, " ").slice(0, 140) || "Untitled decision";
      args.rationale = "Recorded from chat.";
      const topic = this.topic(question);
      if (topic) args.topics = topic.split(" ").slice(0, 6);
      if (service) args.services = [service];
    } else if (tool === "note_knowledge") {
      const person =
        /([A-Z][a-z]+(?: [A-Z][a-z]+)+)/.exec(question)?.[1] ?? this.topic(question);
      args.person = person;
      args.service = service ?? "auth-service";
      args.level = /expert/.test(question.toLowerCase()) ? "expert" : "familiar";
    } else if (tool === "remember_fact") {
      const named = extractNameMention(question);
      if (named) {
        args.subject = "user";
        args.predicate = "is named";
        args.object = named;
      } else {
        const triple = this.extractTriple(question);
        args.subject = triple[0];
        args.predicate = triple[1];
        args.object = triple[2];
      }
    }
    return { id: this.nextId(), name: tool, arguments: args };
  }

  /**
   * Best-effort "X <relation> Y" split for the offline remember_fact path.
   * The real model supplies clean arguments; this only needs to be sane.
   */
  private extractTriple(question: string): [string, string, string] {
    const text = question.trim().replace(/^(remember|note|map)\s+(that\s+)?/i, "");
    const m = /(.+?)\s+(is|are|uses?|depends?\s+on|owns?|works?\s+on|part\s+of|relates?\s+to|blocks?|contains?)\s+(.+)/i.exec(
      text,
    );
    if (m) return [m[1].trim().slice(0, 120) || "something", m[2].trim().toLowerCase(), m[3].trim().slice(0, 120) || "something"];
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length >= 3) {
      return [words.slice(0, 2).join(" "), "relates to", words.slice(2).join(" ")];
    }
    return [text.slice(0, 120) || "something", "noted", "something"];
  }

  /**
   * The offline planner needs no provider-specific result framing.
   *
   * Python emitted `{role, content}` only; the TS `LlmMessage` tool variant
   * requires a `tool_call_id`, so we echo the call's id.
   */
  toolResultMessage(call: ToolCall, content: string): LlmMessage {
    return { role: "tool", tool_call_id: call.id, content };
  }

  /**
   * Build the answer strictly from tool output and recalled memory.
   *
   * Every claim is traceable to a `summary` line produced by a tool, or to a
   * memory line the caller supplied. Nothing is added that did not come from
   * the graph.
   */
  private compose(question: string, results: Record<string, unknown>[]): string {
    const lines: string[] = [];
    let cited = 0;
    let thin = true;
    for (const result of results) {
      if (result.error) {
        lines.push(`- ${String(result.tool)}: query failed (${String(result.error)})`);
        continue;
      }
      const summary = result.summary;
      if (summary) {
        lines.push(`- ${String(summary)}`);
        const rowCount = Number(result.row_count ?? 0) || 0;
        cited += rowCount;
        if (rowCount > 0) thin = false;
      }
    }

    // Memory is only foregrounded when the graph did not answer on its own,
    // otherwise recall would drown out fresh evidence.
    const memory = this.memoryLines(question);
    let head: string;
    if (memory.length > 0) {
      head = thin
        ? "I did not find anything new in the graph for that, but from your earlier sessions:"
        : "From your earlier sessions:";
      lines.push(...memory);
    } else {
      head = `From the graph (${cited} matching record${cited !== 1 ? "s" : ""}):`;
    }

    if (lines.length === 0) {
      return (
        "I could not find anything in the graph for that question. " +
        "Try naming a service (for example `auth-service` or `payments-api`) " +
        "or a topic such as the auth migration or the database choice."
      );
    }
    return head + "\n" + lines.join("\n");
  }

  /** Extract '- ' bullet lines between two markers in the Synthesizer prompt. */
  private static section(prompt: string, startMarker: string, endMarkers: string[]): string[] {
    const idx = prompt.indexOf(startMarker);
    if (idx === -1) return [];
    const tail = prompt.slice(idx + startMarker.length);
    let end = tail.length;
    for (const marker of endMarkers) {
      const pos = tail.indexOf(marker);
      if (pos !== -1) end = Math.min(end, pos);
    }
    return tail
      .slice(0, end)
      .split("\n")
      .filter((line) => line.trim().startsWith("- "))
      .map((line) => line.trim().slice(2).trim());
  }

  /** Synthesizer: answer strictly from the findings and memory in the prompt. */
  private composeFromPrompt(prompt: string): string {
    const findings = MockLlm.section(prompt, "Findings from the Researcher agent:\n", [
      "Recalled memory for this user:",
      "Write the answer",
    ]);
    const memory = MockLlm.section(prompt, "Recalled memory for this user:\n", [
      "Write the answer",
    ]);

    if (findings.length === 0 && memory.length === 0) {
      return (
        "I could not find anything in the graph for that question. " +
        "Try naming a service such as auth-service or payments-api."
      );
    }

    const parts: string[] = [];
    if (findings.length > 0) parts.push(...findings);
    if (memory.length > 0) {
      if (findings.length > 0) {
        parts.push("From your earlier sessions: " + memory.join(" "));
      } else {
        parts.push(
          "I did not find anything new in the graph for that, but " +
            "from your earlier sessions: " +
            memory.join(" "),
        );
      }
    }
    return parts.join("\n");
  }

  /** Pull the `Recalled memory for this user:` block out of the prompt. */
  private memoryLines(question: string): string[] {
    const marker = "Recalled memory for this user:";
    const idx = question.indexOf(marker);
    if (idx === -1) return [];
    let tail = question.slice(idx + marker.length);
    const end = tail.indexOf("Write the answer");
    if (end !== -1) tail = tail.slice(0, end);
    return tail
      .split("\n")
      .filter((line) => line.trim().startsWith("- "))
      .map((line) => line.trim().slice(2).trim())
      .slice(-3);
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Return the configured LLM, falling back to `MockLlm`.
 *
 * Selection order:
 *   1. `brainConfig().provider` if set — explicit beats implicit.
 *   2. `sarvam` / `anthropic` when the relevant key is present.
 *   3. `MockLlm` — the product must run offline for the demo.
 *
 * Never throws on a missing key — the product must run offline for the demo.
 */
export function getLlm(opts: { knownServices?: string[]; knownTopics?: string[] } = {}): BrainLlm {
  const config = brainConfig();
  const mock = () => new MockLlm(opts.knownServices, opts.knownTopics);
  switch (config.provider) {
    case "sarvam":
      return config.sarvam.apiKey
        ? new SarvamLlm(config.sarvam.apiKey, config.sarvam.model)
        : mock();
    case "anthropic":
      return config.anthropic.apiKey
        ? new AnthropicLlm(config.anthropic.apiKey, config.anthropic.model)
        : mock();
    case "mock":
    default:
      return mock();
  }
}
