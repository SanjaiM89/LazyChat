import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { LanguageModel } from "ai";
import type { BuiltinProviderId, ProviderId } from "@/lib/types";
import {
  PROVIDERS,
  getDefaultModel,
  getOpencodeTransport,
  isBuiltinProvider,
} from "@/lib/models";
import { resolveBuiltinKey } from "@/lib/provider-keys";
import { getCustomProvider, resolveApiKey } from "@/lib/custom-providers";

/* ------------------------------------------------------------------ */
/*  Language model construction                                        */
/* ------------------------------------------------------------------ */

// Re-export the shared registry so server modules can keep importing
// from lib/providers.ts.
export { PROVIDERS, getDefaultModel, isBuiltinProvider };

export interface BuildModelOptions {
  provider: ProviderId;
  model: string;
  /** override the api key (e.g. user-provided at runtime) */
  apiKey?: string;
  /** override base URL */
  baseUrl?: string;
  /** extra headers for OpenAI-compatible endpoints */
  headers?: Record<string, string>;
}

export async function hasProviderKey(provider: ProviderId): Promise<boolean> {
  const cfg = PROVIDERS[provider as BuiltinProviderId];
  if (cfg) {
    if (!cfg.requiresKey) return true;
    // Stored UI key first, then the env var.
    return Boolean(await resolveBuiltinKey(provider as BuiltinProviderId));
  }
  // Custom provider: "configured" = it exists (has a base URL). A missing
  // key still lets local OpenAI-compatible servers answer with a dummy key.
  return Boolean(await getCustomProvider(provider));
}

