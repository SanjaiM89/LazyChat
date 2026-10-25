/**
 * The token meter.
 *
 * A deterministic measurement of what a request costs: no model call, no
 * randomness, the same messages always give the same number. Compaction, the
 * occupancy readout and the telemetry all read the same figures, so they
 * cannot disagree.
 *
 * The count is an estimate, not a tokenizer's: roughly four characters to a
 * token, plus a small framing cost per message. It is exact enough to decide
 * when a turn is about to overflow the window, which is what it is for.
 */
import { contextWindow } from "@/lib/agent/compaction";

/** The characters that make up a token, on average. */
export const CHARS_PER_TOKEN = 4;

/** The framing a message adds around its text. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

export interface Measurement {
  /** The characters measured. */
  chars: number;
  /** The tokens measured. */
  tokens: number;
}

/** The tokens a piece of text costs. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

/** Measure a piece of text. */
export function measureText(text: string): Measurement {
  return { chars: text.length, tokens: estimateTokens(text) };
}

/** Measure any value: a string, or the JSON of anything else. */
export function measureValue(value: unknown): Measurement {
  if (typeof value === "string") return measureText(value);
  if (value === undefined || value === null) return { chars: 0, tokens: 0 };
  try {
    return measureText(JSON.stringify(value) ?? "");
  } catch {
    return measureText(String(value));
  }
}

/** One message's contribution. */
export interface MessageMeasurement {
  /** The role, when the message has one. */
  role?: string;
  chars: number;
  tokens: number;
}

/** The shape the meter accepts: a model message or a UI message. */
type MeasurableMessage = {
  role?: string;
  content?: unknown;
  parts?: unknown;
};

function textOf(message: MeasurableMessage): string {
  if (typeof message.content === "string") return message.content;
  const parts: string[] = [];
  const walk = (value: unknown, depth = 0): void => {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      // A part's own text.
      if (typeof record.text === "string") parts.push(record.text);
      // A tool result carries its payload.
      if ("output" in record) walk(record.output, depth + 1);
      if ("result" in record) walk(record.result, depth + 1);
      if ("content" in record) walk(record.content, depth + 1);
    }
  };
  walk(message.parts ?? message.content, 0);
  return parts.join("\n");
}

/**
 * Measure a set of messages.
 *
 * @param messages - The messages of a request, in any shape.
 * @returns The totals and the per-message breakdown.
 */
export function measureMessages(messages: MeasurableMessage[]): {
  chars: number;
  tokens: number;
  breakdown: MessageMeasurement[];
} {
  const breakdown: MessageMeasurement[] = [];
  let chars = 0;
  let tokens = 0;
  for (const message of messages ?? []) {
    const text = textOf(message);
    const measured = measureText(text);
    const withOverhead = measured.tokens + MESSAGE_OVERHEAD_TOKENS;
    chars += measured.chars;
    tokens += withOverhead;
    breakdown.push({ role: message.role, chars: measured.chars, tokens: withOverhead });
  }
  return { chars, tokens, breakdown };
}

export interface ContextPressure {
  /** The tokens the request costs. */
  inputTokens: number;
  /** The window the model has. */
  window: number;
  /** The share of the window the request fills. */
  ratio: number;
  /** The room the answer itself needs. */
  headroomTokens: number;
  /** The room left after the answer. */
  remainingTokens: number;
  /** Whether the request cannot fit. */
  overBudget: boolean;
}

/**
 * How full the window is.
 *
 * @param inputTokens - What the request costs.
 * @param provider - The model provider.
 * @param model - The model.
 * @param opts - The headroom the answer needs.
 */
export function contextPressure(
  inputTokens: number,
  provider: string,
  model: string,
  opts: { headroomTokens?: number } = {},
): ContextPressure {
  const window = contextWindow(provider, model);
  const headroom = opts.headroomTokens ?? Math.floor(window * 0.1);
  const ratio = window > 0 ? inputTokens / window : 0;
  return {
    inputTokens,
    window,
    ratio,
    headroomTokens: headroom,
    remainingTokens: Math.max(0, window - inputTokens - headroom),
    overBudget: window > 0 && inputTokens + headroom > window,
  };
}
