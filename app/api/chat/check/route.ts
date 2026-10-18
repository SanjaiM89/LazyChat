import { hasProviderKey } from "@/lib/providers";
import { authed } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

export const GET = authed(async (req: Request) => {
  const url = new URL(req.url);
  const provider = (url.searchParams.get("provider") || "anthropic") as any;
  try {
    return Response.json({ ok: await hasProviderKey(provider) });
  } catch {
    return Response.json({ ok: false });
  }
});
