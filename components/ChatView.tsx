"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  MessagesSquare,
  Copy,
  LoaderCircle,
  ArrowUpRight,
  RotateCw,
} from "lucide-react";
import type { ChatController } from "@/lib/use-chat";
import { MessageItem } from "@/components/MessageItem";
import { SubchatOpenerButton } from "@/components/SubchatPanel";
import { useAppStore, activeRunFor } from "@/lib/app-store";
import { RunningStatus } from "@/components/dsh/RunningStatus";
import { DEFAULT_DISPLAY } from "@/lib/display";
import { SpotlightCard } from "@/components/ui";
import { OmniaMark } from "@/components/brand/OmniaLogo";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { FileIcon } from "@/components/brand/FileIcon";


const SUGGESTIONS = [
  {
    icon: <BrandIcon name="chrome" size={18} />,
    tag: "Research",
    title: "Research a topic",
    prompt:
      "Run deep research on a topic of your choice with the runAgentTask sandbox agent — enable its research mode (research: true, live Chromium browser). Have the agent search the web, actually open and read at least 3 real pages, cross-check facts across sources, then save a detailed briefing with a Sources section to /workspace/out/briefing.md. Then give me a concise summary of the key findings and link the briefing file.",
  },
  {
    icon: <FileIcon type="xlsx" size={20} />,
    tag: "Documents",
    title: "Generate a spreadsheet",
    prompt:
      "Create an XLSX spreadsheet in a Docker sandbox with a sample sales dataset (20 rows, 5 columns: region, product, units, price, revenue) plus a summary sheet with totals.",
  },
  {
    icon: <BrandIcon name="html" size={18} />,
    tag: "Artifacts",
    title: "Build something",
    prompt:
      "Create a code artifact: a small interactive HTML page that visualizes the Fibonacci sequence with an animated bar chart.",
  },
  {
    icon: <BrandIcon name="docker" size={18} />,
    tag: "Agents",
    title: "Plan with an agent",
    prompt:
      "Deploy an agent in a Docker sandbox to write a markdown project plan for launching a SaaS product, and save the plan to /workspace/out as a .md file.",
  },
];

