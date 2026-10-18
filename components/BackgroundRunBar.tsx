"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Eye, Square } from "lucide-react";
import { Spinner, cn } from "@/components/ui";
import { modelLabel, providerGlyph } from "@/lib/app-store";
import { BrandIcon, modelIconKey } from "@/components/brand/BrandIcon";
import type { ChatRunSummary } from "@/lib/types";
import type { ChatController } from "@/lib/use-chat";


function elapsed(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function BackgroundRunBar({
  run,
  chat,
}: {
  run: ChatRunSummary;
  chat: ChatController;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const show = async () => {
    setAttaching(true);
    try {
      await chat.showRun(run.id);
    } finally {
      setAttaching(false);
    }
  };

  return (
    <div className="beam-border mb-2 flex items-center gap-2.5 rounded-lg border border-brand/25 bg-accent-soft px-3.5 py-2.5 animate-fade-in-up">
      <span className="live-dot shrink-0" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-fg">
          Generating in the background — {run.activity}
        </p>
        <p className="flex items-center gap-1 truncate text-[11px] text-fg-muted">
          <BrandIcon name={modelIconKey(run.model, run.provider)} size={11} fallback={<span>{providerGlyph(run.provider)}</span>} />
          {modelLabel(run.provider, run.model)}
          {run.step > 0 ? ` · step ${run.step}` : ""} ·{" "}
          {elapsed(run.startedAt, now)} — keeps running if you close this tab
        </p>
      </div>

      <button
        onClick={() => void show()}
        disabled={attaching}
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border-strong bg-bg-control px-2.5 text-[12px] font-medium text-fg transition-colors",
          "hover:border-border-stronger hover:bg-bg-surface-300 disabled:opacity-50",
        )}
        title="Watch this reply stream in live"
      >
        {attaching ? <Spinner size={12} /> : <Eye size={13} />}
        Show
      </button>

      <button
        onClick={() => void chat.stopRun(run.id)}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2.5 text-[12px] font-medium text-danger transition-colors hover:border-danger/50 hover:bg-danger/15"
        title="Stop generating (keeps the partial reply)"
      >
        <Square size={12} fill="currentColor" />
        Stop
      </button>
    </div>
  );
}
