import "server-only";

import { readJSON, writeJSON } from "@/lib/store";
import { PROVIDERS } from "@/lib/models";
import type { BuiltinProviderId, CustomModelDef } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Built-in provider model overrides — lets users add / rename / hide  */
/*  model ids without forking lib/models.ts. Stored server-side in      */
/*  data/provider-models.json. Effective list = hardcoded minus hidden  */
/*  plus user models (same id overrides the builtin entry).             */
/* ------------------------------------------------------------------ */

const FILE = "provider-models.json";

interface ProviderOverride {
  models?: CustomModelDef[];
  hideBuiltin?: string[];
}

type OverrideMap = Record<string, ProviderOverride>;

async function readMap(): Promise<OverrideMap> {
  const raw = await readJSON<unknown>(FILE, {});
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as OverrideMap;
}

function cleanModel(m: CustomModelDef): CustomModelDef | null {
  const id = (m.id || "").trim();
  if (!id) return null;
  const name = (m.name || "").trim();
  return {
    id,
    name: name && name !== id ? name : undefined,
    supportsThinking: m.supportsThinking ?? true,
  };
}

export async function getProviderOverride(provider: string): Promise<ProviderOverride> {
  const map = await readMap();
  return map[provider] || {};
}

export async function getEffectiveBuiltinModels(
  provider: string,
): Promise<{ id: string; name?: string; supportsThinking?: boolean }[]> {
  const builtin = PROVIDERS[provider as BuiltinProviderId];
  const base = (builtin?.models || []).map((m) => ({
    id: m.id,
    name: m.name,
    supportsThinking: m.supportsThinking,
  }));
  const ov = await getProviderOverride(provider);
  const hidden = new Set(ov.hideBuiltin || []);
  const extra = (ov.models || []).map(cleanModel).filter(Boolean) as CustomModelDef[];
  const byId = new Map<string, { id: string; name?: string; supportsThinking?: boolean }>();
  for (const m of base) {
    if (!hidden.has(m.id)) byId.set(m.id, m);
  }
  for (const m of extra) byId.set(m.id, m);
  return [...byId.values()];
}

export async function addProviderModel(
  provider: string,
  model: CustomModelDef,
): Promise<void> {
  const clean = cleanModel(model);
  if (!clean) throw new Error("Model id required.");
  const map = await readMap();
  const ov = map[provider] || {};
  const models = (ov.models || []).filter((m) => m.id !== clean.id);
  models.unshift(clean);
  // If it was hidden as a builtin, unhide (the custom entry now wins anyway).
  const hideBuiltin = (ov.hideBuiltin || []).filter((id) => id !== clean.id);
  map[provider] = { models, hideBuiltin };
  await writeJSON(FILE, map);
}

export async function renameProviderModel(
  provider: string,
  oldId: string,
  model: CustomModelDef,
): Promise<void> {
  const clean = cleanModel(model);
  if (!clean) throw new Error("Model id required.");
  const map = await readMap();
  const ov = map[provider] || {};
  let models = (ov.models || []).filter((m) => m.id !== oldId && m.id !== clean.id);
  models.unshift(clean);
  let hideBuiltin = ov.hideBuiltin || [];
  const builtinIds = new Set(
    (PROVIDERS[provider as BuiltinProviderId]?.models || []).map((m) => m.id),
  );
  if (oldId !== clean.id) {
    // Renaming away from a builtin id → hide the old builtin entry.
    if (builtinIds.has(oldId) && !hideBuiltin.includes(oldId)) {
      hideBuiltin = [...hideBuiltin, oldId];
    }
    // Renaming back to a builtin id → unhide it (custom entry overrides).
    if (builtinIds.has(clean.id)) {
      hideBuiltin = hideBuiltin.filter((id) => id !== clean.id);
    }
  }
  map[provider] = { models, hideBuiltin };
  await writeJSON(FILE, map);
}

export async function deleteProviderModel(provider: string, id: string): Promise<void> {
  const map = await readMap();
  const ov = map[provider] || {};
  const models = (ov.models || []).filter((m) => m.id !== id);
  const builtinIds = new Set(
    (PROVIDERS[provider as BuiltinProviderId]?.models || []).map((m) => m.id),
  );
  let hideBuiltin = ov.hideBuiltin || [];
  // Deleting a custom model that shadows a builtin → unhide the builtin.
  // Hiding a builtin outright → record it so it disappears from the picker.
  if (builtinIds.has(id) && !models.some((m) => m.id === id)) {
    if (!hideBuiltin.includes(id)) hideBuiltin = [...hideBuiltin, id];
  }
  if (!builtinIds.has(id)) {
    hideBuiltin = hideBuiltin.filter((x) => x !== id);
  }
  map[provider] = { models, hideBuiltin };
  await writeJSON(FILE, map);
}

export async function unhideProviderModel(provider: string, id: string): Promise<void> {
  const map = await readMap();
  const ov = map[provider] || {};
  map[provider] = {
    models: (ov.models || []).filter((m) => m.id !== id),
    hideBuiltin: (ov.hideBuiltin || []).filter((x) => x !== id),
  };
  await writeJSON(FILE, map);
}
