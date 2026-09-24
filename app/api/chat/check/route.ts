import { hasProviderKey } from "@/lib/providers";

export const dynamic = "force-dynamic";

/** GET /api/chat/check?provider=anthropic → { ok } whether the key is set */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const provider = (url.searchParams.get("provider") || "anthropic") as any;
  try {
    return Response.json({ ok: await hasProviderKey(provider) });
  } catch {
    return Response.json({ ok: false });
  }
}
