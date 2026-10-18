"use client";

import * as React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onIdTokenChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { acceptInvite, getOrg, getUser, type OrgDoc, type UserDoc } from "@/lib/firebase/data";
import { AUTH_COOKIE, isSuperEmail } from "@/lib/auth/shared";
import { useAppStore } from "@/lib/app-store";

interface AuthState {
  /** undefined while Firebase is still resolving the session. */
  user: User | null | undefined;
  profile: UserDoc | null;
  org: OrgDoc | null;
  isSuper: boolean;
  /** True once the session cookie matches the current token (safe to call /api). */
  ready: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

export function setCookie(token: string | null) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = token
    ? `${AUTH_COOKIE}=${token}; Path=/; SameSite=Lax; Max-Age=3600${secure}`
    : `${AUTH_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

const LAST_UID_KEY = "omnia-last-uid";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const [org, setOrg] = useState<OrgDoc | null>(null);
  const [ready, setReady] = useState(false);
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(async (u: User) => {
    if (isSuperEmail(u.email)) {
      setProfile(null);
      setOrg(null);
      return;
    }
    let p = await getUser(u.uid);
    if (p && !p.orgId && u.email) {
      try {
        if (await acceptInvite(u.uid, u.email)) p = await getUser(u.uid);
      } catch {
        /* no invite or not permitted */
      }
    }
    setProfile(p);
    setOrg(p?.orgId ? await getOrg(p.orgId).catch(() => null) : null);
  }, []);

  useEffect(() => {
    return onIdTokenChanged(auth, async (u) => {
      if (!u) {
        setCookie(null);
        setUser(null);
        setProfile(null);
        setOrg(null);
        setReady(true);
        loadedFor.current = null;
        return;
      }
      setCookie(await u.getIdToken());
      // Let the server pick up the refreshed token (background chat runs write to Firestore with it).
      if (!isSuperEmail(u.email)) void fetch("/api/auth/session", { method: "POST" }).catch(() => {});
      // Another account used this browser before: drop its device-local state.
      try {
        const last = localStorage.getItem(LAST_UID_KEY);
        if (last && last !== u.uid) {
          useAppStore.setState({ activeConversationId: null, conversationWorkspaces: {} });
        }
        localStorage.setItem(LAST_UID_KEY, u.uid);
      } catch {
        /* storage unavailable */
      }
      setUser(u);
      if (loadedFor.current !== u.uid) {
        loadedFor.current = u.uid;
        await load(u).catch(() => {});
      }
      setReady(true);
    });
  }, [load]);

  // Tokens last an hour; the SDK refreshes them and onIdTokenChanged rewrites the cookie.
  const refresh = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) return;
    await u.getIdToken(true).then(setCookie);
    await load(u);
  }, [load]);

  const signOut = useCallback(async () => {
    setCookie(null);
    await fbSignOut(auth);
    location.href = "/login";
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, profile, org, isSuper: isSuperEmail(user?.email), ready, refresh, signOut }),
    [user, profile, org, ready, refresh, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
