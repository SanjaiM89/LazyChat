export type OrgRole = "owner" | "admin" | "member";

export const AUTH_COOKIE = "omnia_token";

/** Headers the proxy sets after verifying the ID token. Inbound copies are always stripped. */
export const H = {
  uid: "x-omnia-uid",
  email: "x-omnia-email",
  org: "x-omnia-org",
  role: "x-omnia-role",
  super: "x-omnia-super",
} as const;

export interface AuthUser {
  uid: string;
  email: string;
  orgId: string | null;
  orgRole: OrgRole | null;
  isSuper: boolean;
}

export function isSuperEmail(email: string | null | undefined): boolean {
  const s = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "")
    .trim()
    .toLowerCase();
  return !!s && !!email && email.trim().toLowerCase() === s;
}
