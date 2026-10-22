/**
 * DeepSeek Messages transport — request parity with DeepSeek Harness.
 *
 * dsh talks to DeepSeek over the Anthropic-compatible Messages API:
 *
 *   POST {baseURL}/v1/messages          (baseURL defaults to
 *                                        https://api.deepseek.com/anthropic)
 *   x-api-key: <key>
 *   anthropic-version: 2023-06-01
 *   accept: text/event-stream
 *
 *   { model, stream: true, max_tokens, messages, system?, thinking,
 *     output_config?: { effort }, temperature?, stop_sequences?, tools?[] }
 *
 * We reuse the AI SDK Anthropic client for tool calling and SSE parsing, and
 * reshape the request it emits here so DeepSeek receives the same wire request
 * the harness sends (same endpoint, auth header, thinking policy, tool schema
 * and token cap).
 */
import { createAnthropic } from "@ai-sdk/anthropic";

/** dsh's default Messages root (`connection.baseURL`). */
export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com/anthropic";

/** dsh's default per-request output cap (`DEFAULT_MAX_TOKENS`). */
export const DEEPSEEK_DEFAULT_MAX_TOKENS = 256_000;

const ANTHROPIC_VERSION = "2023-06-01";

/** True when the endpoint host belongs to DeepSeek's official API. */
export function isDeepSeekBaseUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname === "deepseek.com" || url.hostname.endsWith(".deepseek.com");
  } catch {
    return false;
  }
}

/**
 * Resolve the base URL the AI SDK appends `/messages` to.
 *
 * Mirrors `messagesApiRoot()` from the harness: an explicit `/v1` root is kept
 * as-is. On the official host we also accept the bare host or the OpenAI-style
 * `/v1` base and move them under `/anthropic`, since that is where the Messages
 * API lives.
 */
export function deepseekMessagesBaseUrl(raw?: string | null): string {
  const value = (raw || DEEPSEEK_DEFAULT_BASE_URL).trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  const path = url.pathname.replace(/\/+$/, "");

  if (isDeepSeekBaseUrl(value)) {
    url.pathname = /\/anthropic\/v1$/i.test(path)
      ? path
      : /\/anthropic$/i.test(path)
        ? `${path}/v1`
        : "/anthropic/v1";
  } else {
    url.pathname = /\/v1$/i.test(path) ? path : `${path}/v1`;
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/**
 * OpenAI-compatible model-list URL for a DeepSeek provider, regardless of
 * whether the configured base is the bare host, `/v1`, or the Messages root
 * (`/anthropic/v1`).
 */
export function deepseekModelsUrl(raw?: string | null): string {
  const value = (raw || "https://api.deepseek.com").trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  const path = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/anthropic(?:\/v1)?$/i, "");
  url.pathname = `${path}/models`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Reshape an AI SDK Anthropic request body into the body dsh serializes.
 * Mutates and returns `body`.
 */
export function normalizeDeepSeekBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  body.stream = true;

  // dsh always declares the thinking policy: off unless the caller enables it.
  const thinking = body.thinking;
  const enabled =
    !!thinking &&
    typeof thinking === "object" &&
    (thinking as { type?: unknown }).type === "enabled";
  body.thinking = enabled ? { type: "enabled" } : { type: "disabled" };
  if (enabled) {
    const effort = (body.output_config as { effort?: unknown } | undefined)?.effort;
    body.output_config = {
      effort: effort === "low" || effort === "max" ? effort : "high",
    };
  } else {
    delete body.output_config;
  }

  // Anthropic-only conveniences the harness never sends.
  for (const key of [
    "tool_choice",
    "metadata",
    "top_p",
    "top_k",
    "mcp_servers",
    "container",
    "context_management",
    "speed",
    "service_tier",
    "inference_geo",
    "fallbacks",
    "cache_control",
  ]) {
    delete body[key];
  }

  // Messages tool schema: { name, description, input_schema }. The AI SDK adds
  // eager_input_streaming/strict/cache_control for Anthropic; DeepSeek's
  // compatibility layer does not expect them.
  if (Array.isArray(body.tools)) {
    const tools = body.tools
      .filter(
        (tool): tool is Record<string, unknown> =>
          !!tool &&
          typeof tool === "object" &&
          typeof (tool as { name?: unknown }).name === "string",
      )
      .map((tool) => ({
        name: tool.name as string,
        ...(tool.description !== undefined
          ? { description: tool.description }
          : {}),
        input_schema:
          tool.input_schema ??
          (tool as { parameters?: unknown }).parameters ?? {
            type: "object",
            properties: {},
          },
        ...(tool.defer_loading === true ? { defer_loading: true } : {}),
      }));
    if (tools.length > 0) body.tools = tools;
    else delete body.tools;
  }

  // The harness sends `system` as a single top-level string.
  if (Array.isArray(body.system)) {
    const system = body.system
      .map((block) =>
        typeof block === "string"
          ? block
          : ((block as { text?: unknown })?.text as string) ?? "",
      )
      .filter(Boolean)
      .join("\n\n");
    if (system) body.system = system;
    else delete body.system;
  }
  if (body.system === "") delete body.system;

  // Text turns are content blocks in the harness wire format.
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (
        message &&
        typeof message === "object" &&
        typeof (message as { content?: unknown }).content === "string"
      ) {
        (message as { content: unknown }).content = [
          { type: "text", text: (message as { content: string }).content },
        ];
      }
    }
  }

  if (
    typeof body.max_tokens !== "number" ||
    !Number.isFinite(body.max_tokens) ||
    body.max_tokens <= 0
  ) {
    body.max_tokens = DEEPSEEK_DEFAULT_MAX_TOKENS;
  }

  return body;
}

/**
 * `fetch` wrapper for the Anthropic client: same URL, headers and body as the
 * harness. Everything else (SSE parsing, tool calls, usage) stays with the SDK.
 */
export const deepseekFetch: typeof fetch = async (input, init) => {
  const request = new Request(input as RequestInfo | URL, init);
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return fetch(request);
  }
  if (request.method.toUpperCase() !== "POST" || !/\/messages$/u.test(url.pathname)) {
    return fetch(request);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await request.text()) as Record<string, unknown>;
  } catch {
    return fetch(request);
  }
  normalizeDeepSeekBody(body);

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.set("accept", "text/event-stream");
  headers.set("anthropic-version", ANTHROPIC_VERSION);
  // dsh only opts into Files / mid-conversation tool betas. We use neither, and
  // DeepSeek rejects unknown Anthropic betas, so strip whatever the SDK adds.
  headers.delete("anthropic-beta");
  headers.delete("authorization");

  return fetch(
    new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
      redirect: "error",
    }),
  );
};

export interface DeepSeekClientOptions {
  apiKey: string;
  baseUrl?: string | null;
  name?: string;
}

/**
 * Anthropic-protocol client pointed at the DeepSeek Messages API.
 *
 * Use with `streamText`: the transport always sends `stream: true`, matching
 * the harness, so a non-streaming `generateText` call cannot consume the SSE
 * response.
 */
export function createDeepSeekMessages(options: DeepSeekClientOptions) {
  return createAnthropic({
    name: options.name,
    apiKey: options.apiKey,
    baseURL: deepseekMessagesBaseUrl(options.baseUrl),
    fetch: deepseekFetch,
  });
}
