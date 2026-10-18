import { authed } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

/** The browser calls this after each token refresh so background chat runs keep a valid token. */
export const POST = authed(async () => Response.json({ ok: true }));
