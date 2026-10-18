"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { ArrowLeft, FileText, X } from "lucide-react";
import { cn, IconButton } from "@/components/ui";
import { useAppStore } from "@/lib/app-store";
import { ArtifactViewer, artifactUrl } from "@/components/viewers/ArtifactViewer";
import type { ArtifactMeta } from "@/lib/types";
import { FileIcon } from "@/components/brand/FileIcon";
import { BrandIcon, languageIconKey } from "@/components/brand/BrandIcon";

/** Language logo for code artifacts when we have one, else a format-colored file badge. */
function ArtifactIcon({ a }: { a: ArtifactMeta }) {
  const lang = a.type === "code" ? languageIconKey(a.language || a.filename) : undefined;
  if (lang) {
    return (
      <span className="brand-tile brand-tile-glow flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg-surface-200">
        <BrandIcon name={lang} size={18} />
      </span>
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center transition-transform duration-300 group-hover:-translate-y-0.5">
      <FileIcon type={a.filename || a.type} size={30} />
    </span>
  );
}


const TYPE_LABEL: Record<string, string> = {
  code: "Code",
  markdown: "Markdown",
  html: "HTML",
  svg: "SVG",
  text: "Text",
  pdf: "PDF",
  docx: "DOCX",
  xlsx: "Spreadsheet",
  csv: "CSV",
  image: "Image",
  mermaid: "Mermaid",
  table: "Table",
  audio: "Audio",
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ArtifactPanel() {
  const artifacts = useAppStore((s) => s.artifacts);
  const loadArtifacts = useAppStore((s) => s.loadArtifacts);
  const openArtifactId = useAppStore((s) => s.openArtifactId);
  const openArtifact = useAppStore((s) => s.openArtifact);
  const closeArtifact = useAppStore((s) => s.closeArtifact);
  const setPanel = useAppStore((s) => s.setPanel);
  const activeConversationId = useAppStore((s) => s.activeConversationId);

  useEffect(() => {
    loadArtifacts(activeConversationId ?? undefined);
  }, [loadArtifacts, activeConversationId]);

  const open = artifacts.find((a) => a.id === openArtifactId) ?? null;

  const [resolved, setResolved] = useState<ArtifactMeta | null>(null);
  useEffect(() => {
    if (!openArtifactId) return;
    if (artifacts.some((a) => a.id === openArtifactId)) return;
    let cancelled = false;
    fetch(`/api/artifacts?id=${encodeURIComponent(openArtifactId)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((meta: ArtifactMeta | null) => {
        if (!cancelled && meta?.id) setResolved(meta);
      })
      .catch(() => {
      });
    return () => {
      cancelled = true;
    };
  }, [openArtifactId, artifacts]);

  const activeArtifact =
    open ??
    (resolved && openArtifactId && resolved.id === openArtifactId ? resolved : null);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        {activeArtifact ? (
          <IconButton onClick={closeArtifact} title="Back to artifacts">
            <ArrowLeft size={16} />
          </IconButton>
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-bg-surface-200 text-accent">
            <FileText size={14} />
          </span>
        )}
        <h2 key={activeArtifact?.id ?? "list"} className="flex-1 truncate text-[13.5px] font-medium text-fg animate-fade-in">
          {activeArtifact ? activeArtifact.title : "Artifacts"}
        </h2>
        <IconButton onClick={() => setPanel(null)} title="Close panel">
          <X size={16} />
        </IconButton>
      </div>

      {activeArtifact ? (
        <div className="min-h-0 flex-1 animate-fade-in">
          <ArtifactViewer artifact={activeArtifact} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2.5">
          {artifacts.length === 0 && (
            <div className="mx-1 mt-4 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-fg-muted animate-fade-in-up">
              <span className="flex items-end gap-1.5">
                <FileIcon type="pdf" size={26} className="-rotate-6" />
                <FileIcon type="xlsx" size={30} />
                <FileIcon type="docx" size={26} className="rotate-6" />
              </span>
              No artifacts yet. Ask the model to create a document, a
              spreadsheet or a diagram — it will show up here.
            </div>
          )}
          <div className="space-y-0.5 stagger [--stagger:30ms]">
            {artifacts.map((a) => (
              <button
                key={a.id}
                onClick={() => openArtifact(a.id)}
                className="group flex w-full items-center gap-3 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-bg-surface-100"
              >
                <ArtifactIcon a={a} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-fg">
                    {a.title}
                  </span>
                  <span className="block font-mono text-[10.5px] text-fg-muted">
                    {TYPE_LABEL[a.type] || a.type} · {timeAgo(a.createdAt)}
                    {a.size ? ` · ${fmtSize(a.size)}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
