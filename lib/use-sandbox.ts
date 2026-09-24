"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/lib/app-store";
import type { SandboxMeta } from "@/lib/types";


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
