import "server-only";

import { nanoid } from "nanoid";
import { readJSON, writeJSON } from "@/lib/store";

/* ------------------------------------------------------------------ */
/*  Custom search providers — user-added web search backends            */
/*  Stored server-side in data/search-providers.json. Keys never reach  */
/*  the client; the UI only sees hasApiKey + config.                    */
/* ------------------------------------------------------------------ */

export type SearchProviderKind =
  | "tavily"
  | "brave"
  | "serper"
  | "searxng"
  | "duckduckgo";

export interface SearchProviderDef {
  id: string;
  name: string;
  kind: SearchProviderKind;
  /** API key stored server-side (tavily / brave / serper) */
  apiKey?: string;
  /** …or server env var holding the key */
  apiKeyEnv?: string;
  /** base URL for searxng instances (e.g. https://search.example.com) */
  baseUrl?: string;
  maxResults?: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type PublicSearchProvider = Omit<SearchProviderDef, "apiKey"> & {
  hasApiKey: boolean;
};

const FILE = "search-providers.json";

export const SEARCH_KINDS: Record<
  SearchProviderKind,
  { label: string; needsKey: boolean; needsUrl: boolean; hint: string }
> = {
  tavily: {
    label: "Tavily",
    needsKey: true,
    needsUrl: false,
    hint: "AI-optimized search with answers + citations. Key from tavily.com.",
  },
  brave: {
    label: "Brave Search",
    needsKey: true,
    needsUrl: false,
    hint: "Privacy-first results. Key from brave.com/search/api.",
  },
  serper: {
    label: "Serper (Google)",
    needsKey: true,
    needsUrl: false,
    hint: "Fast Google results proxy. Key from serper.dev.",
  },
  searxng: {
    label: "SearXNG (self-hosted)",
    needsKey: false,
    needsUrl: true,
    hint: "Your own SearXNG instance URL, e.g. https://search.example.com",
  },
  duckduckgo: {
    label: "DuckDuckGo (built-in)",
    needsKey: false,
    needsUrl: false,
    hint: "No key needed. Built-in fallback, may rate-limit.",
  },
};

function isDef(x: unknown): x is SearchProviderDef {
  if (!x || typeof x !== "object") return false;
  const d = x as SearchProviderDef;
  return typeof d.id === "string" && typeof d.name === "string" && typeof d.kind === "string";
}

function normKind(k: unknown): SearchProviderKind {
  return k === "tavily" || k === "brave" || k === "serper" || k === "searxng" || k === "duckduckgo"
    ? k
    : "tavily";
}

export async function listSearchProviders(): Promise<SearchProviderDef[]> {
  const raw = await readJSON<unknown>(FILE, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isDef).map((p) => ({ ...p, kind: normKind(p.kind) }));
}

export async function listEnabledSearchProviders(): Promise<SearchProviderDef[]> {
  return (await listSearchProviders()).filter((p) => p.enabled);
}

export function resolveSearchKey(def: SearchProviderDef): string | undefined {
  if (def.apiKey) return def.apiKey;
  if (def.apiKeyEnv) return process.env[def.apiKeyEnv] || undefined;
  return undefined;
}

export function toPublicSearchProvider(def: SearchProviderDef): PublicSearchProvider {
  const { apiKey: _key, ...rest } = def;
  return { ...rest, hasApiKey: Boolean(resolveSearchKey(def)) };
}

export async function listPublicSearchProviders(): Promise<PublicSearchProvider[]> {
  return (await listSearchProviders()).map(toPublicSearchProvider);
}

export async function saveSearchProvider(
  def: SearchProviderDef,
): Promise<SearchProviderDef[]> {
  const all = await listSearchProviders();
  const clean: SearchProviderDef = {
    ...def,
    id: def.id || nanoid(8),
    kind: normKind(def.kind),
    name: def.name.trim() || SEARCH_KINDS[normKind(def.kind)].label,
    baseUrl: def.baseUrl?.trim().replace(/\/+$/, "") || undefined,
    apiKey: def.apiKey?.trim() || undefined,
    apiKeyEnv: def.apiKeyEnv?.trim() || undefined,
    maxResults: def.maxResults && def.maxResults > 0 ? Math.min(20, def.maxResults) : undefined,
    enabled: def.enabled !== false,
    createdAt: def.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  const idx = all.findIndex((p) => p.id === clean.id);
  if (idx >= 0) all[idx] = clean;
  else all.unshift(clean);
  await writeJSON(FILE, all);
  return all;
}

export async function deleteSearchProvider(id: string): Promise<void> {
  const all = await listSearchProviders();
  await writeJSON(
    FILE,
    all.filter((p) => p.id !== id),
  );
}
