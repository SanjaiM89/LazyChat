"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Loader2, FileWarning } from "lucide-react";


export function XlsxViewer({ url }: { url: string }) {
  const [sheets, setSheets] = useState<
    { name: string; html: string }[] | null
  >(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const XLSX = await import("xlsx");
        const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
        const wb = XLSX.read(buf, { type: "array" });
        if (cancelled) return;
        const rendered = wb.SheetNames.map((name: string) => ({
          name,
          html: XLSX.utils.sheet_to_html(wb.Sheets[name], {
            editable: false,
          }),
        }));
        setSheets(rendered);
        setActive(0);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to read spreadsheet");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft/60 px-4 py-3 text-[13px] text-danger m-4">
        <FileWarning size={15} />
        {error}
      </div>
    );
  }

  if (!sheets) {
    return (
      <div className="flex justify-center py-10 text-[13px] text-fg-muted">
        <Loader2 className="animate-spin mr-2 text-accent" size={14} /> Reading
        spreadsheet…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-2">
        {sheets.map((s, i) => (
          <button
            key={s.name}
            onClick={() => setActive(i)}
            className={
              "rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors " +
              (i === active
                ? "bg-accent-soft text-accent"
                : "text-fg-secondary hover:bg-bg-hover")
            }
          >
            {s.name}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-3">
        <div
          className="xlsx-table"
          dangerouslySetInnerHTML={{ __html: sheets[active].html }}
        />
      </div>
    </div>
  );
}
