"use client";

import * as React from "react";
import { AlertTriangle, ArrowUpRight, Download, FileCode2, FileImage, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useAppStore } from "@/lib/app-store";

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  table: FileSpreadsheet,
  image: FileImage,
  svg: FileImage,
  code: FileCode2,
  html: FileCode2,
};
const LABELS: Record<string, string> = { docx: "Word document", pdf: "PDF", xlsx: "Excel workbook", csv: "CSV", markdown: "Markdown", html: "HTML page", code: "Code", svg: "SVG", image: "Image", text: "Text", mermaid: "Diagram", table: "Table" };

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Inline card for files the assistant creates: createArtifact (text/code/html...) and generate_document (docx/pdf/xlsx). */
export function DocumentCard({
  toolName,
  args,
  result,
  streaming,
  errorText,
}: {
  toolName: string;
  args?: Record<string, any>;
  result?: any;
  streaming: boolean;
  errorText?: string;
}) {
  const openArtifact = useAppStore((s) => s.openArtifact);
  const kind: string = result?.type ?? args?.kind ?? args?.type ?? "text";
  const Icon = ICONS[kind] ?? FileText;
  const title: string = result?.title ?? args?.title ?? "Untitled";

  if (errorText || result?.ok === false) {
    return (
      <div className="my-2 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>Could not create &ldquo;{title}&rdquo;: {errorText ?? result?.error}</span>
      </div>
    );
  }

  if (streaming || !result?.artifactId) {
    const progress =
      toolName === "generate_document"
        ? Array.isArray(args?.spec?.blocks)
          ? `${args.spec.blocks.length} section${args.spec.blocks.length === 1 ? "" : "s"} written`
          : Array.isArray(args?.spec?.sheets)
            ? `${args.spec.sheets.length} sheet${args.spec.sheets.length === 1 ? "" : "s"}, ${args.spec.sheets.reduce((n: number, s: any) => n + (s?.rows?.length ?? 0), 0)} rows`
            : "Writing…"
        : typeof args?.content === "string"
          ? `${args.content.length.toLocaleString()} characters`
          : "Writing…";
    return (
      <div className="my-2 flex items-center gap-3 rounded-xl border border-border bg-bg-elevated px-4 py-3 animate-fade-in-up">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-fg">{title}</span>
          <span className="text-[12px] text-fg-muted">{LABELS[kind] ?? kind} · {progress}</span>
        </span>
        <Loader2 size={15} className="animate-spin text-accent" />
      </div>
    );
  }

  const size = formatSize(result.size);
  return (
    <div className="group my-2 flex items-center gap-3 rounded-xl border border-border bg-bg-elevated px-4 py-3 transition-colors hover:border-accent/40 animate-fade-in-up">
      <button onClick={() => openArtifact(result.artifactId)} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="Open in side panel">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-fg">{title}</span>
          <span className="text-[12px] text-fg-muted">
            {LABELS[kind] ?? kind}
            {size ? ` · ${size}` : ""}
            {result.pages ? ` · ${result.pages} pages` : ""}
          </span>
        </span>
        <span className="flex items-center gap-1 text-[12px] text-accent opacity-0 transition-opacity group-hover:opacity-100">
          Open <ArrowUpRight size={13} />
        </span>
      </button>
      {result.url && (
        <a href={result.url} download={result.filename} className="rounded-lg p-2 text-fg-muted hover:bg-bg-hover hover:text-fg" title="Download" aria-label={`Download ${result.filename ?? title}`}>
          <Download size={15} />
        </a>
      )}
    </div>
  );
}
