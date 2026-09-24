"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  Loader2,
} from "lucide-react";
import { cn, IconButton, Tooltip } from "@/components/ui";

/* ------------------------------------------------------------------ */
/*  PDF viewer built on pdfjs-dist (worker bundled via ?url)           */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @next/next/no-assign-module-variable
let pdfjs: typeof import("pdfjs-dist") | null = null;

async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  const mod = await import("pdfjs-dist");
  const workerUrl = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  mod.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfjs = mod;
  return pdfjs;
}

export function PdfViewer({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [rendered, setRendered] = useState<Record<number, boolean>>({});
  const renderQ = useRef<number>(0);

  // Load the document once.
  useEffect(() => {
    let cancelled = false;
    let docRef: any = null;
    (async () => {
      try {
        const lib = await loadPdfjs();
        const buf = await (await fetch(url)).arrayBuffer();
        const d = await lib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        docRef = d;
        setDoc(d);
        setPages(Array.from({ length: d.numPages }, (_, i) => i + 1));
        setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to load PDF");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      try {
        docRef?.destroy();
      } catch {
        /* ignore */
      }
    };
  }, [url]);

  // Render a page into its canvas (queued so fast scrolls don't thrash).
  const renderPage = useCallback(
    async (num: number, scale: number) => {
      if (!doc) return;
      const canvas = containerRef.current?.querySelector(
        `canvas[data-page="${num}"]`,
      ) as HTMLCanvasElement | null;
      if (!canvas) return;
      const task = ++renderQ.current;
      const pageObj = await doc.getPage(num);
      const viewport = pageObj.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await pageObj.render({ canvasContext: ctx, viewport }).promise;
      if (task === renderQ.current) {
        setRendered((r) => ({ ...r, [num]: true }));
      }
    },
    [doc],
  );

  // Re-render all pages when zoom changes; render missing pages on mount.
  useEffect(() => {
    if (!doc) return;
    pages.forEach((p) => void renderPage(p, zoom));
  }, [doc, zoom, pages, renderPage]);

  const total = doc?.numPages ?? 0;

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-[12px] text-fg-muted">
          {total > 0 ? `Page ${page} of ${total}` : "PDF"}
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip text="Previous page">
            <IconButton
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft size={15} />
            </IconButton>
          </Tooltip>
          <Tooltip text="Next page">
            <IconButton
              disabled={page >= total}
              onClick={() => setPage((p) => Math.min(total, p + 1))}
            >
              <ChevronRight size={15} />
            </IconButton>
          </Tooltip>
          <div className="mx-1 h-4 w-px bg-border" />
          <Tooltip text="Zoom out">
            <IconButton onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}>
              <ZoomOut size={15} />
            </IconButton>
          </Tooltip>
          <span className="min-w-[44px] text-center text-[12px] text-fg-muted">
            {Math.round(zoom * 100)}%
          </span>
          <Tooltip text="Zoom in">
            <IconButton onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}>
              <ZoomIn size={15} />
            </IconButton>
          </Tooltip>
          <Tooltip text="Fit width">
            <IconButton onClick={() => setZoom(1.0)}>
              <Maximize size={15} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {/* pages */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-bg-subtle/50 p-4"
        onScroll={(e) => {
          // track current page from scroll position
          const el = e.currentTarget;
          const canvases = Array.from(el.querySelectorAll("canvas")) as HTMLCanvasElement[];
          let cur = 1;
          for (let i = 0; i < canvases.length; i++) {
            if (canvases[i].getBoundingClientRect().top < el.getBoundingClientRect().top + 80) {
              cur = i + 1;
            } else break;
          }
          setPage(cur);
        }}
      >
        {loading && (
          <div className="flex h-40 items-center justify-center gap-2 text-[13px] text-fg-muted">
            <Loader2 size={16} className="animate-spin text-accent" />
            Loading PDF…
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft/60 px-4 py-3 text-[13px] text-danger">
            {error}
          </div>
        )}
        <div
          className={cn(
            "mx-auto flex w-fit flex-col gap-4",
            (loading || error) && "hidden",
          )}
        >
          {pages.map((num) => (
            <div
              key={num}
              className="overflow-hidden rounded-lg border border-border bg-white shadow-soft"
            >
              <canvas data-page={num} className="block max-w-full" style={{ width: "auto" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
