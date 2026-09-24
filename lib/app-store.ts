"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AgentMeta,
  ArtifactMeta,
  ChatRunSummary,
  ChatSettings,
  ConversationMeta,
  MCPServerDef,
  MCPToolInfo,
  ProviderId,
  PublicCustomProvider,
  SandboxMeta,
  SkillDef,
} from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { getDefaultModel } from "@/lib/models";
import {
  DEFAULT_DISPLAY,
  clampDisplay,
  type DisplaySettings,
} from "@/lib/display";

/* ------------------------------------------------------------------ */
/*  Global client store                                                */
/* ------------------------------------------------------------------ */

export type PanelTab = "artifacts" | "sandbox" | "agents" | null;
export type ThemeMode = "system" | "light" | "dark";

interface AppStore {
  /* theme + layout */
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  panel: PanelTab;
  setPanel: (p: PanelTab) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (b: boolean) => void;

  /* chat settings */
  settings: ChatSettings;
  setSettings: (p: Partial<ChatSettings>) => void;
  toggleTool: (name: string) => void;

  /* conversations */
  conversations: ConversationMeta[];
  activeConversationId: string | null;
  loadConversations: () => Promise<void>;
  newConversation: () => void;
  setActiveConversation: (id: string | null) => void;
  deleteConversation: (id: string) => Promise<void>;

  /* artifacts */
  artifacts: ArtifactMeta[];
  openArtifactId: string | null;
  loadArtifacts: (conversationId?: string) => Promise<void>;
  openArtifact: (id: string) => void;
  closeArtifact: () => void;

  /* sandbox */
  sandboxStatus: "unknown" | "ok" | "down";
  setSandboxStatus: (s: "unknown" | "ok" | "down") => void;
  sandboxes: SandboxMeta[];
  activeSandboxId: string | null;
  registerSandbox: (s: SandboxMeta) => void;
  setSandboxScreenshot: (id: string, img: string) => void;
  setSandboxState: (id: string, state: SandboxMeta["state"], error?: string) => void;
  removeSandbox: (id: string) => void;
  setActiveSandbox: (id: string | null) => void;

  /* agents */
  agents: AgentMeta[];
  setAgents: (a: AgentMeta[]) => void;
  upsertAgent: (a: AgentMeta) => void;
  removeAgent: (id: string) => void;

  /* chat runs (background generation) */
  runs: ChatRunSummary[];
  setRuns: (r: ChatRunSummary[]) => void;

  /* skills + mcp */
  skills: SkillDef[];
  setSkills: (s: SkillDef[]) => void;
  mcpServers: MCPServerDef[];
  mcpTools: MCPToolInfo[];
  setMCP: (servers: MCPServerDef[], tools: MCPToolInfo[]) => void;

  /* custom providers */
  customProviders: PublicCustomProvider[];
  loadCustomProviders: () => Promise<void>;  /** create or update (edit when the def has an id); returns the saved provider */
  saveCustomProvider: (
    def: {
      id?: string;
      name: string;
      glyph?: string;
      baseUrl: string;
      apiKey?: string;
      apiKeyEnv?: string;
      protocol?: "openai" | "anthropic" | "gemini";
      models: { id: string; name?: string; supportsThinking?: boolean }[];
    },
  ) => Promise<PublicCustomProvider>;
  removeCustomProvider: (id: string) => Promise<void>;

  /* built-in provider API keys (OpenCode Zen, Anthropic, …) */
  apiKeysOpen: boolean;
  setApiKeysOpen: (b: boolean) => void;
  /** configured/source per keyed builtin — loaded from /api/provider-keys */
  providerKeyStatus: Record<string, { configured: boolean; source: string }>;
  loadProviderKeys: () => Promise<void>;

  /* reading display (font / size / width) */
  display: DisplaySettings;
  setDisplay: (p: Partial<DisplaySettings>) => void;
  resetDisplay: () => void;

  /* display settings dialog */
  displayOpen: boolean;
  setDisplayOpen: (b: boolean) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
      panel: null,
      setPanel: (panel) => set({ panel }),
      sidebarOpen: true,
      setSidebarOpen: (b) => set({ sidebarOpen: b }),

