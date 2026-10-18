import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthUser } from "./shared";
import { guard, HttpError, requireConfigAdmin, requireUser } from "./server";
import { AUTH_COOKIE } from "./shared";
import { readCookie, rememberToken } from "./token";
import { flushOutbox } from "@/lib/chat-store";

/** Record the (proxy-verified) token for background writers and push any parked chats. */
function noteSession(req: Request, user: AuthUser) {
  rememberToken(user.uid, readCookie(req.headers.get("cookie"), AUTH_COOKIE));
  if (!user.isSuper) void flushOutbox(user.uid).catch(() => {});
}

const als = new AsyncLocalStorage<AuthUser>();

/** The signed-in user for the current request (or background run started by one). */
export function currentUser(): AuthUser | undefined {
  return als.getStore();
}

export function withUser<T>(user: AuthUser, fn: () => T): T {
  return als.run(user, fn);
}

type Ctx<P> = { params: Promise<P> };

/**
 * Wrap a route handler: require a signed-in user, expose it to deep library code
 * through currentUser(), and turn HttpError into JSON.
 */
export function authed<P = unknown>(
  fn: (req: Request, user: AuthUser, ctx: Ctx<P>) => Promise<Response> | Response,
): (req: Request, ctx: Ctx<P>) => Promise<Response> {
  return guard(async (req: Request, ctx: Ctx<P>) => {
    const user = requireUser(req);
    noteSession(req, user);
    return withUser(user, () => fn(req, user, ctx));
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: any, ctx: any) => Promise<Response> | Response;

/**
 * Wrap an existing route handler without rewriting it: requires a signed-in user,
 * exposes it via currentUser(), and (with `adminWrites`) restricts non-GET calls to
 * org owners/admins - users with no org manage their own config.
 */
export function scoped<H extends Handler>(fn: H, opts: { adminWrites?: boolean; superOnly?: boolean } = {}): H {
  return guard(async (req: Request, ctx: never) => {
    const user = requireUser(req);
    noteSession(req, user);
    if (opts.superOnly && !user.isSuper) throw new HttpError(403, "Super admin only");
    if (opts.adminWrites && req.method !== "GET" && req.method !== "HEAD") requireConfigAdmin(req);
    return withUser(user, () => fn(req, ctx));
  }) as unknown as H;
}
