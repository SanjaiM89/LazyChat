"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/lib/app-store";
import type { SandboxMeta } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Sandbox registry                                                    */
/*  Polls the sandbox service (via the Next proxy) and merges live      */
/*  Docker VMs into the store, so the mini-computer + Sandbox panel      */
/*  show every sandbox spawned by agents or the chat.                   */
/* ------------------------------------------------------------------ */

export function useSandboxRegistry() {
  const registerSandbox = useAppStore((s) => s.registerSandbox);
  const removeSandbox = useAppStore((s) => s.removeSandbox);
  const setSandboxStatus = useAppStore((s) => s.setSandboxStatus);
  const lastStatus = useRef<"unknown" | "ok" | "down">("unknown");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const setStatusOnce = (s: "ok" | "down") => {
      if (lastStatus.current !== s) {
        lastStatus.current = s;
        setSandboxStatus(s);
      }
    };

    const poll = async () => {
      try {
        const res = await fetch("/api/sandbox/list", { cache: "no-store" });
        if (!res.ok) {
          setStatusOnce("down");
          return;
        }
        const sandboxes: SandboxMeta[] = await res.json();
        setStatusOnce("ok");
        const listed = new Set(sandboxes.map((s) => s.id));
        // A finished agent disposes its sandbox server-side, so any sandbox we
        // still hold that the server no longer lists has already auto-closed —
        // drop it so the mini-computer / sandbox panel don't keep stale cards.
        for (const sb of useAppStore.getState().sandboxes) {
          if (!listed.has(sb.id)) removeSandbox(sb.id);
        }
        for (const sb of sandboxes) registerSandbox(sb);
      } catch {
        setStatusOnce("down");
      } finally {
        if (!cancelled) timer = setTimeout(poll, 2200);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [registerSandbox, removeSandbox, setSandboxStatus]);
}
