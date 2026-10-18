"use client";

import * as React from "react";
import { AlertTriangle, ArrowUpRight, Download, Loader2 } from "lucide-react";
import { useAppStore } from "@/lib/app-store";
import { FileIcon } from "@/components/brand/FileIcon";

/** Artifact kinds mapped onto the file-format badge they should wear. */
const FORMAT: Record<string, string> = {
  docx: "docx", pdf: "pdf", xlsx: "xlsx", csv: "csv", table: "xlsx", markdown: "md", html: "html",
  code: "code.js", svg: "svg", image: "png", text: "txt", mermaid: "md",
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
  const icon = <FileIcon type={result?.filename ?? FORMAT[kind] ?? kind} size={34} />;
  const title: string = result?.title ?? args?.title ?? "Untitled";

  if (errorText || result?.ok === false) {
    return (
      <div className="my-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger animate-fade-in-up">
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
      <div className="beam-border my-2 flex items-center gap-3 rounded-lg border border-border bg-bg-surface-100 px-3.5 py-2.5 animate-fade-in-up">
        <span className="animate-float">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-fg">{title}</span>
          <span className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
            <span className="eyebrow !text-[10px]">{LABELS[kind] ?? kind}</span>
            <span className="text-fg-faint">·</span>
            <span className="text-shine">{progress}</span>
          </span>
        </span>
        <Loader2 size={15} className="animate-spin text-accent" />
      </div>
    );
  }

  const size = formatSize(result.size);
  return (
    <div className="lift group my-2 flex items-center gap-3 rounded-lg border border-border bg-bg-surface-100 px-3.5 py-2.5 hover:border-border-strong animate-fade-in-up">
      <button onClick={() => openArtifact(result.artifactId)} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="Open in side panel">
        <span className="transition-transform duration-300 [transition-timing-function:var(--ease-spring)] group-hover:-rotate-3 group-hover:scale-105">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-fg">{title}</span>
          <span className="text-[11.5px] text-fg-muted">
            {LABELS[kind] ?? kind}
            {size ? ` · ${size}` : ""}
            {result.pages ? ` · ${result.pages} pages` : ""}
          </span>
        </span>
        <span className="flex translate-x-1 items-center gap-1 text-[12px] text-accent opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
          Open <ArrowUpRight size={13} />
        </span>
      </button>
      {result.url && (
        <a href={result.url} download={result.filename} className="rounded-md border border-transparent p-2 text-fg-muted transition-colors hover:border-border hover:bg-bg-surface-200 hover:text-fg" title="Download" aria-label={`Download ${result.filename ?? title}`}>
          <Download size={15} />
        </a>
      )}
    </div>
  );
}
