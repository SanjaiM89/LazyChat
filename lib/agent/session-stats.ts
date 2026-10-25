/**
 * Session statistics and the turn outline.
 *
 * Both fold over the durable session log, so they describe the whole
 * conversation rather than the part the client has paged in, and both are
 * deterministic: the same log always produces the same figures.
 */
import type { SessionEvent } from "@/lib/agent/session";
import { estimateTokens } from "@/lib/agent/token-meter";

export interface SessionStats {
  /** The turns that carry at least one closed step. */
  turns: number;
  /** The closed steps, completed, failed and cancelled alike. */
  steps: number;
  /** The summed model wall time. */
  llmMs: number;
  /** The summed tool wall time over the matched call and result pairs. */
  toolMs: number;
  /** The summed first-token latency. */
  ttftMs: number;
  /** The steps that recorded a first token. */
  ttftSteps: number;
  /** The summed decode wall time. */
  decodeMs: number;
  /** The output tokens of the assistant's messages. */
  decodeTokens: number;
}

export interface TurnOutline {
  /** The turn number. */
  turn: number;
  /** The opening words of what the user asked for. */
  intent: string;
  /** How the turn ended. */
  status: string;
  /** The tools the turn called. */
  tools: string[];
  /** The assistant's closing words. */
  summary: string;
}

interface EventData {
  text?: string;
  tool?: string;
  toolCallId?: string;
  status?: string;
  step?: number;
  llm_ms?: number;
  ttft_ms?: number;
  [key: string]: unknown;
}

function data(event: SessionEvent): EventData {
  return (event.data ?? {}) as EventData;
}

/**
 * The whole-log figures for a session.
 */
export function computeSessionStats(events: SessionEvent[]): SessionStats {
  const stats: SessionStats = {
    turns: 0,
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
  };

  const stepEnds = events.filter((e) => e.type === "step/end");
  stats.steps = stepEnds.length;
  for (const event of stepEnds) {
    const d = data(event);
    const llm = d.llm_ms ?? 0;
    const ttft = d.ttft_ms ?? 0;
    stats.llmMs += llm;
    if (d.ttft_ms !== undefined) {
      stats.ttftMs += ttft;
      stats.ttftSteps += 1;
    }
    stats.decodeMs += Math.max(0, llm - ttft);
  }

  // The tool wall time pairs each call with its result.
  const open = new Map<string, number>();
  for (const event of events) {
    const d = data(event);
    if (event.type === "tool/call" && d.toolCallId) {
      open.set(d.toolCallId, event.created_at);
    } else if (event.type === "tool/result" && d.toolCallId) {
      const started = open.get(d.toolCallId);
      if (started !== undefined) {
        stats.toolMs += Math.max(0, event.created_at - started);
        open.delete(d.toolCallId);
      }
    }
  }

  // The turns that carry a closed step.
  let turnOpen = false;
  let turnHasStep = false;
  for (const event of events) {
    if (event.type === "turn/start") {
      turnOpen = true;
      turnHasStep = false;
    } else if (event.type === "step/end" && turnOpen) {
      turnHasStep = true;
    } else if (event.type === "turn/end" && turnOpen) {
      if (turnHasStep) stats.turns += 1;
      turnOpen = false;
    }
  }

  // The output tokens of what the assistant wrote.
  for (const event of events) {
    if (event.type !== "assistant/message") continue;
    const text = data(event).text ?? "";
    if (text) stats.decodeTokens += estimateTokens(text);
  }

  return stats;
}

/**
 * A compact outline of the session's turns.
 */
export function buildTurnOutline(events: SessionEvent[]): TurnOutline[] {
  const turns: TurnOutline[] = [];
  let current: TurnOutline | null = null;
  let started = false;

  const openTurn = (): TurnOutline => {
    const turn: TurnOutline = {
      turn: turns.length + 1,
      intent: "",
      status: "open",
      tools: [],
      summary: "",
    };
    turns.push(turn);
    return turn;
  };

  for (const event of events) {
    const d = data(event);
    if (event.type === "turn/start") {
      current = openTurn();
      started = true;
      continue;
    }
    if (!current && started) current = openTurn();
    if (!current) continue;
    if (event.type === "user/message") {
      if (!current.intent) current.intent = firstWords(d.text ?? "", 12);
    } else if (event.type === "tool/call") {
      if (d.tool && !current.tools.includes(d.tool)) current.tools.push(d.tool);
    } else if (event.type === "assistant/message") {
      const text = d.text ?? "";
      if (text) current.summary = firstWords(text, 24);
    } else if (event.type === "turn/end") {
      current.status = d.status ?? "done";
      current = null;
    }
  }
  return turns;
}

/** The leading words of a text, for a label. */
function firstWords(text: string, words: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  const parts = collapsed.split(" ");
  return parts.length <= words ? collapsed : `${parts.slice(0, words).join(" ")}…`;
}
