/**
 * DeepSeek Messages transport: dsh-compatible endpoint + wire body.
 *
 * The harness calls POST {base}/v1/messages with x-api-key,
 * anthropic-version 2023-06-01, a top-level system, `thinking` on every
 * request, `output_config.effort` when thinking is on, and tools in
 * { name, description, input_schema } form. These tests pin that contract,
 * including a real request captured from the AI SDK client.
 *
 * Run: npx tsx --test tests/unit/deepseek.test.ts
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { jsonSchema, streamText } from "ai";

import {
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  createDeepSeekMessages,
  deepseekMessagesBaseUrl,
  deepseekModelsUrl,
  isDeepSeekBaseUrl,
  normalizeDeepSeekBody,
} from "@/lib/deepseek";

describe("DeepSeek endpoint resolution", () => {
  it("moves every official base onto /anthropic/v1", () => {
    assert.equal(
      deepseekMessagesBaseUrl(),
      "https://api.deepseek.com/anthropic/v1",
    );
    assert.equal(
      deepseekMessagesBaseUrl("https://api.deepseek.com"),
      "https://api.deepseek.com/anthropic/v1",
    );
    assert.equal(
      deepseekMessagesBaseUrl("https://api.deepseek.com/v1"),
      "https://api.deepseek.com/anthropic/v1",
    );
    assert.equal(
      deepseekMessagesBaseUrl("https://api.deepseek.com/anthropic"),
      "https://api.deepseek.com/anthropic/v1",
    );
    assert.equal(
      deepseekMessagesBaseUrl("https://api.deepseek.com/anthropic/v1/"),
      "https://api.deepseek.com/anthropic/v1",
    );
  });

  it("keeps the harness messagesApiRoot rule on other hosts", () => {
    assert.equal(
      deepseekMessagesBaseUrl("https://gateway.example.com"),
      "https://gateway.example.com/v1",
    );
    assert.equal(
      deepseekMessagesBaseUrl("https://gateway.example.com/v1"),
      "https://gateway.example.com/v1",
    );
  });

  it("detects DeepSeek hosts only", () => {
    assert.equal(isDeepSeekBaseUrl("https://api.deepseek.com/v1"), true);
    assert.equal(isDeepSeekBaseUrl("api.deepseek.com"), true);
    assert.equal(isDeepSeekBaseUrl("https://api.deepseek.com.evil.test"), false);
    assert.equal(isDeepSeekBaseUrl("https://lightning.ai/api/v1"), false);
    assert.equal(isDeepSeekBaseUrl(undefined), false);
  });

  it("lists models from the OpenAI-compatible root", () => {
    assert.equal(
      deepseekModelsUrl("https://api.deepseek.com"),
      "https://api.deepseek.com/models",
    );
    assert.equal(
      deepseekModelsUrl("https://api.deepseek.com/v1"),
      "https://api.deepseek.com/v1/models",
    );
    assert.equal(
      deepseekModelsUrl("https://api.deepseek.com/anthropic/v1"),
      "https://api.deepseek.com/models",
    );
  });
});

describe("normalizeDeepSeekBody", () => {
  it("declares thinking disabled and drops Anthropic-only fields", () => {
    const body = normalizeDeepSeekBody({
      model: "deepseek-flash",
      messages: [],
      tool_choice: { type: "auto" },
      metadata: { user_id: "u" },
      top_p: 0.9,
      cache_control: { type: "ephemeral" },
    });
    assert.equal(body.stream, true);
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.output_config, undefined);
    for (const key of ["tool_choice", "metadata", "top_p", "cache_control"]) {
      assert.equal(body[key], undefined, `${key} should be dropped`);
    }
    assert.equal(body.max_tokens, DEEPSEEK_DEFAULT_MAX_TOKENS);
  });

  it("keeps thinking enabled, drops the SDK budget and defaults effort to high", () => {
    const body = normalizeDeepSeekBody({
      thinking: { type: "enabled", budget_tokens: 4096 },
      max_tokens: 8192,
    });
    assert.deepEqual(body.thinking, { type: "enabled" });
    assert.deepEqual(body.output_config, { effort: "high" });
    assert.equal(body.max_tokens, 8192);
  });

  it("preserves an explicit low/max effort", () => {
    for (const effort of ["low", "max"] as const) {
      const body = normalizeDeepSeekBody({
        thinking: { type: "enabled" },
        output_config: { effort },
      });
      assert.deepEqual(body.output_config, { effort });
    }
  });

  it("rewrites tools to the Messages schema", () => {
    const body = normalizeDeepSeekBody({
      tools: [
        {
          name: "run",
          description: "Run a command",
          input_schema: { type: "object", properties: { cmd: { type: "string" } } },
          eager_input_streaming: true,
          strict: true,
          cache_control: { type: "ephemeral" },
        },
      ],
    });
    assert.deepEqual(body.tools, [
      {
        name: "run",
        description: "Run a command",
        input_schema: { type: "object", properties: { cmd: { type: "string" } } },
      },
    ]);
  });

  it("joins system blocks and normalizes text turns to content blocks", () => {
    const body = normalizeDeepSeekBody({
      system: [{ type: "text", text: "a" }, { type: "text", text: "b" }],
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(body.system, "a\n\nb");
    assert.deepEqual(body.messages, [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
  });
});

const SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"deepseek-flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":3,"output_tokens":0}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"pong"}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
].join("");

describe("createDeepSeekMessages request on the wire", () => {
  let server: http.Server;
  let baseUrl: string;
  let captured: {
    url?: string;
    headers?: http.IncomingHttpHeaders;
    body?: {
      model?: string;
      stream?: boolean;
      system?: string;
      thinking?: unknown;
      output_config?: unknown;
      max_tokens?: number;
      tool_choice?: unknown;
      tools?: unknown;
      messages?: unknown;
    };
  };

  before(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        captured = {
          url: req.url,
          headers: req.headers,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        };
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(SSE);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sends the harness endpoint, headers and body", async () => {
    captured = {};
    const client = createDeepSeekMessages({ apiKey: "test-key", baseUrl });
    const result = streamText({
      model: client("deepseek-flash"),
      system: "be useful",
      prompt: "ping",
      maxOutputTokens: DEEPSEEK_DEFAULT_MAX_TOKENS,
      tools: {
        ping: {
          description: "Ping the model",
          inputSchema: jsonSchema({
            type: "object",
            properties: { q: { type: "string" } },
            required: ["q"],
          }),
        },
      },
      providerOptions: {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: 0 },
          effort: "high",
        },
      },
    });

    await result.text;
    assert.ok(captured.body, "the request should have reached the mock server");

    assert.equal(captured.url, "/v1/messages");
    assert.equal(captured.headers?.["x-api-key"], "test-key");
    assert.equal(captured.headers?.["anthropic-version"], "2023-06-01");
    assert.match(String(captured.headers?.accept), /text\/event-stream/);
    assert.equal(captured.headers?.["anthropic-beta"], undefined);

    const body = captured.body;
    assert.equal(body.model, "deepseek-flash");
    assert.equal(body.stream, true);
    assert.equal(body.system, "be useful");
    assert.deepEqual(body.thinking, { type: "enabled" });
    assert.deepEqual(body.output_config, { effort: "high" });
    assert.equal(body.max_tokens, DEEPSEEK_DEFAULT_MAX_TOKENS);
    assert.equal(body.tool_choice, undefined);
    assert.deepEqual(body.tools, [
      {
        name: "ping",
        description: "Ping the model",
        input_schema: {
          type: "object",
          properties: { q: { type: "string" } },
          required: ["q"],
        },
      },
    ]);
    assert.deepEqual(body.messages, [
      { role: "user", content: [{ type: "text", text: "ping" }] },
    ]);
  });

  it("declares thinking disabled when the run has thinking off", async () => {
    captured = {};
    const client = createDeepSeekMessages({ apiKey: "test-key", baseUrl });
    const result = streamText({
      model: client("deepseek-flash"),
      prompt: "ping",
      maxOutputTokens: DEEPSEEK_DEFAULT_MAX_TOKENS,
    });

    await result.text;
    assert.ok(captured.body, "the request should have reached the mock server");
    assert.deepEqual(captured.body.thinking, { type: "disabled" });
    assert.equal(captured.body.output_config, undefined);
  });
});
