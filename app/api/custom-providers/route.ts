import { NextRequest } from "next/server";
import type { CustomModelDef, CustomProviderDef } from "@/lib/types";
import {
  deleteCustomProvider,
  getCustomProvider,
  listPublicCustomProviders,
  saveCustomProvider,
  toPublic,
  uniqueProviderId,
} from "@/lib/custom-providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bad(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function parseModels(models: unknown): CustomModelDef[] | null {
  if (!Array.isArray(models)) return null;
  const out: CustomModelDef[] = [];
  for (const raw of models) {
    if (typeof raw === "string") {
      const id = raw.trim();
      if (!id) continue;
      out.push({ id });
    } else if (raw && typeof raw === "object") {
      const m = raw as CustomModelDef;
      const id = typeof m.id === "string" ? m.id.trim() : "";
      if (!id) continue;
      out.push({
        id,
        name: typeof m.name === "string" && m.name.trim() ? m.name.trim() : undefined,
        supportsThinking: m.supportsThinking === true,
      });
    }
  }
  return out;
}

function normalizeBaseUrl(u: string): string | null {
  const s = u.trim();
  if (!/^https?:\/\/.+/i.test(s)) return null;
  return s.replace(/\/+$/, "");
}

export async function GET() {
  return Response.json(await listPublicCustomProviders());
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const baseUrl = normalizeBaseUrl(typeof body.baseUrl === "string" ? body.baseUrl : "");
  const models = parseModels(body.models);
  if (!name) return bad("Provider name is required.");
  if (!baseUrl) return bad("baseUrl must be an http(s) URL, e.g. https://api.example.com/v1");
  if (!models || !models.length) return bad("Add at least one model.");

  const existing = body.id && typeof body.id === "string"
    ? await getCustomProvider(body.id)
    : undefined;
  const id = existing ? existing.id : uniqueProviderId(body.id || name);

  const apiKey =
    typeof body.apiKey === "string" && body.apiKey.trim()
      ? body.apiKey.trim()
      : "";
  const apiKeyEnv =
    !apiKey && typeof body.apiKeyEnv === "string" && body.apiKeyEnv.trim()
      ? body.apiKeyEnv.trim().replace(/^[^A-Za-z_]+/, "").replace(/[^A-Za-z0-9_]+/g, "_")
      : "";

  const def: CustomProviderDef = {
    id,
    name: name.slice(0, 60),
    glyph: typeof body.glyph === "string" && body.glyph.trim()
      ? body.glyph.trim().slice(0, 2)
      : undefined,
    baseUrl,
    protocol:
      body.protocol === "anthropic" || body.protocol === "gemini"
        ? body.protocol
        : "openai",
    apiKey,
    apiKeyEnv,
    models,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };

  await saveCustomProvider(def);
  return Response.json({
    providers: await listPublicCustomProviders(),
    provider: toPublic(def),
  });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return bad("id required");
  await deleteCustomProvider(id);
  return Response.json({ providers: await listPublicCustomProviders() });
}