/** Builds a language model for a provider, throwing a helpful error when unconfigured. */
export async function buildLanguageModel(opts: BuildModelOptions): Promise<LanguageModel> {
  const { provider, model } = opts;

  // User-defined custom providers. Three dialects:
  //  - "openai"     → OpenAI-compatible client against the given baseUrl
  //  - "anthropic"  → Anthropic Messages client (baseUrl is the host root;
  //                   the SDK appends /v1/messages). These are gateways that
  //                   only authorize Claude Code–style requests (Bearer token
  //                   over the Anthropic dialect), e.g. agentrouter.
  //  - "gemini"     → Google's native Interactions API (POST /interactions,
  //                   key sent as x-goog-api-key). baseUrl is the
  //                   generativelanguage /v1beta root (the SDK appends
  //                   /interactions); a pasted full .../interactions URL is
  //                   trimmed back to its /v1beta parent.
  if (!isBuiltinProvider(provider)) {
    const custom = await getCustomProvider(provider);
    if (!custom) throw new Error(`Unknown provider: ${provider}`);

    if (custom.protocol === "gemini") {
      const apiKey = opts.apiKey || resolveApiKey(custom);
      if (!apiKey) {
        throw new Error(
          `Gemini is not configured. Set an API key on the provider (or ${custom.apiKeyEnv || "GOOGLE_GENERATIVE_AI_API_KEY"} env).`,
        );
      }
      const raw = (opts.baseUrl || custom.baseUrl || "")
        .trim()
        .replace(/\/+$/, "");
      // Strip an accidental trailing /interactions so the SDK appends exactly one.
      const baseURL = raw.replace(/\/interactions$/i, "");
      const client = createGoogleGenerativeAI({
        name: custom.id,
        baseURL: baseURL || undefined,
        apiKey,
      });
      return client.interactions(model);
    }

    const apiKey = opts.apiKey || resolveApiKey(custom) || "custom";

    if (custom.protocol === "anthropic") {
      // @ai-sdk/anthropic posts to `{baseURL}/messages`, so hand it a base
      // that ends in /v1 → the Anthropic Messages endpoint /v1/messages.
      const raw = (opts.baseUrl || custom.baseUrl).replace(/\/+$/, "");
      const baseURL = /\/v1$/i.test(raw) ? raw : `${raw}/v1`;
      const client = createAnthropic({
        name: custom.id,
        baseURL,
        apiKey,
      });
      return client(model);
    }

    const client = createOpenAICompatible({
      name: custom.id,
      baseURL: opts.baseUrl || custom.baseUrl,
      apiKey,
    });
    return client(model);
  }

  const cfg = PROVIDERS[provider];
  // Resolution order: explicit override → key saved in the UI → env var.
  const resolvedKey = opts.apiKey || (await resolveBuiltinKey(provider));
  const apiKey = resolvedKey || "not-set";
  const baseUrl =
    opts.baseUrl ||
    (cfg.baseUrlEnv ? process.env[cfg.baseUrlEnv] : undefined) ||
    cfg.defaultBaseUrl ||
    undefined;

  switch (provider) {
    case "anthropic": {
      if (!resolvedKey) {
        throw new Error(
          `Anthropic is not configured. Paste a key via the 🔑 button in the header, or set ${cfg.keyEnv} in .env.local`,
        );
      }
      const client = createAnthropic({ apiKey });
      return client(model);
    }
    case "openai": {
      if (!resolvedKey) {
        throw new Error(
          `OpenAI is not configured. Paste a key via the 🔑 button in the header, or set ${cfg.keyEnv} in .env.local`,
        );
      }
      const client = createOpenAI({ apiKey, baseURL: baseUrl });
      return client(model);
    }
    case "google": {
      if (!resolvedKey) {
        throw new Error(
          `Google is not configured. Paste a key via the 🔑 button in the header, or set ${cfg.keyEnv} in .env.local`,
        );
      }
      const client = createGoogleGenerativeAI({ apiKey, baseURL: baseUrl });
      return client(model);
    }
    case "ollama": {
      const client = createOpenAICompatible({
        name: "ollama",
        baseURL: baseUrl as string,
        apiKey: "ollama",
      });
      return client(model);
    }
    case "lmstudio": {
      const client = createOpenAICompatible({
        name: "lmstudio",
        baseURL: baseUrl as string,
        apiKey: "lm-studio",
      });
      return client(model);
    }
    case "opencode": {
      // OpenCode Zen: one API key, four endpoint dialects. The base URL is
      // the /v1 root (default https://opencode.ai/zen/v1) — each SDK appends
      // its own path (/responses, /messages, /chat/completions,
      // /models/:id:generateContent). Auth follows the dialect: Bearer for
      // OpenAI-style transports, x-api-key for Anthropic, x-goog-api-key
      // for Google — all handled by the respective SDK with the same key.
      if (!resolvedKey) {
        throw new Error(
          `OpenCode Zen is not configured. Sign in at https://opencode.ai/auth, copy your API key, paste it via the 🔑 button in the header, or set ${cfg.keyEnv} in .env.local`,
        );
      }
      const zenBase =
        baseUrl || "https://opencode.ai/zen/v1";
      switch (getOpencodeTransport(model)) {
        case "anthropic": {
          const client = createAnthropic({ apiKey, baseURL: zenBase });
          return client(model);
        }
        case "gemini": {
          const client = createGoogleGenerativeAI({
            apiKey,
            baseURL: zenBase,
          });
          return client(model);
        }
        case "chat": {
          const client = createOpenAICompatible({
            name: "opencode",
            baseURL: zenBase,
            apiKey,
          });
          return client(model);
        }
        case "responses":
        default: {
          // @ai-sdk/openai calls createResponsesModel by default, which
          // POSTs to {baseURL}/responses — exactly Zen's Responses endpoint.
          const client = createOpenAI({ apiKey, baseURL: zenBase });
          return client(model);
        }
      }
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Provider options for thinking / reasoning                          */
/* ------------------------------------------------------------------ */

export function thinkingProviderOptions(
  provider: ProviderId,
  model: string,
  enabled: boolean,
): Record<string, unknown> | undefined {
  if (!enabled) return undefined;
  // OpenCode Zen delegates to the underlying dialect's options.
  if (provider === "opencode") {
    const transport = getOpencodeTransport(model);
    if (transport === "anthropic") {
      return {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: 4096 },
        },
      };
    }
    if (transport === "gemini") {
      return {
        google: { thinkingConfig: { thinkingBudget: 8192 } },
      };
    }
    if (/o[1-5]|gpt-5|gpt-6|reasoning|grok|muse-spark|deepseek|kimi|glm|qwen/i.test(model)) {
      return { openai: { reasoningEffort: "high" } };
    }
    return undefined;
  }
  switch (provider) {
    case "anthropic":
      return {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: 4096 },
        },
      };
    case "openai": {
      // reasoning effort applies to o-series / gpt-5 reasoning models
      if (/o[1-5]|gpt-5|gpt-5.1|reasoning/i.test(model)) {
        return { openai: { reasoningEffort: "high" } };
      }
      return undefined;
    }
    case "google":
      return {
        google: { thinkingConfig: { thinkingBudget: 8192 } },
      };
    default:
      return undefined;
  }
}
