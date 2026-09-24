import { NextRequest } from "next/server";
import { PROVIDERS } from "@/lib/models";
import { getEffectiveBuiltinModels } from "@/lib/provider-models";
import { resolveBuiltinKey } from "@/lib/provider-keys";
import { getCustomProvider, resolveApiKey } from "@/lib/custom-providers";
import type { BuiltinProviderId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


interface LiveModel {
  id: string;
  name?: string;
}

const cache = new Map<string, { at: number; models: LiveModel[] }>();
const CACHE_TTL = 5 * 60 * 1000;

async function liveModels(provider: string): Promise<{ models: LiveModel[]; live: boolean; error?: string }> {
  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return { models: hit.models, live: true };
  }
  try {
    const models = await fetchLive(provider);
    cache.set(provider, { at: Date.now(), models });
    return { models, live: true };
  } catch (e: any) {
    return { models: [], live: false, error: e?.message || "fetch failed" };
  }
}

function stripGooglePrefix(name: string): string {
  return name.replace(/^models\//, "").trim();
}

async function fetchLive(provider: string): Promise<LiveModel[]> {
  if (!(provider in PROVIDERS)) {
    const custom = await getCustomProvider(provider);
    if (!custom) return [];
    const key = resolveApiKey(custom) || "custom";
    const base = custom.baseUrl.replace(/\/+$/, "");
    if (custom.protocol === "gemini") {
      const res = await fetch(`${base}/models?key=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error(`gemini ${res.status}`);
      const data = (await res.json()) as any;
      return ((data.models || []) as any[])
        .map((m) => ({ id: stripGooglePrefix(String(m.name || "")) }))
        .filter((m) => m.id);
    }
    const res = await fetch(`${base}/models`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`${custom.protocol} ${res.status}`);
    const data = (await res.json()) as any;
    return ((data.data || []) as any[])
      .map((m) => ({ id: String(m.id || "") }))
      .filter((m) => m.id);
  }

  const cfg = PROVIDERS[provider as BuiltinProviderId];
  switch (provider) {
    case "google": {
      const key = await resolveBuiltinKey("google");
      if (!key) return [];
      const base =
        process.env.GOOGLE_GENERATIVE_AI_BASE_URL ||
        cfg.defaultBaseUrl ||
        "https://generativelanguage.googleapis.com/v1beta";
      const url = `${base.replace(/\/+$/, "")}/models?key=${encodeURIComponent(key)}&pageSize=100`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`google ${res.status}`);
      const data = (await res.json()) as any;
      return ((data.models || []) as any[])
        .map((m) => {
          const id = stripGooglePrefix(String(m.name || ""));
          const label = String(m.displayName || m.description || "").trim();
          return { id, name: label && label !== id ? label : undefined };
        })
        .filter((m: LiveModel) => m.id && /gemini|gemma|learnlm/i.test(m.id));
    }
    case "openai": {
      const key = await resolveBuiltinKey("openai");
      if (!key) return [];
      const base =
        process.env.OPENAI_BASE_URL || cfg.defaultBaseUrl || "https://api.openai.com/v1";
      const res = await fetch(`${base.replace(/\/+$/, "")}/models`, {
        headers: { authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`openai ${res.status}`);
      const data = (await res.json()) as any;
      return ((data.data || []) as any[])
        .map((m) => ({ id: String(m.id || "") }))
        .filter((m: LiveModel) => m.id)
        .slice(0, 100);
    }
    case "ollama":
    case "lmstudio": {
      const base =
        (cfg.baseUrlEnv && process.env[cfg.baseUrlEnv]) ||
        cfg.defaultBaseUrl ||
        "";
      if (!base) return [];
      const noV1 = base.replace(/\/v1\/?$/, "");
      const candidates =
        provider === "ollama"
          ? [`${noV1}/api/tags`, `${base.replace(/\/+$/, "")}/models`]
          : [`${base.replace(/\/+$/, "")}/models`];
      for (const url of candidates) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = (await res.json()) as any;
          if (Array.isArray(data.models)) {
            return (data.models as any[])
              .map((m) => ({ id: String(m.name || m.id || "") }))
              .filter((m: LiveModel) => m.id);
          }
          if (Array.isArray(data.data)) {
            return (data.data as any[])
              .map((m) => ({ id: String(m.id || "") }))
              .filter((m: LiveModel) => m.id);
          }
        } catch {
        }
      }
      return [];
    }
    case "anthropic":
      return [];
    case "opencode": {
      const key = await resolveBuiltinKey("opencode");
      if (!key) return [];
      const base = (
        process.env.OPENCODE_BASE_URL ||
        cfg.defaultBaseUrl ||
        "https://opencode.ai/zen/v1"
      ).replace(/\/+$/, "");
      const res = await fetch(`${base}/models`, {
        headers: { authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`opencode ${res.status}`);
      const data = (await res.json()) as any;
      const list = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
      return (list as any[])
        .map((m) => ({ id: String(m.id || m.name || "") }))
        .filter((m: LiveModel) => m.id)
        .slice(0, 200);
    }
    default:
      return [];
  }
}

export async function GET(req: NextRequest) {
  const only = req.nextUrl.searchParams.get("provider") || "";
  const ids = only ? [only] : Object.keys(PROVIDERS);
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    if (!(id in PROVIDERS)) {
      const custom = await getCustomProvider(id);
      if (!custom) continue;
      const live = await liveModels(id);
      out[id] = {
        provider: id,
        effective: custom.models.map((m) => ({
          id: m.id,
          name: m.name || m.id,
          supportsThinking: m.supportsThinking ?? false,
        })),
        live: live.models,
        liveOk: live.live,
        liveError: live.error,
      };
      continue;
    }
    const effective = await getEffectiveBuiltinModels(id);
    const live = await liveModels(id);
    const liveIds = new Set(live.models.map((m) => m.id));
    const merged = [
      ...effective.map((m) => ({ ...m, retired: live.live && liveIds.size > 0 && !liveIds.has(m.id) })),
      ...live.models
        .filter((m) => !effective.some((e) => e.id === m.id))
        .map((m) => ({ id: m.id, name: m.name || m.id, supportsThinking: true, liveOnly: true })),
    ];
    out[id] = { provider: id, effective: merged, liveOk: live.live, liveError: live.error };
  }
  return Response.json(only ? (out[only] ?? { provider: only, effective: [] }) : out);
}
