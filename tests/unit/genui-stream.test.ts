/**
 * The GenUI stream end to end, minus the network: a model writes a render_ui call token by token ->
 * AI SDK UI-message stream -> run buffer -> coalesced SSE frames -> (dropped connections) -> resilient client ->
 * UI message reader. Verifies the UI streams in progressively, survives drops, and the final message is exact.
 *
 * Run: npx tsx --test tests/unit/genui-stream.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isStepCount, readUIMessageStream, streamText, toUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";

import { buildGenUiTools } from "@/lib/genui/tools";
import { GENUI_EXAMPLE } from "@/lib/genui/prompt";
import { repairPartialEnvelope, validateEnvelope } from "@/lib/genui/envelope";
import { SseParser, coalesceChunks, formatFrame } from "@/lib/sse";
import { resilientSse } from "@/lib/resilient-sse";

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function fakeModel(input: unknown, deltaSize = 23) {
  const json = JSON.stringify({ title: "Sales", ui: input });
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      call++;
      if (call === 1) {
        const deltas: string[] = [];
        for (let i = 0; i < json.length; i += deltaSize) deltas.push(json.slice(i, i + deltaSize));
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            { type: "tool-input-start", id: "call-1", toolName: "render_ui" },
            ...deltas.map((delta) => ({ type: "tool-input-delta", id: "call-1", delta })),
            { type: "tool-input-end", id: "call-1" },
            { type: "tool-call", toolCallId: "call-1", toolName: "render_ui", input: json },
            { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
          ] as never),
        };
      }
      return {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Here is your dashboard." },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
        ] as never),
      };
    },
  });
}

async function runChunks(input: unknown): Promise<UIMessageChunk[]> {
  const result = streamText({
    model: fakeModel(input),
    prompt: "build a dashboard",
    tools: buildGenUiTools(),
    stopWhen: isStepCount(4),
  });
  const stream = toUIMessageStream({ stream: result.stream, tools: buildGenUiTools(), sendStart: true, generateMessageId: () => "m1" } as never);
  const out: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

/** Serve `chunks` like /events: frames with ids from a cursor, optionally dying after a few frames. */
function server(chunks: UIMessageChunk[], cutAfter: () => number | null, coalesce = true) {
  const enc = new TextEncoder();
  const respond = (cursor: number): Response => {
    // `coalesce=false` mimics a live stream (each chunk flushed as it is produced); true mimics a reader that fell behind.
    const frames = coalesce ? coalesceChunks(chunks, cursor, chunks.length) : chunks.map((chunk, i) => ({ id: i + 1, chunk })).slice(cursor);
    const cut = cutAfter();
    let i = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          if (cut !== null && i >= cut) return c.error(new Error("drop"));
          if (i < frames.length) c.enqueue(enc.encode(formatFrame(JSON.stringify(frames[i].chunk), frames[i].id)));
          else {
            c.enqueue(enc.encode(formatFrame("[DONE]")));
            return c.close();
          }
          i++;
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const fetchFn = (async (url: string) => respond(Number(new URL(url, "http://x").searchParams.get("cursor") ?? 0))) as unknown as typeof fetch;
  return { respond, fetchFn };
}

async function clientMessages(res: Response): Promise<UIMessage[]> {
  const parser = new SseParser();
  const dec = new TextDecoder();
  const body = res.body!;
  const chunkStream = new ReadableStream<UIMessageChunk>({
    async start(c) {
      const reader = body.getReader();
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        for (const f of parser.feed(dec.decode(r.value, { stream: true }))) if (f.data && f.data !== "[DONE]") c.enqueue(JSON.parse(f.data));
      }
      c.close();
    },
  });
  const snapshots: UIMessage[] = [];
  for await (const m of readUIMessageStream<UIMessage>({ stream: chunkStream })) snapshots.push(structuredClone(m));
  return snapshots;
}

const toolPart = (m: UIMessage) => m.parts.find((p) => p.type === "tool-render_ui") as unknown as { state: string; input?: { ui?: unknown }; output?: { ok: boolean } } | undefined;

describe("render_ui through the stream", () => {
  it("emits tool-input deltas the client can render progressively, then a validated output", async () => {
    const chunks = await runChunks(GENUI_EXAMPLE);
    assert.ok(chunks.filter((c) => c.type === "tool-input-delta").length > 20, "input streams as many deltas");
    const s = server(chunks, () => null, false);
    const snaps = await clientMessages(s.respond(0));

    // Progressive: the number of renderable components never shrinks and the final one is complete.
    let renders = 0;
    let prev = 0;
    for (const m of snaps) {
      const p = toolPart(m);
      if (p?.state === "input-streaming" || p?.state === "input-available") {
        const env = repairPartialEnvelope((p.input as { ui?: unknown } | undefined)?.ui);
        if (env) {
          renders++;
          const size = JSON.stringify(env).length;
          assert.ok(size >= prev - 40, "partial UI does not collapse while streaming");
          prev = Math.max(prev, size);
        }
      }
    }
    assert.ok(renders >= 5, `rendered progressively (${renders} renders)`);

    const last = snaps.at(-1)!;
    const p = toolPart(last)!;
    assert.equal(p.state, "output-available");
    assert.equal(p.output?.ok, true);
    assert.deepEqual(validateEnvelope(p.input!.ui).envelope, validateEnvelope(GENUI_EXAMPLE).envelope);
    assert.ok(last.parts.some((x) => x.type === "text" && (x as { text: string }).text.includes("dashboard")));
  });

  it("is identical after random connection drops (no gaps, no duplicated deltas)", async () => {
    const chunks = await runChunks(GENUI_EXAMPLE);
    const clean = await clientMessages(server(chunks, () => null).respond(0));
    const finalClean = JSON.stringify(clean.at(-1)!.parts);
    for (let trial = 0; trial < 12; trial++) {
      let n = 0;
      const s = server(chunks, () => (n++ < 8 ? 2 + ((trial * 5 + n * 11) % 9) : null));
      const res = resilientSse(s.respond(0), { runId: "r", fetchFn: s.fetchFn, baseDelayMs: 1 });
      const snaps = await clientMessages(res);
      assert.equal(JSON.stringify(snaps.at(-1)!.parts), finalClean, `trial ${trial}`);
    }
  });

  it("returns precise errors for an invalid UI so the model can fix it", async () => {
    const bad = { version: "0.3", view: { type: "Column", children: [{ type: "Metrik", label: "x" }, { type: "Button", label: "b", onClick: { action: "toolCall", tool: "t" } }] } };
    const tools = buildGenUiTools();
    const out = (await tools.render_ui.execute!({ ui: bad as never }, { toolCallId: "c", messages: [] } as never)) as { ok: boolean; errors: string[] };
    assert.equal(out.ok, false);
    assert.equal(out.errors.length, 2);
    assert.match(out.errors[0], /Metric/);
  });
});
