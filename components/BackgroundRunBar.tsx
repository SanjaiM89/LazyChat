"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Eye, Square } from "lucide-react";
import { Spinner, cn } from "@/components/ui";
import { modelLabel, providerGlyph } from "@/lib/app-store";
import type { ChatRunSummary } from "@/lib/types";
import type { ChatController } from "@/lib/use-chat";

/* ------------------------------------------------------------------ */
/*  Background-run banner                                              */
/*                                                                     */
/*  Shown above the composer while the server is generating a reply     */
/*  this tab is not watching — after a reload, from another tab, or     */
/*  after switching conversations. Says what it is doing right now and  */
/*  lets you watch it live or stop it.                                  */
/* ------------------------------------------------------------------ */

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

  // Keep the elapsed timer ticking while the run is live.
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
    <div className="mb-2 flex items-center gap-2.5 rounded-2xl border border-accent/25 bg-accent-soft/50 px-3.5 py-2.5">
      <Spinner size={14} className="shrink-0 text-accent" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-fg">
          Generating in the background — {run.activity}
        </p>
        <p className="truncate text-[11px] text-fg-muted">
          {providerGlyph(run.provider)} {modelLabel(run.provider, run.model)}
          {run.step > 0 ? ` · step ${run.step}` : ""} ·{" "}
          {elapsed(run.startedAt, now)} — keeps running if you close this tab
        </p>
      </div>

      <button
        onClick={() => void show()}
        disabled={attaching}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-[12px] font-medium text-fg transition-colors",
          "hover:border-accent/40 hover:bg-bg-hover disabled:opacity-50",
        )}
        title="Watch this reply stream in live"
      >
        {attaching ? <Spinner size={12} /> : <Eye size={13} />}
        Show
      </button>

      <button
        onClick={() => void chat.stopRun(run.id)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-danger/20 bg-danger-soft px-2.5 py-1.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger/15"
        title="Stop generating (keeps the partial reply)"
      >
        <Square size={12} fill="currentColor" />
        Stop
      </button>
    </div>
  );
}
