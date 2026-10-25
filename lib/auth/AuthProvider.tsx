"use client";

import * as React from "react";
import { createContext, useContext } from "react";

interface AuthState {
  user: any;
  profile: any;
  org: any;
  isSuper: boolean;
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

export function setCookie(_token: string | null) {}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const value: AuthState = {
    user: { uid: "local", email: "local@local", displayName: "Local User" },
    profile: null,
    org: null,
    isSuper: true,
    ready: true,
    refresh: async () => {},
    signOut: async () => {},
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
