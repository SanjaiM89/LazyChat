/**
 * A minimal MCP-Apps host for the official Prefab renderer.
 *
 * The renderer (public/prefab, from @prefecthq/prefab-ui) is an MCP App: it talks JSON-RPC 2.0 to its parent window
 * over postMessage. We play the host: answer `ui/initialize`, push the UI envelope as a `tool-result`
 * (structuredContent), and route what the UI asks for - `ui/message` becomes a chat message, `ui/open-link` opens
 * http(s) links, everything else (tool calls, context updates) is refused or ignored.
 *
 * This file is transport-agnostic: give it a `post` function and feed it incoming messages.
 */
import type { Envelope } from "./envelope";

export const PREFAB_PROTOCOL_FALLBACK = "2026-01-26";

export interface HostCallbacks {
  /** The UI asked the assistant to do something (SendMessage action). */
  onUserMessage: (text: string) => void;
  onOpenLink: (url: string) => void;
  /** Content height in px reported by the renderer. */
  onSize: (height: number) => void;
  /** Renderer finished its handshake; envelopes can now be delivered. */
  onReady: () => void;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

export class PrefabHost {
  private ready = false;
  private theme: "light" | "dark";
  private pending: Envelope | null = null;

  constructor(
    private readonly post: (message: Json) => void,
    private readonly cb: HostCallbacks,
    theme: "light" | "dark" = "light",
  ) {
    this.theme = theme;
  }

  get isReady() {
    return this.ready;
  }

  /** Handle one JSON-RPC message from the renderer. */
  handle(data: unknown): void {
    if (!isObj(data) || data.jsonrpc !== "2.0" || typeof data.method !== "string") return;
    const { id, method } = data;
    const params = isObj(data.params) ? data.params : {};
    const hasId = typeof id === "string" || typeof id === "number";
    const reply = (result: unknown) => hasId && this.post({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) => hasId && this.post({ jsonrpc: "2.0", id, error: { code, message } });

    switch (method) {
      case "ui/initialize":
        return void reply({
          protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : PREFAB_PROTOCOL_FALLBACK,
          hostInfo: { name: "Omnia", version: "1.0.0" },
          hostCapabilities: { openLinks: {}, message: { text: {} }, updateModelContext: { text: {} } },
          hostContext: this.context(),
        });
      case "ui/notifications/initialized":
        this.ready = true;
        this.cb.onReady();
        if (this.pending) {
          const e = this.pending;
          this.pending = null;
          this.sendEnvelope(e);
        }
        return;
      case "ui/notifications/size-changed": {
        const h = Number(params.height);
        if (Number.isFinite(h) && h > 0) this.cb.onSize(Math.ceil(h));
        return;
      }
      case "ui/message": {
        const text = extractText(params.content);
        if (!text) return void fail(-32602, "Empty message");
        this.cb.onUserMessage(text);
        return void reply({});
      }
      case "ui/open-link": {
        const url = typeof params.url === "string" ? params.url : "";
        if (!/^https?:\/\//i.test(url)) return void fail(-32602, "Only http(s) links can be opened");
        this.cb.onOpenLink(url);
        return void reply({});
      }
      case "ui/update-model-context":
        return void reply({});
      case "ui/request-display-mode":
        return void reply({ mode: "inline" });
      case "ping":
        return void reply({});
      case "tools/call":
      case "resources/read":
      case "tools/list":
        return void fail(-32601, "Not supported in this host");
      default:
        // Notifications (logging, etc.) need no answer; unknown requests get a proper error.
        if (hasId) fail(-32601, `Unknown method ${method}`);
    }
  }

  /** Deliver (or queue until the handshake finishes) an envelope; it replaces what is on screen. */
  sendEnvelope(envelope: Envelope): void {
    if (!this.ready) {
      this.pending = envelope;
      return;
    }
    this.post({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { content: [{ type: "text", text: "UI rendered" }], structuredContent: envelope },
    });
  }

  setTheme(theme: "light" | "dark"): void {
    if (theme === this.theme) return;
    this.theme = theme;
    if (this.ready) this.post({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme } });
  }

  teardown(): void {
    this.post({ jsonrpc: "2.0", id: `td-${Date.now()}`, method: "ui/resource-teardown", params: {} });
  }

  private context(): Json {
    return {
      theme: this.theme,
      displayMode: "inline",
      availableDisplayModes: ["inline"],
      platform: "web",
      locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
      timeZone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
    };
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (isObj(c) && c.type === "text" && typeof c.text === "string" ? c.text : ""))
    .join("\n")
    .trim();
}
