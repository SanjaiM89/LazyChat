import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { H } from "@/lib/auth/shared";

// Local-only mode: no auth, no Firebase. Allow everything.
//
// The routes behind `authed()`/`scoped()` still read their identity from the
// headers set here, so local mode has to hand them one: every request runs as
// the local super user. Without it every API call answers 401 "Not signed in".
export function proxy(req: NextRequest) {
  // Never trust identity headers coming from the client.
  const headers = new Headers(req.headers);
  for (const h of Object.values(H)) headers.delete(h);

  headers.set(H.uid, "local");
  headers.set(H.email, "local@local");
  headers.set(H.super, "1");
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
