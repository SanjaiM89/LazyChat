import { NextRequest } from "next/server";
import type { BuiltinProviderId } from "@/lib/types";
import { PROVIDERS } from "@/lib/models";
import {
  builtinKeySource,
  deleteStoredProviderKey,
  setStoredProviderKey,
} from "@/lib/provider-keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bad(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function keyedProviders(): BuiltinProviderId[] {
  return (Object.keys(PROVIDERS) as BuiltinProviderId[]).filter(
    (id) => PROVIDERS[id].requiresKey && PROVIDERS[id].keyEnv,
  );
}

export async function GET() {
  const out: Record<string, { configured: boolean; source: string }> = {};
  for (const id of keyedProviders()) {
    const source = await builtinKeySource(id);
    out[id] = { configured: source !== "none", source };
  }
  return Response.json(out);
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const provider =
    typeof body.provider === "string" ? body.provider.trim() : "";
  if (!provider || !(provider in PROVIDERS)) return bad("Unknown provider.");
  if (!PROVIDERS[provider as BuiltinProviderId].keyEnv) {
    return bad("This provider takes no API key.");
  }
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  await setStoredProviderKey(provider, apiKey);
  const source = await builtinKeySource(provider as BuiltinProviderId);
  return Response.json({ provider, configured: source !== "none", source });
}

export async function DELETE(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider") || "";
  if (!provider || !(provider in PROVIDERS)) return bad("Unknown provider.");
  await deleteStoredProviderKey(provider);
  const source = await builtinKeySource(provider as BuiltinProviderId);
  return Response.json({ provider, configured: source !== "none", source });
}
