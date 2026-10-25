"use client";

import * as React from "react";
import { History, RefreshCw } from "lucide-react";

import { useAppStore } from "@/lib/app-store";
import { cn } from "@/components/ui";

/**
 * The session browser.
 *
 * Every conversation, with how much history it holds; open one to see the
 * turns, steps and tool calls that made it up.
 */

interface SessionRow {
  id: string;
  title: string;
  updated_at: number;
  events: number;
  last_event: { type: string; at: number } | null;
}

interface TraceEvent {
  seq: number;
  type: string;
  at: number;
  run_id: string | null;
  data: Record<string, unknown>;
}

function when(at: number): string {
  if (!at) return "—";
  const seconds = Math.floor((Date.now() - at) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(at).toLocaleDateString();
}

export function SessionBrowser() {
  const [rows, setRows] = React.useState<SessionRow[]>([]);
  const [open, setOpen] = React.useState<string | null>(null);
  const [events, setEvents] = React.useState<TraceEvent[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const activeConversationId = useAppStore((s) => s.activeConversationId);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/agent/sessions", { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setRows(data.conversations ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "The sessions could not be read.");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const openTrace = React.useCallback(async (id: string) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    setEvents([]);
    try {
      const res = await fetch(`/api/agent/sessions/${encodeURIComponent(id)}/trace`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch (e) {
      setError((e as Error).message || "The trace could not be read.");
    }
  }, [open]);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <History size={15} className="text-fg-muted" />
        <span className="text-[13px] font-medium">Sessions</span>
        <button
          onClick={() => void load()}
          className="ml-auto rounded p-1 text-fg-muted hover:bg-bg-hover hover:text-fg"
          title="Reload"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {error && <div className="px-4 py-2 text-[12px] text-danger">{error}</div>}

      <div className="px-2 py-2">
        {rows.length === 0 && (
          <div className="px-2 py-6 text-center text-[12px] text-fg-muted">
            No sessions yet.
          </div>
        )}
        {rows.map((row) => (
          <div key={row.id}>
            <button
              onClick={() => void openTrace(row.id)}
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-left hover:bg-bg-hover",
                row.id === activeConversationId && "bg-bg-surface-200",
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[12px] font-medium">{row.title || "Untitled"}</span>
                <span className="ml-auto shrink-0 text-[10px] text-fg-muted">{when(row.last_event?.at ?? row.updated_at)}</span>
              </div>
              <div className="text-[10px] text-fg-muted">
                {row.events} event{row.events === 1 ? "" : "s"}
                {row.last_event ? ` · ${row.last_event.type}` : ""}
              </div>
            </button>

            {open === row.id && (
              <div className="ml-2 mt-1 space-y-1 border-l border-border pl-3 pb-2">
                {events.length === 0 && <div className="text-[11px] text-fg-muted">No events.</div>}
                {events.map((event) => (
                  <div key={event.seq} className="text-[11px] leading-relaxed">
                    <span className="font-mono text-[10px] text-fg-muted">#{event.seq}</span>{" "}
                    <span className="font-medium">{event.type}</span>
                    {typeof event.data.text === "string" && (
                      <div className="truncate text-fg-muted">{event.data.text.slice(0, 120)}</div>
                    )}
                    {typeof event.data.tool === "string" && (
                      <div className="truncate text-fg-muted">{event.data.tool}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
