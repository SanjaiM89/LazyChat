import { NextRequest } from "next/server";
import {
  deleteSearchProvider,
  listPublicSearchProviders,
  saveSearchProvider,
  SEARCH_KINDS,
} from "@/lib/search-providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bad(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function GET() {
  return Response.json(await listPublicSearchProviders());
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const kind = body.kind as string;
  if (!kind || !(kind in SEARCH_KINDS)) return bad("Unknown search provider kind.");
  const meta = SEARCH_KINDS[kind as keyof typeof SEARCH_KINDS];
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : meta.label;
  if (meta.needsUrl && !(typeof body.baseUrl === "string" && /^https?:\/\/.+/i.test(body.baseUrl.trim()))) {
    return bad("A valid http(s) base URL is required for this provider.");
  }
  const now = Date.now();
  const all = await saveSearchProvider({
    id: typeof body.id === "string" ? body.id : "",
    name,
    kind: kind as "tavily" | "brave" | "serper" | "searxng" | "duckduckgo",
    apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
    apiKeyEnv: typeof body.apiKeyEnv === "string" ? body.apiKeyEnv : undefined,
    baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
    maxResults: typeof body.maxResults === "number" ? body.maxResults : undefined,
    enabled: body.enabled !== false,
    createdAt: now,
    updatedAt: now,
  });
  const { toPublicSearchProvider } = await import("@/lib/search-providers");
  return Response.json({
    providers: all.map(toPublicSearchProvider),
    provider: all.find((p) => p.id === (typeof body.id === "string" && body.id ? body.id : all[0]?.id)),
  });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!id) return bad("id required.");
  await deleteSearchProvider(id);
  return Response.json({ providers: await listPublicSearchProviders() });
}

export async function PATCH(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return bad("id required.");
  const { listSearchProviders } = await import("@/lib/search-providers");
  const existing = (await listSearchProviders()).find((p) => p.id === id);
  if (!existing) return bad("Unknown provider.");
  const all = await saveSearchProvider({
    ...existing,
    enabled: body.enabled !== false,
  });
  const { toPublicSearchProvider } = await import("@/lib/search-providers");
  return Response.json({ providers: all.map(toPublicSearchProvider) });
}
