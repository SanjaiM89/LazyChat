import { FIREBASE_PROJECT_ID } from "./verify";
import type { OrgRole } from "./shared";

export interface UserProfile {
  orgId: string | null;
  orgRole: OrgRole | null;
  status: "active" | "disabled";
  orgStatus: "active" | "disabled" | null;
}

const cache = new Map<string, { at: number; v: UserProfile | null }>();
const TTL = 30_000;

type FsDoc = { fields?: Record<string, { stringValue?: string }> } | null;

async function getDoc(path: string, token: string): Promise<FsDoc | "denied"> {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) return "denied";
  return (await res.json()) as FsDoc;
}

const str = (d: FsDoc, k: string): string | null => d?.fields?.[k]?.stringValue ?? null;

/**
 * Reads users/{uid} (and orgs/{orgId}) as the caller, so Firestore rules apply.
 * Returns null if the profile doesn't exist yet (just signed up).
 */
export async function loadProfile(uid: string, token: string): Promise<UserProfile | null> {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: UserProfile | null = null;
  const u = await getDoc(`users/${uid}`, token);
  if (u && u !== "denied") {
    const orgId = str(u, "orgId");
    let orgStatus: UserProfile["orgStatus"] = null;
    if (orgId) {
      const o = await getDoc(`orgs/${orgId}`, token);
      if (o && o !== "denied") orgStatus = str(o, "status") === "disabled" ? "disabled" : "active";
    }
    v = {
      orgId,
      orgRole: (str(u, "orgRole") as OrgRole | null) ?? null,
      status: str(u, "status") === "disabled" ? "disabled" : "active",
      orgStatus,
    };
  }
  cache.set(uid, { at: Date.now(), v });
  return v;
}
