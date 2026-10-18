"use client";

import * as React from "react";
import { ChevronDown, Brain } from "lucide-react";
import { cn } from "@/components/ui";


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
          "group inline-flex items-center gap-2 rounded-full border border-border bg-bg-surface-100 py-1 pl-2 pr-2.5 text-[12px] transition-colors",
          text
            ? "text-fg-muted hover:border-border-strong hover:text-fg-secondary"
            : "text-fg-muted cursor-default",
        )}
        disabled={!text}
        title={text ? (open ? "Hide reasoning" : "Show reasoning") : undefined}
      >
        <Brain
          size={13}
          className={cn("shrink-0", streaming ? "text-accent animate-pulse" : "text-accent/70")}
        />
        <span className={cn("flex items-center gap-1 font-medium", streaming && "text-shine")}>
          {streaming ? "Thinking" : "Thought"}
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
        {text && !streaming && <ChevronDown size={12} className={cn("transition-transform duration-300", open && "rotate-180")} />}
      </button>

      {streaming && <div className="thinking-bar ml-3 mt-1.5 w-32" />}

      {showText && (
        <div className="mt-2 rounded-lg border border-border border-l-2 border-l-brand/60 bg-bg-surface-100 px-3.5 py-2.5 text-[13px] leading-relaxed text-fg-secondary animate-fade-in-up">
          <p className="whitespace-pre-wrap">{text}</p>
        </div>
      )}
    </div>
  );
}
