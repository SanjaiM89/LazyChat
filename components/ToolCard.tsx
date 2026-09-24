"use client";

import * as React from "react";
import {
  FileText,
  SquareTerminal,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Boxes,
  ArrowUpRight,
  Loader2,
  Download,
  FileImage,
  FileSpreadsheet,
  Presentation,
  FileCode2,
  File,
} from "lucide-react";
import { Badge } from "@/components/ui";
import { useAppStore } from "@/lib/app-store";

/* ------------------------------------------------------------------ */
/*  Tool invocation cards — one per tool the model called              */
/* ------------------------------------------------------------------ */

export function ToolCard({
  toolName,
  args,
  result,
  streaming,
  open,
  errorText,
  citationBase = 0,
  selectedCitation,
  onSelectCitation,
}: {
  toolName: string;
  args?: Record<string, any>;
  result?: any;
  streaming: boolean;
  open?: boolean;
  errorText?: string;
  citationBase?: number;
  selectedCitation?: number | null;
  onSelectCitation?: (n: number) => void;
}) {
  if (toolName === "webSearch") {
    return (
      <SearchCardWrapper
        args={args}
        result={result}
        streaming={streaming}
        citationBase={citationBase}
        selectedCitation={selectedCitation}
        onSelectCitation={onSelectCitation}
      />
    );
  }
  if (toolName === "createArtifact") {
    return <ArtifactCard args={args} result={result} streaming={streaming} />;
  }
  if (toolName === "runAgentTask") {
    return (
      <AgentTaskCard
        args={args}
        result={result}
        streaming={streaming}
        errorText={errorText}
      />
    );
  }
  return (
    <MCPToolCard
      toolName={toolName}
      args={args}
      result={result}
      streaming={streaming}
      errorText={errorText}
    />
  );
}

function SearchCardWrapper({
  args,
  result,
  streaming,
  citationBase = 0,
  selectedCitation,
  onSelectCitation,
}: {
  args?: Record<string, any>;
  result?: any;
  streaming: boolean;
  citationBase?: number;
  selectedCitation?: number | null;
  onSelectCitation?: (n: number) => void;
}) {
  // lazy import to avoid a big synchronous chunk up-front
  const { SearchCard } = require("@/components/SearchCard");
  return (
    <SearchCard
      query={args?.query}
      results={result?.results}
      streaming={streaming}
      baseIndex={citationBase}
      selected={selectedCitation}
      onSelect={onSelectCitation}
    />
  );
}

function ArtifactCard({
  args,
  result,
  streaming,
}: {
  args?: Record<string, any>;
  result?: any;
  streaming: boolean;
}) {
  const openArtifact = useAppStore((s) => s.openArtifact);

  if (streaming) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-bg-elevated px-4 py-3 mb-2 animate-fade-in-up">
        <Sparkles size={15} className="text-accent animate-pulse" />
        <span className="text-[13px] text-fg-secondary font-medium">
          Creating artifact…
        </span>
      </div>
    );
  }

  const artifactId = result?.artifactId;
  const title = result?.title || args?.title || "Artifact";
  const type = result?.type || args?.type || "text";

  return (
    <button
      onClick={() => artifactId && openArtifact(artifactId)}
      className="group flex items-center gap-3 rounded-xl border border-border bg-bg-elevated px-4 py-3 mb-2 w-full text-left hover:border-accent/40 hover:bg-bg-hover transition-all animate-fade-in-up"
    >
      <span className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
        <FileText size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-fg truncate">{title}</span>
        <span className="text-[12px] text-fg-muted capitalize">{type} artifact</span>
      </span>
      <span className="flex items-center gap-1.5 text-[12px] text-accent opacity-0 group-hover:opacity-100 transition-opacity">
        Open <ArrowUpRight size={13} />
      </span>
    </button>
  );
}

