/* ------------------------------------------------------------------ */
/*  Shared types for the whole app                                      */
/* ------------------------------------------------------------------ */

export type BuiltinProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "ollama"
  | "lmstudio"
  | "opencode";

/**
 * Any provider id — a built-in above or a user-defined custom (OpenAI
 * compatible) provider registered at runtime.
 */
export type ProviderId = BuiltinProviderId | (string & {});

export type ModelCategory = "fast" | "reasoning" | "creative";

export interface ModelConfig {
  /** API model id */
  id: string;
  /** Human readable label */
  name: string;
  supportsThinking: boolean;
  supportsVision: boolean;
  /** ~context window tokens */
  context: number;
  /** max output tokens */
  maxOutput: number;
  category: ModelCategory;
  /** local default model for the provider */
  default?: boolean;
  /**
   * Request dialect for multi-transport providers (OpenCode Zen serves
   * different model families over different endpoints):
   *  - "responses" → OpenAI Responses API (@ai-sdk/openai)
   *  - "anthropic" → Anthropic Messages API (@ai-sdk/anthropic)
   *  - "chat"      → OpenAI chat-completions API (@ai-sdk/openai-compatible)
   *  - "gemini"    → Google generateContent API (@ai-sdk/google)
   * Built-ins other than "opencode" ignore this.
   */
  transport?: "responses" | "anthropic" | "chat" | "gemini";
}

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  tagline: string;
  /** emoji / small glyph shown in the picker */
  glyph: string;
  /** env var holding the API key */
  keyEnv?: string;
  /** whether the provider needs a configured API key */
  requiresKey: boolean;
  /** override base URL env (for proxies / LM Studio / Ollama) */
  baseUrlEnv?: string;
  defaultBaseUrl?: string;
  models: ModelConfig[];
  providerOptionsKey?: string;
}

/* -------------------------- Custom providers -------------------------- */

/** A single model id a user registers for a custom provider. */
export interface CustomModelDef {
  /** API model id */
  id: string;
  /** optional friendlier display label */
  name?: string;
  supportsThinking?: boolean;
}

/** API dialect a custom provider speaks. */
export type ProviderProtocol = "openai" | "anthropic" | "gemini";

/**
 * A user-defined provider. Stored server-side under data/custom-providers.json
 * so the raw apiKey never reaches the client. `protocol` decides the request
 * dialect: "openai" builds an OpenAI-compatible client against baseUrl;
 * "anthropic" builds an Anthropic Messages client (baseUrl is the host root,
 * no /v1 — the SDK appends /v1/messages) and sends the key as a Bearer token;
 * "gemini" builds a Google Interactions client (baseUrl is the
 * generativelanguage /v1beta root — the SDK appends /interactions) and sends
 * the key as an x-goog-api-key header.
 */
export interface CustomProviderDef {
  id: string;
  name: string;
  glyph?: string;
  /**
   * Endpoint. OpenAI: https://host/v1 · Anthropic: https://host (no /v1)
   * Gemini: https://generativelanguage.googleapis.com/v1beta (no /interactions)
   */
  baseUrl: string;
  /** API key stored in the file (preferred), or empty when apiKeyEnv is set */
  apiKey?: string;
  /** name of a server env var holding the key instead of a stored value */
  apiKeyEnv?: string;
  /** Request dialect; defaults to "openai" when absent (older records). */
  protocol?: ProviderProtocol;
  models: CustomModelDef[];
  createdAt: number;
  updatedAt: number;
}

/** Shape returned to the client — the raw key is stripped. */
export type PublicCustomProvider = Omit<CustomProviderDef, "apiKey"> & {
  hasApiKey: boolean;
};

export interface ChatSettings {
  provider: ProviderId;
  model: string;
  thinking: boolean;
  temperature: number;
  /** maxSteps for the in-chat agentic loop */
  maxSteps: number;
  /** search on by default */
  tools: string[];
}

export const DEFAULT_SETTINGS: ChatSettings = {
  provider: "anthropic",
  model: "claude-sonnet-5",
  thinking: true,
  temperature: 0.7,
  maxSteps: 14,
  tools: ["webSearch", "createArtifact", "runAgentTask"],
};

/* ----------------------------- Artifacts ----------------------------- */

export type ArtifactType =
  | "text"
  | "code"
  | "markdown"
  | "html"
  | "svg"
  | "image"
  | "pdf"
  | "docx"
  | "xlsx"
  | "csv"
  | "mermaid"
  | "table"
  | "audio";

export interface ArtifactMeta {
  id: string;
  conversationId?: string;
  title: string;
  type: ArtifactType;
  /** filename stored under data/artifacts/<id>/ */
  filename: string;
  /** mime type */
  mime: string;
  /** short text snippet / language for code */
  language?: string;
  content?: string;
  createdAt: number;
  size?: number;
}

/* ----------------------------- Search ----------------------------- */

export interface SearchResult {
  title: string;
  description: string;
  url: string;
  hostname: string;
  position: number;
}

/* ----------------------------- Sandbox ----------------------------- */

export type SandboxState =
  | "idle"
  | "starting"
  | "ready"
  | "busy"
  | "error"
  | "stopped";

export interface SandboxMeta {
  id: string;
  containerId?: string;
  image: string;
  state: SandboxState;
  label: string;
  createdAt: number;
  error?: string;
  /** whether it has a live browser */
  hasBrowser: boolean;
  lastScreenshot?: string;
}

/* ----------------------------- Agents ----------------------------- */

export type AgentStatus =
  | "queued"
  | "starting"
  | "running"
  | "done"
  | "failed"
  | "stopped";

export interface AgentMeta {
  id: string;
  label: string;
  task: string;
  provider: ProviderId;
  model: string;
  engine: "tool-loop" | "agent-sdk";
  status: AgentStatus;
  sandboxId?: string;
  /** conversation that launched this agent — its result files are tied to it */
  conversationId?: string;
  createdAt: number;
  updatedAt: number;
  progress: number;
  log: AgentLogEntry[];
  resultFiles: ArtifactMeta[];
  error?: string;
}

export interface AgentLogEntry {
  t: number;
  level: "info" | "thinking" | "tool" | "file" | "text" | "error" | "done";
  message: string;
}

/* ----------------------------- Chat runs ----------------------------- */

/**
 * A background chat generation. Runs live on the server (not in the HTTP
 * response that started them), so closing the tab does not stop them, and
 * clients can attach/detach at will.
 */
export type ChatRunStatus = "running" | "done" | "failed" | "stopped";

export interface ChatRunSummary {
  id: string;
  conversationId?: string;
  status: ChatRunStatus;
  /** human readable "what is it doing right now", e.g. "Running a sandbox agent…" */
  activity: string;
  /** completed model steps in this run */
  step: number;
  /** assistant message id the run is writing into */
  messageId: string;
  /** provider + model answering this run */
  provider: ProviderId;
  model: string;
  startedAt: number;
  updatedAt: number;
  error?: string;
  /** false when the chunk log was trimmed — the run can't be replayed in full */
  replayable: boolean;
}

/* ----------------------------- Skills ----------------------------- */

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  prompt: string;
  /** path or url, optional */
  source?: string;
  enabled: boolean;
  updatedAt: number;
}

/* ----------------------------- MCP ----------------------------- */

export interface MCPServerDef {
  id: string;
  name: string;
  enabled: boolean;
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  tools?: string[];
  status?: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
}

export interface MCPToolInfo {
  serverId: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/* ----------------------------- Conversations ----------------------------- */

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: ProviderId;
  model: string;
  pinned?: boolean;
}