      settings: DEFAULT_SETTINGS,
      setSettings: (p) => set({ settings: { ...get().settings, ...p } }),
      toggleTool: (name) => {
        const s = get().settings;
        const tools = s.tools.includes(name)
          ? s.tools.filter((t) => t !== name)
          : [...s.tools, name];
        set({ settings: { ...s, tools } });
      },

      conversations: [],
      activeConversationId: null,
      loadConversations: async () => {
        try {
          const res = await fetch("/api/conversations", { cache: "no-store" });
          const data = await res.json();
          set({ conversations: data });
        } catch {
          /* ignore */
        }
      },
      newConversation: () => set({ activeConversationId: null, openArtifactId: null }),
      setActiveConversation: (id) => set({ activeConversationId: id }),
      deleteConversation: async (id) => {
        await fetch(`/api/conversations/${id}`, { method: "DELETE" });
        set({
          conversations: get().conversations.filter((c) => c.id !== id),
          activeConversationId:
            get().activeConversationId === id ? null : get().activeConversationId,
        });
      },

      artifacts: [],
      openArtifactId: null,
      loadArtifacts: async (conversationId) => {
        try {
          const q = conversationId ? `?conversationId=${conversationId}` : "";
          const res = await fetch(`/api/artifacts${q}`, { cache: "no-store" });
          set({ artifacts: await res.json() });
        } catch {
          /* ignore */
        }
      },
      openArtifact: (id) => set({ openArtifactId: id, panel: "artifacts" }),
      closeArtifact: () => set({ openArtifactId: null }),

      sandboxStatus: "unknown",
      setSandboxStatus: (s) => set({ sandboxStatus: s }),
      sandboxes: [],
      activeSandboxId: null,
      registerSandbox: (s) => {
        const prev = get().sandboxes.find((x) => x.id === s.id);
        // The /list snapshot carries no screenshot — preserve the live one set
        // by the screenshot poller, otherwise the panel flips back to the
        // console on every registry poll (browser "flashes" then disappears).
        const merged =
          prev && s.lastScreenshot == null
            ? { ...s, lastScreenshot: prev.lastScreenshot }
            : s;
        const existing = !!prev;
        set({
          sandboxes: existing
            ? get().sandboxes.map((x) => (x.id === s.id ? merged : x))
            : [...get().sandboxes, merged],
          activeSandboxId: get().activeSandboxId || s.id,
        });
      },
      setSandboxScreenshot: (id, img) =>
        set({
          sandboxes: get().sandboxes.map((x) =>
            x.id === id ? { ...x, lastScreenshot: img } : x,
          ),
        }),
      setSandboxState: (id, state, error) =>
        set({
          sandboxes: get().sandboxes.map((x) =>
            x.id === id ? { ...x, state, error } : x,
          ),
        }),
      removeSandbox: (id) =>
        set({
          sandboxes: get().sandboxes.filter((x) => x.id !== id),
          activeSandboxId:
            get().activeSandboxId === id ? null : get().activeSandboxId,
        }),
      setActiveSandbox: (id) => set({ activeSandboxId: id }),

      agents: [],
      setAgents: (a) => set({ agents: a }),
      upsertAgent: (a) => {
        const existing = get().agents.some((x) => x.id === a.id);
        set({
          agents: existing
            ? get().agents.map((x) => (x.id === a.id ? { ...x, ...a } : x))
            : [a, ...get().agents],
        });
      },
      removeAgent: (id) =>
        set({ agents: get().agents.filter((x) => x.id !== id) }),

      runs: [],
      setRuns: (runs) => set({ runs }),

      skills: [],
      setSkills: (s) => set({ skills: s }),
      mcpServers: [],
      mcpTools: [],
      setMCP: (servers, tools) => set({ mcpServers: servers, mcpTools: tools }),

