"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { X, ArrowUp, Square, MessagesSquare, Link2 } from "lucide-react";
import { cn, IconButton, Tooltip } from "@/components/ui";
import { useAppStore, modelLabel } from "@/lib/app-store";
import { MessageItem } from "@/components/MessageItem";
import type { SubchatController } from "@/lib/use-subchat";


export function SubchatPanel({ subchat }: { subchat: SubchatController }) {
  const setSubchatOpen = useAppStore((s) => s.setSubchatOpen);
  const seed = useAppStore((s) => s.subchatSeed);
  const setSeed = useAppStore((s) => s.setSubchatSeed);
  const settings = useAppStore((s) => s.settings);
  const width = useAppStore((s) => s.subchatWidth) ?? 400;
  const setWidth = useAppStore((s) => s.setSubchatWidth);
  const resetWidth = useAppStore((s) => s.resetSubchatWidth);

  const [text, setText] = useState("");
  const seededRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (seed && seededRef.current !== seed) {
      seededRef.current = seed;
      setText((prev) =>
        prev ? prev : `> ${seed.split("\n").join("\n> ")}\n\n`,
      );
      setSeed(null);
      textareaRef.current?.focus();
    }
  }, [seed, setSeed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [subchat.messages.length, subchat.status]);

  const send = () => {
    subchat.send(text);
    setText("");
  };

  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    if (!resizing) return;
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      setWidth(drag.current.startW + (drag.current.startX - e.clientX));
    };
    const up = () => {
      drag.current = null;
      setResizing(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizing, setWidth]);

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-bg-alternative animate-slide-in-right"
      style={{ width: `min(92vw, ${width}px)` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize subchat"
        title="Drag to resize (double-click to reset)"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { startX: e.clientX, startW: width };
          setResizing(true);
        }}
        onDoubleClick={resetWidth}
        className={cn(
          "absolute inset-y-0 left-0 z-10 w-2 -translate-x-1 cursor-col-resize touch-none",
          "transition-colors hover:bg-brand/40",
          resizing && "bg-brand/60",
        )}
      />
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-bg-surface-200 text-accent">
          <MessagesSquare size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13.5px] font-medium text-fg">Subchat</h2>
          <p className="flex items-center gap-1 text-[10.5px] text-fg-muted">
            <Link2 size={10} className="text-accent" />
            shared context · {modelLabel(settings.provider, settings.model)}
          </p>
        </div>
        <Tooltip text="Close subchat">
          <IconButton onClick={() => setSubchatOpen(false)} title="Close subchat">
            <X size={16} />
          </IconButton>
        </Tooltip>
      </div>

      <div ref={scrollRef} className="chat-reading min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {subchat.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center animate-fade-in-up">
            <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-bg-surface-200 animate-float">
              <MessagesSquare size={18} className="text-accent" />
            </span>
            <p className="text-[13px] font-medium text-fg-secondary">Ask about this chat</p>
            <p className="text-[12px] leading-relaxed text-fg-muted">
              This side chat sees the whole main conversation — and the main
              chat sees what you discuss here.
            </p>
          </div>
        ) : (
          subchat.messages.map((m, i) => (
            <MessageItem
              key={m.id}
              message={m}
              isLast={i === subchat.messages.length - 1}
              streaming={subchat.busy}
            />
          ))
        )}
        {subchat.error && (
          <div className="mt-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[12.5px] text-danger animate-fade-in-up">
            {subchat.error.message || "Unknown error"}
            <button
              onClick={() => subchat.clearError()}
              className="ml-2 underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-2.5">
        <div className={cn("rounded-lg border border-border-strong bg-bg-surface-100 transition-[border-color,box-shadow] duration-300 focus-within:border-brand/50 focus-within:shadow-[0_0_0_3px_var(--accent-soft)]", subchat.busy && "beam-border")}>
          <textarea
            ref={textareaRef}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about the main chat…"
            className="w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-[13.5px] leading-relaxed text-fg placeholder:text-fg-faint focus:outline-none"
          />
          <div className="flex items-center justify-end px-2 pb-2">
            {subchat.busy ? (
              <button
                onClick={() => void subchat.stop()}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border-strong bg-bg-control text-fg transition-all hover:border-danger/40 hover:bg-danger-soft hover:text-danger active:scale-95"
                title="Stop generating"
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!text.trim()}
                className={cn(
                  "btn-sheen flex h-7 w-7 items-center justify-center rounded-md border border-[color:var(--brand-button-border)] bg-[color:var(--brand-button)] text-[color:var(--brand-button-text)]",
                  "transition-all hover:brightness-110 active:scale-95 disabled:opacity-35 disabled:grayscale disabled:pointer-events-none",
                )}
                title="Send in subchat"
              >
                <ArrowUp size={15} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}


export function SubchatOpenerButton() {
  const subchatOpen = useAppStore((s) => s.subchatOpen);
  const setSubchatOpen = useAppStore((s) => s.setSubchatOpen);
  if (subchatOpen) return null;
  return (
    <div className="absolute right-3 top-3 z-20">
    <Tooltip text="Open subchat (shares context with this chat)">
      <button
        onClick={() => setSubchatOpen(true)}
        title="Open subchat"
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-surface-100 text-fg-secondary shadow-soft transition-all hover:-translate-y-0.5 hover:border-brand/50 hover:text-accent"
      >
        <MessagesSquare size={16} />
      </button>
    </Tooltip>
    </div>
  );
}
