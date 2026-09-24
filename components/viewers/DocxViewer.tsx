"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Loader2, FileWarning } from "lucide-react";


export function DocxViewer({ url }: { url: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ renderAsync }] = await Promise.all([
          import("docx-preview"),
        ]);
        const buf = await (await fetch(url)).arrayBuffer();
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = "";
        await renderAsync(new Uint8Array(buf), hostRef.current, undefined, {
          className: "docx",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
        });
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to render DOCX");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="h-full overflow-auto bg-bg-subtle/60 p-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft/60 px-4 py-3 text-[13px] text-danger">
          <FileWarning size={15} />
          {error}
        </div>
      )}
      <div
        ref={hostRef}
        className="docx-host mx-auto max-w-[820px]"
        style={{ display: "flex", flexDirection: "column", gap: "12px" }}
      />
      {!error && <div className="flex justify-center py-8 text-[13px] text-fg-muted"><Loader2 className="animate-spin mr-2 text-accent" size={14} /> Rendering document…</div>}
    </div>
  );
}
