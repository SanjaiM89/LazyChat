/**
 * Generative UI: envelope validation/repair, catalog search, and the MCP-Apps host bridge.
 *
 * Run: npx tsx --test tests/unit/genui.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePartialJson } from "ai";

import { MAX_ENVELOPE_CHARS, repairPartialEnvelope, searchCatalog, validateEnvelope } from "@/lib/genui/envelope";
import { GENUI_EXAMPLE, GENUI_PROMPT } from "@/lib/genui/prompt";
import { PrefabHost } from "@/lib/genui/host";

const view = (children: unknown[]) => ({ version: "0.3", view: { type: "Column", children } });

describe("validateEnvelope", () => {
  it("accepts the example from the system prompt without errors or warnings", () => {
    const v = validateEnvelope(GENUI_EXAMPLE);
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.warnings, []);
    assert.ok(v.ok && v.envelope);
    assert.ok(v.nodes > 10);
    assert.ok(GENUI_PROMPT.includes('"type":"Metric"'));
  });

  it("suggests the closest component for a typo", () => {
    const v = validateEnvelope(view([{ type: "Metrik", label: "x" }]));
    assert.equal(v.ok, false);
    assert.match(v.errors[0], /did you mean "Metric"/);
  });

  it("rejects tool calls, fetches and non-http links with actionable messages", () => {
    const v = validateEnvelope(
      view([
        { type: "Button", label: "a", onClick: { action: "toolCall", tool: "x" } },
        { type: "Button", label: "b", onClick: [{ action: "fetch", url: "https://x" }] },
        { type: "Button", label: "c", onClick: { action: "openLink", url: "javascript:alert(1)" } },
      ]),
    );
    assert.equal(v.ok, false);
    assert.equal(v.errors.length, 3);
    assert.match(v.errors[0], /sendMessage/);
    assert.match(v.errors[2], /http/);
  });

  it("allows the safe actions, including sendMessage and showToast arrays", () => {
    const v = validateEnvelope(
      view([
        {
          type: "Button",
          label: "go",
          onClick: [
            { action: "setState", key: "a", value: 1 },
            { action: "showToast", message: "hi" },
            { action: "sendMessage", content: "hello" },
          ],
        },
      ]),
    );
    assert.deepEqual(v.errors, []);
  });

  it("blocks Embed, reserved state keys, oversized and over-deep UIs", () => {
    assert.equal(validateEnvelope(view([{ type: "Embed", url: "https://evil" }])).ok, false);
    assert.equal(validateEnvelope({ ...view([]), state: { $x: 1 } }).ok, false);
    assert.equal(validateEnvelope(view([{ type: "Markdown", content: "x".repeat(MAX_ENVELOPE_CHARS) }])).ok, false);
    let deep: Record<string, unknown> = { type: "Text", content: "x" };
    for (let i = 0; i < 60; i++) deep = { type: "Column", children: [deep] };
    assert.equal(validateEnvelope({ view: deep }).ok, false);
  });

  it("wraps bare-string children and accepts a bare root component", () => {
    const v = validateEnvelope({ type: "Column", children: ["hello"] });
    assert.ok(v.ok);
    assert.deepEqual((v.envelope!.view.children as unknown[])[0], { type: "Text", content: "hello" });
    assert.ok(v.warnings.some((w) => /wrapped/.test(w)));
  });

  it("drops css/stylesheets/handlers instead of passing them to the renderer", () => {
    const v = validateEnvelope({ ...view([]), css: "body{display:none}", stylesheets: ["https://evil/x.css"], jsActions: { a: "alert(1)" } });
    assert.ok(v.ok);
    assert.deepEqual(Object.keys(v.envelope!).sort(), ["version", "view"]);
  });
});

describe("repairPartialEnvelope", () => {
  const text = JSON.stringify(GENUI_EXAMPLE);

  it("never throws on any prefix and converges to the validated envelope", async () => {
    let rendered = 0;
    for (let n = 0; n <= text.length; n += 5) {
      const { value } = await parsePartialJson(text.slice(0, n));
      if (repairPartialEnvelope(value)) rendered++;
    }
    assert.ok(rendered > 20, "renders early and keeps rendering as it streams");
    const full = repairPartialEnvelope(JSON.parse(text));
    assert.deepEqual(full, validateEnvelope(GENUI_EXAMPLE).envelope);
  });

  it("renders nothing until a valid root component exists", async () => {
    for (const s of ['{"view":', '{"view":{"type":"', '{"view":{"type":"Col']) {
      const { value } = await parsePartialJson(s);
      assert.equal(repairPartialEnvelope(value), null, s);
    }
    const { value } = await parsePartialJson('{"view":{"type":"Column","children":[{"type":"Text","content":"Hel');
    const env = repairPartialEnvelope(value);
    assert.deepEqual(env?.view.children, [{ type: "Text", content: "Hel" }]);
  });

  it("returns null for garbage rather than throwing", () => {
    for (const v of [null, undefined, 5, "x", [], { view: 3 }]) assert.equal(repairPartialEnvelope(v), null);
  });
});

describe("searchCatalog", () => {
  it("finds real components with prop names", () => {
    const r = searchCatalog("bar chart");
    assert.ok(r.results.some((c) => c.type === "BarChart"));
    const bar = r.results.find((c) => c.type === "BarChart")!;
    assert.ok(bar.props.some((p) => p.name === "series"));
    assert.ok(r.shapes.some((s) => s.name === "ChartSeries"));
  });
  it("knows data tables and control flow", () => {
    assert.ok(searchCatalog("table").results.some((c) => c.type === "DataTable"));
    assert.ok(searchCatalog("condition").results.some((c) => c.type === "Condition"));
  });
});

describe("PrefabHost", () => {
  function setup() {
    const sent: Record<string, unknown>[] = [];
    const events: string[] = [];
    const host = new PrefabHost(
      (m) => sent.push(m),
      {
        onUserMessage: (t) => events.push("msg:" + t),
        onOpenLink: (u) => events.push("link:" + u),
        onSize: (h) => events.push("size:" + h),
        onReady: () => events.push("ready"),
      },
      "dark",
    );
    return { host, sent, events };
  }
  const rpc = (method: string, params: unknown, id?: number) => ({ jsonrpc: "2.0", method, params, ...(id !== undefined ? { id } : {}) });

  it("answers ui/initialize with host info and context", () => {
    const { host, sent } = setup();
    host.handle(rpc("ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "Prefab", version: "1" }, appCapabilities: {} }, 1));
    const r = sent[0] as { id: number; result: { protocolVersion: string; hostContext: { theme: string } } };
    assert.equal(r.id, 1);
    assert.equal(r.result.protocolVersion, "2026-01-26");
    assert.equal(r.result.hostContext.theme, "dark");
  });

  it("queues the envelope until the renderer is initialized, then delivers it as a tool result", () => {
    const { host, sent, events } = setup();
    const env = validateEnvelope(GENUI_EXAMPLE).envelope!;
    host.sendEnvelope(env);
    assert.equal(sent.length, 0);
    host.handle(rpc("ui/notifications/initialized", {}));
    assert.deepEqual(events, ["ready"]);
    const m = sent[0] as { method: string; params: { structuredContent: unknown } };
    assert.equal(m.method, "ui/notifications/tool-result");
    assert.deepEqual(m.params.structuredContent, env);
    host.sendEnvelope(env);
    assert.equal(sent.length, 2);
  });

  it("routes ui/message to the chat, opens only http(s) links and refuses tool calls", () => {
    const { host, sent, events } = setup();
    host.handle(rpc("ui/message", { role: "user", content: [{ type: "text", text: "Explain" }] }, 2));
    host.handle(rpc("ui/message", { role: "user", content: [] }, 3));
    host.handle(rpc("ui/open-link", { url: "https://example.com" }, 4));
    host.handle(rpc("ui/open-link", { url: "javascript:alert(1)" }, 5));
    host.handle(rpc("tools/call", { name: "x" }, 6));
    host.handle(rpc("ui/notifications/size-changed", { width: 500, height: 321.2 }));
    assert.deepEqual(events, ["msg:Explain", "link:https://example.com", "size:322"]);
    const byId = (id: number) => sent.find((m) => m.id === id) as { result?: unknown; error?: { code: number } };
    assert.ok(byId(2).result);
    assert.equal(byId(3).error?.code, -32602);
    assert.ok(byId(4).result);
    assert.equal(byId(5).error?.code, -32602);
    assert.equal(byId(6).error?.code, -32601);
  });

  it("ignores junk and only notifies theme changes after the handshake", () => {
    const { host, sent } = setup();
    host.handle("nope");
    host.handle({ jsonrpc: "1.0" });
    host.setTheme("light");
    assert.equal(sent.length, 0);
    host.handle(rpc("ui/notifications/initialized", {}));
    host.setTheme("dark");
    assert.equal((sent.at(-1) as { method: string }).method, "ui/notifications/host-context-changed");
  });
});
