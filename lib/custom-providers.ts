import "server-only";

import { nanoid } from "nanoid";
import type {
  BuiltinProviderId,
  CustomProviderDef,
  CustomModelDef,
  ModelConfig,
  ProviderConfig,
  ProviderProtocol,
  PublicCustomProvider,
} from "@/lib/types";
import { readJSON, writeJSON } from "@/lib/store";
import { PROVIDERS } from "@/lib/models";

/* ------------------------------------------------------------------ */
/*  Custom provider registry — user-defined OpenAI-compatible endpoints */
/*  persisted to data/custom-providers.json. The raw apiKey is kept     */
/*  server-side; the client only ever sees PublicCustomProvider.        */
/* ------------------------------------------------------------------ */

const FILE = "custom-providers.json";

/** Canonicalize a stored protocol value (old records default to "openai"). */
function normProtocol(p: unknown): ProviderProtocol {
  return p === "anthropic" || p === "gemini" ? p : "openai";
}

function isDef(x: unknown): x is CustomProviderDef {
  if (!x || typeof x !== "object") return false;
  const d = x as CustomProviderDef;
  return (
    typeof d.id === "string" &&
    typeof d.name === "string" &&
    typeof d.baseUrl === "string" &&
    Array.isArray(d.models)
  );
}

export async function listCustomProviders(): Promise<CustomProviderDef[]> {
  const raw = await readJSON<unknown>(FILE, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isDef)
    .map((p) => ({ ...p, protocol: normProtocol(p.protocol) }));
}

export async function getCustomProvider(
  id: string,
): Promise<CustomProviderDef | undefined> {
  if (!id) return undefined;
  return (await listCustomProviders()).find((p) => p.id === id);
}

export async function saveCustomProvider(
  def: CustomProviderDef,
): Promise<CustomProviderDef[]> {
  const all = await listCustomProviders();
  const protocol = normProtocol(def.protocol);
  const clean: CustomProviderDef = {
    ...def,
    baseUrl: def.baseUrl.trim().replace(/\/+$/, ""),
    protocol,
    apiKey: def.apiKey || undefined,
    apiKeyEnv: def.apiKeyEnv || undefined,
    glyph: def.glyph || undefined,
    updatedAt: Date.now(),
  };
  const idx = all.findIndex((p) => p.id === clean.id);
  if (idx >= 0) all[idx] = clean;
  else all.unshift(clean);
  await writeJSON(FILE, all);
  return all;
}

export async function deleteCustomProvider(id: string): Promise<void> {
  const all = await listCustomProviders();
  await writeJSON(FILE, all.filter((p) => p.id !== id));
}

export function uniqueProviderId(desired?: string): string {
  const base = desired
    ? desired
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || nanoid(8)
    : nanoid(8);
  return base.length > 40 ? base.slice(0, 40) : base;
}

/** The stored API key, or the value of the referenced server env var. */
export function resolveApiKey(def: CustomProviderDef): string | undefined {
  if (def.apiKey) return def.apiKey;
  if (def.apiKeyEnv) return process.env[def.apiKeyEnv] || undefined;
  return undefined;
}

/** Client-safe projection: never includes the raw apiKey. */
export function toPublic(def: CustomProviderDef): PublicCustomProvider {
  const { apiKey: _apiKey, ...rest } = def;
  return { ...rest, hasApiKey: Boolean(resolveApiKey(def)) };
}

export async function listPublicCustomProviders(): Promise<PublicCustomProvider[]> {
  return (await listCustomProviders()).map(toPublic);
}

/** Convert a custom def into the shared ProviderConfig shape. */
export function toProviderConfig(def: CustomProviderDef): ProviderConfig {
  const models: CustomModelDef[] = def.models.length
    ? def.models
    : [{ id: "default", name: def.name }];
  const protocol = normProtocol(def.protocol);
  const configModels: ModelConfig[] = models.map((m, i) => ({
    id: m.id,
    name: m.name || m.id,
    supportsThinking: m.supportsThinking ?? protocol !== "gemini",
    supportsVision: false,
    context: 131_072,
    maxOutput: 16_384,
    category: "fast",
    default: i === 0,
  }));
  return {
    id: def.id,
    name: def.name,
    tagline: `${protocolTagline(protocol)} · ${def.baseUrl}`,
    glyph: def.glyph || "◆",
    requiresKey: true,
    models: configModels,
    // Provider options are namespaced under this key at the AI SDK layer
    // (google for the Interactions client, google.* for generateContent).
    providerOptionsKey: protocol === "gemini" ? "google" : "openai-compatible",
  };
}

/** Short human label for a protocol, used in the picker + config tagline. */
export function protocolTagline(p: ProviderProtocol): string {
  switch (p) {
    case "anthropic":
      return "Anthropic-compatible";
    case "gemini":
      return "Google Gemini (Interactions API)";
    default:
      return "OpenAI-compatible";
  }
}

/** Default model id for any provider id — built-in or custom ("" if none). */
export async function defaultModelForProvider(provider: string): Promise<string> {
  const builtin = PROVIDERS[provider as BuiltinProviderId];
  if (builtin?.models?.length) {
    return (
      builtin.models.find((m) => m.default)?.id ?? builtin.models[0].id
    );
  }
  const custom = await getCustomProvider(provider);
  return custom?.models[0]?.id || "";
}
