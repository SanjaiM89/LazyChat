import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, H, isSuperEmail } from "@/lib/auth/shared";
import { verifyIdToken } from "@/lib/auth/verify";
import { loadProfile } from "@/lib/auth/profile";

// /dev/* harnesses (no data, no model) are reachable without a session in development only.
const PUBLIC_PAGES = process.env.NODE_ENV === "production" ? ["/login"] : ["/login", "/dev"];

function json(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isPublicPage = PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  // Never trust identity headers coming from the client.
  const headers = new Headers(req.headers);
  for (const h of Object.values(H)) headers.delete(h);

  // Local harness agents reach their MCP endpoints with a shared secret instead of a user session.
  const internalPath = pathname === "/api/dsh/memory/mcp" || pathname === "/api/brain/mcp";
  const secret = process.env.OMNIA_INTERNAL_TOKEN;
  if (internalPath && secret && req.nextUrl.searchParams.get("t") === secret) {
    return NextResponse.next({ request: { headers } });
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const v = await verifyIdToken(token);

  if (!v) {
    if (isApi) return json(401, "Not signed in");
    if (isPublicPage) return NextResponse.next({ request: { headers } });
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const isSuper = isSuperEmail(v.email);
  let orgId: string | null = null;
  let orgRole: string | null = null;
  if (!isSuper) {
    const p = await loadProfile(v.uid, token!);
    if (p && (p.status === "disabled" || p.orgStatus === "disabled")) {
      if (isApi) return json(403, "Account disabled");
      if (!isPublicPage) return NextResponse.redirect(new URL("/login?disabled=1", req.url));
    }
    orgId = p?.orgId ?? null;
    orgRole = p?.orgRole ?? null;
  }

  // The super admin sees /admin and nothing else.
  if (isSuper && !isApi && !pathname.startsWith("/admin") && !isPublicPage) {
    return NextResponse.redirect(new URL("/admin", req.url));
  }
  if (!isSuper && pathname.startsWith("/admin")) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  headers.set(H.uid, v.uid);
  headers.set(H.email, v.email);
  headers.set(H.org, orgId ?? "");
  headers.set(H.role, orgRole ?? "");
  headers.set(H.super, isSuper ? "1" : "");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|prefab/|favicon.ico|manifest.webmanifest|.*\\.(?:png|jpg|svg|ico|webp|woff2?)$).*)",
  ],
};
