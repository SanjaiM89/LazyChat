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
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-bg-elevated/40 animate-fade-in"
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
          "transition-colors hover:bg-accent/40",
          resizing && "bg-accent/60",
        )}
      />
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <MessagesSquare size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14px] font-semibold text-fg">Subchat</h2>
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
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <MessagesSquare size={20} className="text-fg-muted" />
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
          <div className="mt-2 rounded-xl border border-danger/30 bg-danger-soft/60 px-3 py-2 text-[12.5px] text-danger">
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
        <div className="rounded-2xl border border-border-strong bg-bg-elevated focus-within:border-accent/50">
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
            className="w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-[13.5px] leading-relaxed text-fg placeholder:text-fg-muted/70 focus:outline-none"
          />
          <div className="flex items-center justify-end px-2 pb-2">
            {subchat.busy ? (
              <button
                onClick={() => void subchat.stop()}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white transition-transform hover:scale-105 active:scale-95"
                title="Stop generating"
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!text.trim()}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white",
                  "transition-all hover:scale-105 hover:bg-accent-strong active:scale-95 disabled:opacity-40 disabled:pointer-events-none",
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
    <Tooltip text="Open subchat (shares context with this chat)">
      <button
        onClick={() => setSubchatOpen(true)}
        title="Open subchat"
        className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-bg-elevated text-fg-secondary shadow-soft transition-all hover:scale-105 hover:border-accent/50 hover:text-accent"
      >
        <MessagesSquare size={16} />
      </button>
    </Tooltip>
  );
}