      customProviders: [],
      loadCustomProviders: async () => {
        try {
          const res = await fetch("/api/custom-providers", { cache: "no-store" });
          if (!res.ok) return;
          const list = (await res.json()) as PublicCustomProvider[];
          if (Array.isArray(list)) applyCustomList(list);
        } catch {
          /* ignore */
        }
      },
      saveCustomProvider: async (def) => {
        const res = await fetch("/api/custom-providers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(def),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to save provider.");
        if (Array.isArray(data.providers)) applyCustomList(data.providers);
        return data.provider as PublicCustomProvider;
      },
      removeCustomProvider: async (id) => {
        const res = await fetch(
          `/api/custom-providers?id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.providers)) applyCustomList(data.providers);
        const s = get();
        if (s.settings.provider === id) {
          const model = getDefaultModel("anthropic") || "claude-sonnet-5";
          set({ settings: { ...s.settings, provider: "anthropic", model } });
        }
      },

      apiKeysOpen: false,
      setApiKeysOpen: (b) => set({ apiKeysOpen: b }),
      providerKeyStatus: {},
      loadProviderKeys: async () => {
        try {
          const res = await fetch("/api/provider-keys", { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          if (data && typeof data === "object") set({ providerKeyStatus: data });
        } catch {
          /* ignore */
        }
      },

      display: DEFAULT_DISPLAY,
      setDisplay: (p) =>
        set({ display: clampDisplay({ ...get().display, ...p }) }),
      resetDisplay: () => set({ display: DEFAULT_DISPLAY }),

      displayOpen: false,
      setDisplayOpen: (b) => set({ displayOpen: b }),
    }),
    {
      name: "omnia-store",
      partialize: (s) => ({
        theme: s.theme,
        settings: s.settings,
        activeConversationId: s.activeConversationId,
        display: s.display,
      }),
    },
  ),
);

/* ----------------------- derived helpers ----------------------- */

/** The live background run for a conversation, if any. */
export function activeRunFor(
  runs: ChatRunSummary[],
  conversationId: string | null | undefined,
): ChatRunSummary | null {
  if (!conversationId) return null;
  return (
    runs.find(
      (r) => r.conversationId === conversationId && r.status === "running",
    ) || null
  );
}


// Module-level cache of custom providers (id → def) so non-reactive helper
// call sites (sidebar history, agent cards) can still resolve friendly
// names/glyphs for user-defined providers after loadCustomProviders() runs.
let customCache: Record<string, PublicCustomProvider> = {};

function applyCustomList(list: PublicCustomProvider[]) {
  customCache = {};
  for (const c of list) customCache[c.id] = c;
  useAppStore.setState({ customProviders: list });
}

export function modelLabel(provider: ProviderId, model: string): string {
  const map: Record<string, string> = {
    "claude-sonnet-5": "Sonnet 5",
    "claude-opus-5": "Opus 5",
    "claude-haiku-4-5-20251001": "Haiku 4.5",
    "claude-haiku-4-5": "Haiku 4.5",
    "gpt-5": "GPT-5",
    "gpt-5-mini": "GPT-5 mini",
    "o4-mini": "o4 mini",
    "gpt-4.1": "GPT-4.1",
    "gemini-2.5-pro": "Gemini 2.5 Pro",
    "gemini-2.5-flash": "Gemini 2.5 Flash",
    "gemini-2.5-flash-lite": "Gemini 2.5 Flash-Lite",
    "llama3.2": "Llama 3.2",
    "qwen3:8b": "Qwen3 8B",
    "deepseek-r1:14b": "DeepSeek R1",
    "local-model": "Loaded model",
    // OpenCode Zen
    "muse-spark-1.3-contributor-free": "Muse Spark 1.3 (free)",
    "gpt-5.5": "GPT-5.5",
    "gpt-5.4-mini": "GPT-5.4 Mini",
    "muse-spark-1.3": "Muse Spark 1.3",
    "grok-4.5": "Grok 4.5",
    "gemini-3-flash": "Gemini 3 Flash",
    "gemini-3.1-pro": "Gemini 3.1 Pro",
    "kimi-k2.6": "Kimi K2.6",
    "deepseek-v4-flash": "DeepSeek V4 Flash",
    "glm-5.2": "GLM 5.2",
    "big-pickle": "Big Pickle",
  };
  if (map[model]) return map[model];
  const cp = customCache[provider];
  if (cp) {
    const m = cp.models.find((x) => x.id === model);
    if (m && m.name) return m.name;
  }
  return model;
}

export function providerGlyph(provider: ProviderId): string {
  const map: Record<string, string> = {
    anthropic: "✦",
    openai: "◉",
    google: "◈",
    ollama: "🐙",
    lmstudio: "⬡",
    opencode: "⬢",
  };
  if (map[provider]) return map[provider];
  return customCache[provider]?.glyph || "◆";
}