export function ChatView({ chat }: { chat: ChatController }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string>("");
  const stickToBottomRef = useRef(true);

  const messages = chat.messages;
  const streaming =
    chat.status === "submitted" || chat.status === "streaming";
  // The running clock needs the turn's start, which lives in the run record
  // rather than the chat status (the status only says a run is in flight).
  const runStartedAt = useAppStore(
    (s) => activeRunFor(s.runs, s.activeConversationId ?? "")?.startedAt,
  );
  const contentWidth = useAppStore((s) => s.display?.contentWidth) ?? DEFAULT_DISPLAY.contentWidth;

  const [menu, setMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const subchatOpen = useAppStore((s) => s.subchatOpen);
  const setSubchatOpen = useAppStore((s) => s.setSubchatOpen);
  const setSubchatSeed = useAppStore((s) => s.setSubchatSeed);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickToBottomRef.current = nearBottom;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const last = messages[messages.length - 1];
    if (!last) return;
    if (last.id !== lastIdRef.current) {
      lastIdRef.current = last.id;
      stickToBottomRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else if (streaming && stickToBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    }
  }, [messages, streaming]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);

  if (messages.length === 0) {
    if (chat.loadingConversation) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-fg-muted animate-fade-in" role="status" aria-live="polite">
          <div className="relative">
            <OmniaMark size={36} animated />
            <LoaderCircle size={56} strokeWidth={1} className="absolute -inset-[10px] animate-spin text-brand/50" />
          </div>
          <p className="text-shine text-[13px]">Loading conversation…</p>
        </div>
      );
    }

    if (chat.conversationLoadError) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center animate-fade-in-up">
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">
            {chat.conversationLoadError}
          </div>
          <button
            onClick={chat.reloadConversation}
            className="group inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-bg-control px-3 py-1.5 text-[12px] text-fg-secondary transition-colors hover:bg-bg-surface-300 hover:text-fg"
          >
            <RotateCw size={12} className="transition-transform duration-500 group-hover:rotate-180" />
            Try again
          </button>
        </div>
      );
    }

    return (
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-10">
        <div className="hero-backdrop" aria-hidden>
          <div className="hero-grid" />
          <div className="hero-aurora" />
          <span className="hero-beam" style={{ top: "18%", animationDelay: "0.5s" }} />
          <span className="hero-beam" style={{ top: "54%", animationDelay: "3.8s", animationDuration: "9s" }} />
          <span className="hero-beam-v" style={{ left: "22%", animationDelay: "1.6s" }} />
          <span className="hero-beam-v" style={{ left: "76%", animationDelay: "5.2s", animationDuration: "11s" }} />
        </div>
        <SubchatOpenerButton />
        <div className="relative z-10 flex w-full flex-col items-center stagger [--stagger:80ms]">
          <OmniaMark size={56} animated className="mb-6" />
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-bg-surface-100/80 px-3 py-1 text-[11.5px] text-fg-secondary backdrop-blur">
            <span className="live-dot !h-1.5 !w-1.5" />
            Multi-provider · Agents · Artifacts · Company Brain
          </div>
          <h1 className="text-center text-[32px] font-medium leading-tight tracking-[-0.02em] text-fg sm:text-[40px]">
            Build anything with <span className="text-brand-gradient">Omnia</span>
          </h1>
          <p className="mt-3 max-w-lg text-center text-[14px] leading-relaxed text-fg-muted">
            Chat with any model, search the web, create artifacts and deploy
            autonomous agents in Docker sandboxes — or ask the Company Brain
            about your engineering org.
          </p>
          <div className="mt-6 flex items-center gap-4 text-fg-muted">
            {(["claude", "openai", "gemini", "deepseek", "qwen", "mistral", "ollama"] as const).map((k, i) => (
              <span
                key={k}
                className="opacity-60 grayscale transition-all duration-300 hover:scale-110 hover:opacity-100 hover:grayscale-0"
                style={{ animation: `fade-in-up 0.5s var(--ease-out) ${0.45 + i * 0.05}s backwards` }}
              >
                <BrandIcon name={k} size={18} />
              </span>
            ))}
          </div>
          <div className="mt-9 grid w-full max-w-3xl gap-3 sm:grid-cols-2 stagger [--stagger:70ms]">
            {SUGGESTIONS.map((s) => (
              <SpotlightCard
                as="button"
                key={s.title}
                onClick={() => chat.send(s.prompt)}
                className="lift group flex flex-col gap-2.5 rounded-lg border border-border bg-bg-surface-100 p-4 text-left hover:border-border-strong"
              >
                <span className="flex w-full items-center gap-2.5">
                  <span className="brand-tile brand-tile-glow flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-surface-200">
                    {s.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="eyebrow block !text-[10px]">{s.tag}</span>
                    <span className="block text-[13.5px] font-medium text-fg">{s.title}</span>
                  </span>
                  <ArrowUpRight
                    size={15}
                    className="text-fg-faint transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent"
                  />
                </span>
                <span className="line-clamp-2 text-[12.5px] leading-relaxed text-fg-muted">
                  {s.prompt}
                </span>
              </SpotlightCard>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || sel?.isCollapsed) {
      setMenu(null);
      return;
    }
    e.preventDefault();
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 80),
      text: text.slice(0, 2000),
    });
  };

  const openInSubchat = () => {
    if (!menu) return;
    if (!subchatOpen) setSubchatOpen(true);
    setSubchatSeed(menu.text);
    setMenu(null);
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onContextMenu={handleContextMenu}
      className="relative flex-1 overflow-y-auto"
    >
      <SubchatOpenerButton />
      {menu && (
        <div
          className="fixed z-[90] min-w-[200px] rounded-lg border border-border-strong bg-bg-overlay p-1 shadow-pop animate-scale-in"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={openInSubchat}
            disabled={subchatOpen}
            title={subchatOpen ? "Only one subchat can be open at a time" : "Discuss this text in the side subchat"}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-fg transition-colors hover:bg-bg-hover disabled:opacity-45 disabled:pointer-events-none"
          >
            <MessagesSquare size={14} className="text-accent" />
            {subchatOpen ? "Subchat already open" : "Open in subchat"}
          </button>
          <button
            onClick={() => {
              if (menu) void navigator.clipboard.writeText(menu.text).catch(() => {});
              setMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-fg transition-colors hover:bg-bg-hover"
          >
            <Copy size={14} className="text-fg-muted" />
            Copy text
          </button>
          <p className="max-w-[260px] truncate px-3 pb-1.5 pt-0.5 text-[11px] text-fg-muted">
            “{menu.text}”
          </p>
        </div>
      )}
      <div className="mx-auto w-full px-4 pb-4 pt-2" style={{ maxWidth: contentWidth }}>
        {messages.map((m, i) => (
          <MessageItem
            key={m.id}
            message={m}
            isLast={i === messages.length - 1}
            streaming={streaming}
          />
        ))}
        {chat.status === "error" && chat.error && (
          <div className="mx-auto mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger animate-fade-in-up" style={{ maxWidth: contentWidth }}>
            <span className="font-medium">Something went wrong:</span>{" "}
            {chat.error.message || "Unknown error"}
            <button
              onClick={() => chat.clearError()}
              className="ml-2 text-danger/80 underline underline-offset-2 hover:text-danger"
            >
              Dismiss
            </button>
          </div>
        )}
        {streaming && <RunningStatus startTime={runStartedAt} />}
      </div>
      <div className="h-8" />
    </div>
  );
}
