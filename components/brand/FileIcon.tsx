"use client";

import * as React from "react";
import { cn } from "@/components/ui";

/** Document-shaped file badge in each format's familiar color (Word blue, Excel green, PDF red…). */
const FORMATS: { test: RegExp; label: string; color: string }[] = [
  { test: /pdf/, label: "PDF", color: "#E5252A" },
  { test: /(^|\.|\/)(xlsx?|xlsm|spreadsheet|sheet)/, label: "XLS", color: "#107C41" },
  { test: /(^|\.|\/)csv/, label: "CSV", color: "#1D9F55" },
  { test: /(^|\.|\/)(docx?|word|document)/, label: "DOC", color: "#2B579A" },
  { test: /(^|\.|\/)(pptx?|presentation)/, label: "PPT", color: "#D24726" },
  { test: /(^|\.|\/)(md|markdown)$|markdown/, label: "MD", color: "#6E7781" },
  { test: /(^|\.|\/)(png|jpe?g|gif|webp|svg|image)/, label: "IMG", color: "#8E44EF" },
  { test: /(^|\.|\/)(json)$|json/, label: "JSON", color: "#C59400" },
  { test: /(^|\.|\/)(py)$|python/, label: "PY", color: "#3776AB" },
  { test: /(^|\.|\/)(tsx?|typescript)$/, label: "TS", color: "#3178C6" },
  { test: /(^|\.|\/)(jsx?|mjs|javascript)$/, label: "JS", color: "#D4B600" },
  { test: /(^|\.|\/)(html?)$|html/, label: "HTML", color: "#E34F26" },
  { test: /(^|\.|\/)(css)$/, label: "CSS", color: "#663399" },
  { test: /(^|\.|\/)(zip|tar|gz)$/, label: "ZIP", color: "#7A7A7A" },
  { test: /(^|\.|\/)(txt|log)$|text\/plain/, label: "TXT", color: "#6E7781" },
];

export function fileFormat(typeOrName: string | undefined) {
  const t = String(typeOrName ?? "").toLowerCase();
  return FORMATS.find((f) => f.test.test(t)) ?? { label: "FILE", color: "#6E7781" };
}

export function FileIcon({ type, size = 32, className }: { type: string | undefined; size?: number; className?: string }) {
  const f = fileFormat(type);
  const h = size;
  const w = Math.round(size * 0.8);
  return (
    <svg width={w} height={h} viewBox="0 0 40 50" className={cn("shrink-0 drop-shadow-sm", className)} aria-label={`${f.label} file`}>
      <path d="M4 0h23l13 13v33a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill="var(--bg-surface-300)" stroke="var(--border-strong)" strokeWidth="1" />
      <path d="M27 0v9a4 4 0 0 0 4 4h9z" fill="var(--border-stronger)" />
      <rect x="0" y="28" width="34" height="14" rx="3" fill={f.color} />
      <text x="17" y="38.4" textAnchor="middle" fontSize={f.label.length > 3 ? 8 : 9.5} fontWeight="700" fill="#fff" fontFamily="var(--font-sans)" letterSpacing="0.3">
        {f.label}
      </text>
    </svg>
  );
}
