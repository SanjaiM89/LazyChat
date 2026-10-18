"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Monitor, Maximize2, Loader2, X } from "lucide-react";
import { cn } from "@/components/ui";
import { useAppStore } from "@/lib/app-store";
import type { SandboxMeta } from "@/lib/types";
import { BrandIcon } from "@/components/brand/BrandIcon";


function useSandboxScreenshots() {
  const sandboxes = useAppStore((s) => s.sandboxes);
  const setSandboxScreenshot = useAppStore((s) => s.setSandboxScreenshot);
  const activeId = useAppStore((s) => s.activeSandboxId);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const live = sandboxes.filter((s) => s.state === "ready" || s.state === "busy");
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (!live.length) return;
    timer.current = setInterval(async () => {
      for (const s of live) {
        try {
          const res = await fetch(`/api/sandbox/${s.id}/screenshot`, {
            cache: "no-store",
          });
          if (!res.ok) continue;
          const { image } = await res.json();
          if (image) setSandboxScreenshot(s.id, image);
        } catch {
        }
      }
    }, 1800);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [sandboxes, activeId, setSandboxScreenshot]);

  return sandboxes;
}

export function SandboxMini() {
  const sandboxes = useSandboxScreenshots();
  const setPanel = useAppStore((s) => s.setPanel);
  const setActiveSandbox = useAppStore((s) => s.setActiveSandbox);
  const removeSandbox = useAppStore((s) => s.removeSandbox);
  const activeSandboxId = useAppStore((s) => s.activeSandboxId);
  const [hovered, setHovered] = useState<string | null>(null);

  const live = sandboxes
    .filter((s) => s.state === "ready" || s.state === "busy" || s.state === "starting")
    .sort((a, b) => b.createdAt - a.createdAt);
  if (!live.length) return null;
  const sb: SandboxMeta =
    live.find((s) => s.id === activeSandboxId) || live[0];

  const close = () => {
    void fetch(`/api/sandbox/${sb.id}`, { method: "DELETE" }).catch(() => {});
    removeSandbox(sb.id);
  };

  return (
    <div className="mb-2 flex items-center gap-2">
      <div
        className={cn(
          "lift relative overflow-hidden rounded-lg border border-border bg-bg-surface-100 shadow-soft",
          "hover:border-border-strong hover:shadow-pop cursor-pointer animate-fade-in-up",
          sb.state === "busy" && "beam-border",
        )}
        onMouseEnter={() => setHovered(sb.id)}
        onMouseLeave={() => setHovered(null)}
        onClick={() => {
          setActiveSandbox(sb.id);
          setPanel("sandbox");
        }}
      >
        <div className="flex items-center gap-1.5 border-b border-border bg-bg-surface-200 px-2.5 py-1.5">
          <span className="h-2 w-2 rounded-full bg-danger/70" />
          <span className="h-2 w-2 rounded-full bg-warning/70" />
          <span className="h-2 w-2 rounded-full bg-success/70" />
          <span className="ml-2 flex items-center gap-1 text-[10.5px] font-medium text-fg-muted">
            <BrandIcon name="chrome" size={10} fallback={<Monitor size={10} className="text-accent" />} />
            {sb.label}
            <span className="font-mono text-[9px] uppercase tracking-wider text-fg-faint">
              {sb.state}
            </span>
          </span>
        </div>

        <div className="relative flex h-[68px] w-[120px] items-center justify-center bg-[#0d0d0c]">
          {sb.lastScreenshot ? (
            <img
              src={sb.lastScreenshot}
              alt="sandbox screen"
              className="h-full w-full object-cover"
            />
          ) : sb.state === "starting" ? (
            <div className="flex flex-col items-center gap-1.5 text-fg-muted">
              <Loader2 size={16} className="animate-spin text-accent" />
              <span className="text-[9.5px]">booting…</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-fg-muted">
              <span className="live-dot !h-1.5 !w-1.5" />
              <span className="text-[9.5px]">
                {sb.state === "busy" ? "working…" : "live"}
              </span>
            </div>
          )}

          <div
            className={cn(
              "absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[1px] transition-opacity duration-200",
              hovered === sb.id ? "opacity-100" : "opacity-0 pointer-events-none",
            )}
          >
            <Maximize2 size={16} className="text-white" />
          </div>
        </div>

        {hovered === sb.id && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
            className="absolute right-1.5 top-7 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-danger/80 animate-scale-in"
            title="Close sandbox"
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
