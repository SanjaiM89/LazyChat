"use client";

import * as React from "react";
import { Globe, ExternalLink, Search } from "lucide-react";
import { cn } from "@/components/ui";

/* ------------------------------------------------------------------ */
/*  Claude-style web search card                                       */
/*  - "streaming": animated "Searching the web" bar                    */
/*  - done: grid of results with favicons + snippets                   */
/* ------------------------------------------------------------------ */

interface SearchResult {
  n?: number;
  title: string;
  url: string;
  description: string;
  hostname: string;
}

export function SearchCard({
  query,
  results,
  streaming,
  baseIndex = 0,
  selected,
  onSelect,
}: {
  query?: string;
  results?: SearchResult[] | null;
  streaming: boolean;
  /** global citation offset when several searches share one message */
  baseIndex?: number;
  selected?: number | null;
  onSelect?: (n: number) => void;
}) {
  const [expanded, setExpanded] = React.useState(true);

  if (streaming) {
    return (
      <div className="flex flex-col gap-1 rounded-xl border border-border bg-bg-elevated px-4 py-3 mb-2 animate-fade-in-up">
        <div className="flex items-center gap-2 text-[13px] text-fg-secondary">
          <Search size={14} className="text-accent" />
          <span className="font-medium">
            Searching the web{query ? ` for “${query}”` : "…"}
          </span>
          <span className="ml-1 flex gap-1">
            <span className="thinking-dot" />
            <span className="thinking-dot" />
            <span className="thinking-dot" />
          </span>
        </div>
        <div className="shimmer h-2 w-3/4 rounded-full" />
        <div className="shimmer h-2 w-1/2 rounded-full" />
      </div>
    );
  }

  if (!results || !results.length) {
    return (
      <div className="rounded-xl border border-border bg-bg-elevated px-4 py-3 mb-2 text-[13px] text-fg-muted">
        <div className="flex items-center gap-2">
          <Search size={14} />
          <span>No results for “{query}”</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-bg-elevated mb-2 overflow-hidden animate-fade-in-up">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-bg-hover transition-colors"
      >
        <Globe size={14} className="text-accent" />
        <span className="text-[13px] font-medium text-fg-secondary">
          Searched the web{query ? ` for “${query}”` : ""}
        </span>
        <span className="ml-auto text-[11px] text-fg-muted">
          {results.length} results
        </span>
      </button>
      {expanded && (
        <div className="grid gap-1.5 px-3 pb-3 sm:grid-cols-2">
          {results.slice(0, 8).map((r, i) => {
            const n = r.n ?? baseIndex + i + 1;
            const active = selected === n;
            return (
            <a
              key={`${r.url}-${i}`}
              id={`cite-${n}`}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                // Alt/Option-click (or plain click with a handler) pins the
                // reference: highlight every [n] pill in the answer that
                // points here instead of just navigating away.
                if (onSelect && (e.altKey || e.metaKey || e.shiftKey)) {
                  e.preventDefault();
                  onSelect(n);
                }
              }}
              title={`${r.title}\n${r.url}\n\nClick to open · Alt-click to highlight where the answer references it.`}
              className={cn(
                "group rounded-lg p-2.5 hover:bg-bg-hover transition-colors flex flex-col gap-1 scroll-mt-24",
                active && "bg-accent-soft/60 ring-1 ring-accent/50",
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    "flex h-4 min-w-[18px] items-center justify-center rounded px-1 text-[10px] font-bold shrink-0",
                    active ? "bg-accent text-white" : "bg-bg-inset text-fg-muted",
                  )}
                >
                  {n}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(r.hostname || "")}&sz=32`}
                  alt=""
                  className="w-4 h-4 rounded shrink-0"
                  onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                />
                <span className="text-[11px] text-fg-muted truncate">{r.hostname}</span>
                <ExternalLink size={11} className="ml-auto text-fg-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </span>
              <span className="text-[13px] leading-snug font-medium text-fg line-clamp-2 group-hover:text-accent transition-colors">
                {r.title}
              </span>
              {r.description && (
                <span className="text-[12px] leading-snug text-fg-secondary line-clamp-3">
                  {r.description}
                </span>
              )}
            </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SourceLink({ url, label }: { url: string; label?: string }) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* empty/relative result URL — render the raw value */
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1 text-[12px] text-info hover:underline underline-offset-2",
      )}
    >
      {label || host}
    </a>
  );
}
