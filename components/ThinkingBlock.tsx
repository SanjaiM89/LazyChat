"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Brain } from "lucide-react";
import { cn } from "@/components/ui";

/* ------------------------------------------------------------------ */
/*  Compact "thinking" row for reasoning parts.                        */
/*  - While the model is actively reasoning it shows an animated       */
/*    "Thinking" label + bar.                                          */
/*  - Once reasoning ends it collapses to a small "Thinking · Ns" row  */
/*    so it never stays expanded dominating the message while the      */
/*    model searches / creates artifacts / writes the answer.          */
/*  - Click the row to read (or hide) the reasoning text.              */
/* ------------------------------------------------------------------ */

export function ThinkingBlock({
  text,
  streaming,
  compact = false,
}: {
  text?: string;
  streaming: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!streaming) return;
    const start = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - start) / 1000), 500);
    return () => clearInterval(t);
  }, [streaming]);

  if (compact && !text) return null;

  const showText = open && !!text;

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "group flex items-center gap-2 text-[12.5px] transition-colors",
          text
            ? "text-fg-muted hover:text-fg-secondary"
            : "text-fg-muted cursor-default",
        )}
        disabled={!text}
        title={text ? (open ? "Hide reasoning" : "Show reasoning") : undefined}
      >
        <Brain
          size={13}
          className={cn("shrink-0", streaming ? "text-accent animate-pulse" : "text-accent/70")}
        />
        <span className="flex items-center gap-1 font-medium">
          Thinking
          {streaming && (
            <>
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span className="thinking-dot" />
            </>
          )}
        </span>
        {!streaming && text && (
          <span className="text-[11px] text-fg-muted/80">
            {Math.max(1, Math.round(elapsed))}s
          </span>
        )}
        {text && !streaming && (open ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </button>

      {streaming && <div className="thinking-bar mt-1 w-32" />}

      {showText && (
        <div className="mt-1.5 rounded-lg border border-border bg-bg-subtle/60 px-3 py-2 text-[13px] leading-relaxed text-fg-secondary">
          <p className="whitespace-pre-wrap">{text}</p>
        </div>
      )}
    </div>
  );
}
