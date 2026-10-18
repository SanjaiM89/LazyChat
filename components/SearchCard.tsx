"use client";

import * as React from "react";
import { Globe, ExternalLink, Search } from "lucide-react";
import { cn } from "@/components/ui";
import { SiteFavicon } from "@/components/brand/BrandIcon";


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
  baseIndex?: number;
  selected?: number | null;
  onSelect?: (n: number) => void;
}) {
  const [expanded, setExpanded] = React.useState(true);

  if (streaming) {
    return (
      <div className="beam-border mb-2 flex flex-col gap-2 rounded-lg border border-border bg-bg-surface-100 px-4 py-3 animate-fade-in-up">
        <div className="flex items-center gap-2 text-[13px] text-fg-secondary">
          <Search size={14} className="text-accent animate-pulse" />
          <span className="text-shine font-medium">
            Searching the web{query ? ` for “${query}”` : "…"}
          </span>
          <span className="ml-1 flex gap-1">
            <span className="thinking-dot" />
            <span className="thinking-dot" />
            <span className="thinking-dot" />
          </span>
        </div>
        <div className="skeleton h-2 w-3/4 rounded-full" />
        <div className="skeleton h-2 w-1/2 rounded-full" />
      </div>
    );
  }

  if (!results || !results.length) {
    return (
      <div className="mb-2 rounded-lg border border-border bg-bg-surface-100 px-4 py-3 text-[13px] text-fg-muted">
        <div className="flex items-center gap-2">
          <Search size={14} />
          <span>No results for “{query}”</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-border bg-bg-surface-100 animate-fade-in-up">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 border-b border-border px-4 py-2.5 transition-colors hover:bg-bg-hover"
      >
        <Globe size={14} className="text-accent" />
        <span className="flex -space-x-1">
          {results.slice(0, 4).map((r, i) => (
            <span key={i} className="flex h-4 w-4 items-center justify-center rounded-full border border-border bg-bg-surface-300 ring-2 ring-bg-surface-100">
              <SiteFavicon hostname={r.hostname} size={10} />
            </span>
          ))}
        </span>
        <span className="text-[13px] font-medium text-fg-secondary">
          Searched the web{query ? ` for “${query}”` : ""}
        </span>
        <span className="ml-auto rounded-full border border-border px-1.5 font-mono text-[10.5px] text-fg-muted">
          {results.length} results
        </span>
      </button>
      {expanded && (
        <div className="grid gap-1.5 p-2 sm:grid-cols-2 stagger [--stagger:35ms]">
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
                if (onSelect && (e.altKey || e.metaKey || e.shiftKey)) {
                  e.preventDefault();
                  onSelect(n);
                }
              }}
              title={`${r.title}\n${r.url}\n\nClick to open · Alt-click to highlight where the answer references it.`}
              className={cn(
                "group flex scroll-mt-24 flex-col gap-1 rounded-md border border-transparent p-2.5 transition-colors hover:border-border hover:bg-bg-surface-200",
                active && "border-brand/50 bg-accent-soft",
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    "flex h-4 min-w-[18px] items-center justify-center rounded px-1 text-[10px] font-bold shrink-0",
                    active ? "bg-brand text-[#0b2e1e]" : "border border-border bg-bg-surface-300 text-fg-muted",
                  )}
                >
                  {n}
                </span>
                <SiteFavicon hostname={r.hostname} size={14} />
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
