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

/**
 * Omnia's palette expressed as the renderer's shadcn variables. The renderer writes `styles.variables` straight onto
 * its root element, so these override its stock neutral theme while keeping its component shapes.
 */
const THEME_VARIABLES: Record<"light" | "dark", Record<string, string>> = {
  light: {
    "--radius": "0.375rem",
    "--background": "#ffffff",
    "--foreground": "#171717",
    "--card": "#fcfcfc",
    "--card-foreground": "#171717",
    "--popover": "#ffffff",
    "--popover-foreground": "#171717",
    "--primary": "#3ecf8e",
    "--primary-foreground": "#0b2e1e",
    "--secondary": "#f3f3f3",
    "--secondary-foreground": "#171717",
    "--muted": "#f3f3f3",
    "--muted-foreground": "#707070",
    "--accent": "#ededed",
    "--accent-foreground": "#171717",
    "--destructive": "#e54d2e",
    "--success": "#3ecf8e",
    "--warning": "#db8e00",
    "--info": "#0b6bcb",
    "--border": "#dfdfdf",
    "--input": "#d4d4d4",
    "--ring": "#3ecf8e",
    "--chart-1": "#3ecf8e",
    "--chart-2": "#097c4f",
    "--chart-3": "#8fe5bc",
    "--chart-4": "#0b6bcb",
    "--chart-5": "#db8e00",
    "--sidebar": "#f8f8f8",
    "--sidebar-foreground": "#171717",
    "--sidebar-primary": "#3ecf8e",
    "--sidebar-primary-foreground": "#0b2e1e",
    "--sidebar-accent": "#ededed",
    "--sidebar-accent-foreground": "#171717",
    "--sidebar-border": "#dfdfdf",
    "--sidebar-ring": "#3ecf8e",
  },
  dark: {
    "--radius": "0.375rem",
    "--background": "#171717",
    "--foreground": "#ededed",
    "--card": "#1c1c1c",
    "--card-foreground": "#ededed",
    "--popover": "#1c1c1c",
    "--popover-foreground": "#ededed",
    "--primary": "#3ecf8e",
    "--primary-foreground": "#0b2e1e",
    "--secondary": "#242424",
    "--secondary-foreground": "#ededed",
    "--muted": "#212121",
    "--muted-foreground": "#898989",
    "--accent": "#292929",
    "--accent-foreground": "#ededed",
    "--destructive": "#f56e4e",
    "--success": "#3ecf8e",
    "--warning": "#f1a10d",
    "--info": "#52a9ff",
    "--border": "#2e2e2e",
    "--input": "#363636",
    "--ring": "#3ecf8e",
    "--chart-1": "#3ecf8e",
    "--chart-2": "#8fe5bc",
    "--chart-3": "#00c573",
    "--chart-4": "#52a9ff",
    "--chart-5": "#f1a10d",
    "--sidebar": "#121212",
    "--sidebar-foreground": "#ededed",
    "--sidebar-primary": "#3ecf8e",
    "--sidebar-primary-foreground": "#0b2e1e",
    "--sidebar-accent": "#292929",
    "--sidebar-accent-foreground": "#ededed",
    "--sidebar-border": "#2e2e2e",
    "--sidebar-ring": "#3ecf8e",
  },
};

const THEME_FONTS =
  "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');" +
  "html,body{font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-feature-settings:'cv11','ss01';-webkit-font-smoothing:antialiased}" +
  "code,pre,kbd{font-family:'JetBrains Mono',ui-monospace,monospace}";

export function themeStyles(theme: "light" | "dark") {
  return { variables: THEME_VARIABLES[theme], css: { fonts: THEME_FONTS } };
}

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
    if (this.ready) {
      this.post({
        jsonrpc: "2.0",
        method: "ui/notifications/host-context-changed",
        params: { theme, styles: themeStyles(theme) },
      });
    }
  }

  teardown(): void {
    this.post({ jsonrpc: "2.0", id: `td-${Date.now()}`, method: "ui/resource-teardown", params: {} });
  }

  private context(): Json {
    return {
      theme: this.theme,
      styles: themeStyles(this.theme),
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
