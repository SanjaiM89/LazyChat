import { scoped } from "@/lib/auth/context";
import { NextRequest } from "next/server";
import { PROVIDERS } from "@/lib/models";
import {
  addProviderModel,
  deleteProviderModel,
  getEffectiveBuiltinModels,
  getProviderOverride,
  renameProviderModel,
  unhideProviderModel,
} from "@/lib/provider-models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bad(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

async function GET_impl(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider") || "";
  if (provider) {
    if (!(provider in PROVIDERS)) return bad("Unknown provider.");
    const builtin = (PROVIDERS as any)[provider].models || [];
    return Response.json({
      provider,
      builtin,
      effective: await getEffectiveBuiltinModels(provider),
      override: await getProviderOverride(provider),
    });
  }
  const out: Record<string, unknown> = {};
  for (const id of Object.keys(PROVIDERS)) {
    out[id] = {
      builtin: (PROVIDERS as any)[id].models || [],
      effective: await getEffectiveBuiltinModels(id),
      override: await getProviderOverride(id),
    };
  }
  return Response.json(out);
}

async function POST_impl(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!provider || !(provider in PROVIDERS)) return bad("Unknown provider.");
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return bad("Model id required.");
  await addProviderModel(provider, {
    id,
    name: typeof body.name === "string" ? body.name : undefined,
    supportsThinking: typeof body.supportsThinking === "boolean" ? body.supportsThinking : true,
  });
  return Response.json({ provider, effective: await getEffectiveBuiltinModels(provider) });
}

async function PUT_impl(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!provider || !(provider in PROVIDERS)) return bad("Unknown provider.");
  const oldId = typeof body.oldId === "string" ? body.oldId.trim() : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!oldId || !id) return bad("oldId and id required.");
  await renameProviderModel(provider, oldId, {
    id,
    name: typeof body.name === "string" ? body.name : undefined,
    supportsThinking: typeof body.supportsThinking === "boolean" ? body.supportsThinking : true,
  });
  return Response.json({ provider, effective: await getEffectiveBuiltinModels(provider) });
}

async function DELETE_impl(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider") || "";
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!provider || !(provider in PROVIDERS)) return bad("Unknown provider.");
  if (!id) return bad("id required.");
  if (req.nextUrl.searchParams.get("unhide") === "1") {
    await unhideProviderModel(provider, id);
  } else {
    await deleteProviderModel(provider, id);
  }
  return Response.json({ provider, effective: await getEffectiveBuiltinModels(provider) });
}

export const GET = scoped(GET_impl, { adminWrites: true });
export const POST = scoped(POST_impl, { adminWrites: true });
export const PUT = scoped(PUT_impl, { adminWrites: true });
export const DELETE = scoped(DELETE_impl, { adminWrites: true });
