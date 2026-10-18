import { H, type AuthUser, type OrgRole } from "./shared";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Identity set by proxy.ts after verifying the Firebase ID token. Throws 401 if absent. */
export function requireUser(req: Request): AuthUser {
  const uid = req.headers.get(H.uid);
  if (!uid) throw new HttpError(401, "Not signed in");
  return {
    uid,
    email: req.headers.get(H.email) ?? "",
    orgId: req.headers.get(H.org) || null,
    orgRole: (req.headers.get(H.role) || null) as OrgRole | null,
    isSuper: req.headers.get(H.super) === "1",
  };
}

export function isOrgAdmin(u: AuthUser): boolean {
  return u.isSuper || (!!u.orgId && (u.orgRole === "owner" || u.orgRole === "admin"));
}

/** Users with no org manage their own config; org members need owner/admin. */
export function requireConfigAdmin(req: Request): AuthUser {
  const u = requireUser(req);
  if (u.orgId && !isOrgAdmin(u)) throw new HttpError(403, "Organization admin only");
  return u;
}

export function requireSuper(req: Request): AuthUser {
  const u = requireUser(req);
  if (!u.isSuper) throw new HttpError(403, "Super admin only");
  return u;
}

/** Wrap a route handler so HttpError becomes a JSON response. */
export function guard<A extends unknown[]>(
  fn: (...args: A) => Promise<Response> | Response,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  };
}

/** Directory-safe key for shared config. Users without an org are scoped to their own uid. */
export function scopeKey(u: AuthUser): string {
  return u.orgId ? `org-${u.orgId}` : `user-${u.uid}`;
}