function AgentTaskCard({
  args,
  result,
  streaming,
  errorText,
}: {
  args?: Record<string, any>;
  result?: any;
  streaming: boolean;
  errorText?: string;
}) {
  const setPanel = useAppStore((s) => s.setPanel);
  const [expanded, setExpanded] = React.useState(true);

  const status = result?.status || (streaming ? "running" : "queued");
  const progress = result?.progress ?? (streaming ? undefined : 0);
  const files = result?.files || [];
  const summary = result?.summary;

  return (
    <div className="rounded-xl border border-border bg-bg-elevated mb-2 overflow-hidden animate-fade-in-up">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors"
      >
        <span className="w-8 h-8 rounded-lg bg-info-soft text-info flex items-center justify-center shrink-0">
          {streaming ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <SquareTerminal size={15} />
          )}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-[14px] font-medium text-fg truncate">
            {args?.task?.slice(0, 90) || "Agent task"}
          </span>
          <span className="text-[12px] text-fg-muted">
            Docker sandbox · {status}
            {status === "done" && files.length > 0 ? ` · ${files.length} file(s)` : ""}
          </span>
        </span>
        {expanded ? <ChevronUp size={15} className="text-fg-muted" /> : <ChevronDown size={15} className="text-fg-muted" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {errorText && (
            <p className="text-[12.5px] text-danger bg-danger-soft/50 border border-danger/20 rounded-lg px-2.5 py-2">
              {errorText}
            </p>
          )}
          {typeof progress === "number" && progress < 100 && (
            <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
              <div
                className="h-full bg-info rounded-full transition-all"
                style={{ width: `${Math.max(2, progress)}%` }}
              />
            </div>
          )}
          {summary && (
            <p className="text-[12.5px] text-fg-secondary leading-relaxed whitespace-pre-wrap">
              {summary}
            </p>
          )}
          {files.length > 0 && (
            <div className="border-t border-border/70 pt-2 mt-1">
              <p className="text-[11px] uppercase tracking-wide text-fg-muted/80 font-semibold mb-1.5">
                Produced files
              </p>
              <div className="space-y-1.5">
                {files.map((f: any, i: number) => {
                  const Icon = fileTypeIcon(f.type || f.name);
                  return (
                    <div
                      key={i}
                      className="group flex items-center gap-3 rounded-xl border border-border bg-bg-subtle/50 px-3 py-2 hover:border-accent/40 hover:bg-bg-hover transition-colors"
                    >
                      <span className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-fg truncate">
                          {f.name || f.filename}
                        </span>
                        <span className="text-[11px] text-fg-muted">
                          {fileTypeLabel(f.type || f.name)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[12px] text-fg-secondary hover:text-accent hover:border-accent/40 transition-colors"
                          title="Open file"
                        >
                          <ArrowUpRight size={12} />
                          Open
                        </a>
                        <a
                          href={f.url}
                          download
                          className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-lg border border-border text-fg-muted hover:text-accent hover:border-accent/40 transition-colors"
                          title="Download"
                        >
                          <Download size={12} />
                        </a>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {status === "done" && files.length === 0 && (
            <p className="text-[12px] text-warning">
              The agent finished but produced no files in /workspace/out.
            </p>
          )}
          <button
            onClick={() => setPanel("agents")}
            className="text-[12px] text-info hover:underline underline-offset-2 inline-flex items-center gap-1"
          >
            View live run in Agents <ArrowUpRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Pick a lucide icon + human label from an artifact type or filename. */
function fileTypeIcon(typeOrName: string) {
  const t = String(typeOrName || "").toLowerCase();
  if (t.includes("image") || /\.(png|jpe?g|gif|webp)$/.test(t)) return FileImage;
  if (t.includes("xls") || /\.(xlsx?|csv)$/.test(t)) return FileSpreadsheet;
  if (t.includes("pptx") || /\.ppt$/.test(t)) return Presentation;
  if (t.includes("code") || /\.(js|ts|tsx|jsx|py|json|css|html?|svg|xml)$/.test(t)) return FileCode2;
  if (t.includes("pdf") || t.includes("doc") || /\.(pdf|docx?|md|txt)$/.test(t)) return FileText;
  return File;
}

function fileTypeLabel(typeOrName: string) {
  const t = String(typeOrName || "").toLowerCase();
  if (t.includes("pdf")) return "PDF document";
  if (t.includes("xls")) return "Spreadsheet";
  if (t.includes("csv")) return "CSV data";
  if (t.includes("doc")) return "Word document";
  if (t.includes("image") || /\.(png|jpe?g|gif|webp)$/.test(t)) return "Image";
  if (t.includes("code") || /\.(py|js|ts|json|tsx|jsx)$/.test(t)) return "Code file";
  if (t.includes("markdown") || /\.md$/.test(t)) return "Markdown";
  return "File";
}

function MCPToolCard({
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
  const [expanded, setExpanded] = React.useState(false);
  const isMCP = toolName.includes("__") || true;
  void isMCP;

  const label = toolName.split("__").pop() || toolName;
  const resultText =
    errorText ??
    (typeof result === "string"
      ? result
      : result && typeof result === "object"
        ? JSON.stringify(result).slice(0, 400)
        : "");

  return (
    <div className="rounded-xl border border-border bg-bg-elevated px-4 py-3 mb-2 animate-fade-in-up">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 text-left"
      >
        {streaming ? (
          <Loader2 size={14} className="text-accent animate-spin" />
        ) : (
          <span className="w-5 h-5 rounded bg-info-soft text-info flex items-center justify-center shrink-0">
            <Boxes size={11} />
          </span>
        )}
        <span className="text-[13px] font-medium text-fg">{label}</span>
        <Badge tone="info" className="ml-1">MCP</Badge>
        {args && Object.keys(args).length > 0 && (
          <span className="ml-auto text-[11px] text-fg-muted truncate max-w-[40%]">
            {JSON.stringify(args).slice(0, 80)}
          </span>
        )}
      </button>
      {resultText && expanded && (
        <pre className="mt-2 text-[11.5px] text-fg-secondary whitespace-pre-wrap bg-bg-subtle rounded-lg p-2.5 max-h-48 overflow-y-auto">
          {resultText}
        </pre>
      )}
      {resultText && !expanded && (
        <button onClick={() => setExpanded(true)} className="mt-1 text-[11px] text-fg-muted hover:text-fg-secondary">
          Show result
        </button>
      )}
    </div>
  );
}
