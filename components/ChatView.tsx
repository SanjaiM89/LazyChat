"use client";

import * as React from "react";
import { useEffect, useRef } from "react";
import {
  Sparkles,
  FileSearch,
  FileSpreadsheet,
  Code2,
  BrainCircuit,
} from "lucide-react";
import type { ChatController } from "@/lib/use-chat";
import { MessageItem } from "@/components/MessageItem";
import { useAppStore } from "@/lib/app-store";
import { DEFAULT_DISPLAY } from "@/lib/display";

/* ------------------------------------------------------------------ */
/*  Scrollable message list + Claude-like empty state                  */
/* ------------------------------------------------------------------ */

const SUGGESTIONS = [
  {
    icon: <FileSearch size={17} />,
    title: "Research a topic",
    prompt:
      "Run deep research on a topic of your choice with the runAgentTask sandbox agent — enable its research mode (research: true, live Chromium browser). Have the agent search the web, actually open and read at least 3 real pages, cross-check facts across sources, then save a detailed briefing with a Sources section to /workspace/out/briefing.md. Then give me a concise summary of the key findings and link the briefing file.",
  },
  {
    icon: <FileSpreadsheet size={17} />,
    title: "Generate a spreadsheet",
    prompt:
      "Create an XLSX spreadsheet in a Docker sandbox with a sample sales dataset (20 rows, 5 columns: region, product, units, price, revenue) plus a summary sheet with totals.",
  },
  {
    icon: <Code2 size={17} />,
    title: "Build something",
    prompt:
      "Create a code artifact: a small interactive HTML page that visualizes the Fibonacci sequence with an animated bar chart.",
  },
  {
    icon: <BrainCircuit size={17} />,
    title: "Plan with an agent",
    prompt:
      "Deploy an agent in a Docker sandbox to write a markdown project plan for launching a SaaS product, and save the plan to /workspace/out as a .md file.",
  },
];

export function ChatView({ chat }: { chat: ChatController }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string>("");
  // Whether the user is pinned to the latest content. While true, new streamed
  // content auto-scrolls the view down; as soon as the user scrolls up to read,
  // we stop forcing and let them stay where they are.
  const stickToBottomRef = useRef(true);

  const messages = chat.messages;
  const streaming =
    chat.status === "submitted" || chat.status === "streaming";
  const contentWidth = useAppStore((s) => s.display?.contentWidth) ?? DEFAULT_DISPLAY.contentWidth;

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Within ~48px of the bottom counts as "at the bottom".
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickToBottomRef.current = nearBottom;
  };

  // Auto-scroll only while the user is still following the latest content.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const last = messages[messages.length - 1];
    if (!last) return;
    if (last.id !== lastIdRef.current) {
      // A brand-new message arrived (e.g. the user just sent one) — jump to it.
      lastIdRef.current = last.id;
      stickToBottomRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else if (streaming && stickToBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    }
  }, [messages, streaming]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-10">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-soft to-accent/20 text-accent mb-5 animate-fade-in-up">
          <Sparkles size={22} />
        </div>
        <h1 className="text-[26px] font-semibold text-fg tracking-tight text-center animate-fade-in-up">
          How can I help you today?
        </h1>
        <p className="mt-2 max-w-md text-center text-[13.5px] leading-relaxed text-fg-muted animate-fade-in-up">
          Chat with multiple providers, search the web, create artifacts, and
          deploy autonomous agents in Docker sandboxes.
        </p>
        <div className="mt-8 grid w-full max-w-3xl gap-2.5 sm:grid-cols-2 animate-fade-in-up">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.title}
              onClick={() => chat.send(s.prompt)}
              className="group flex flex-col gap-2 rounded-2xl border border-border bg-bg-elevated p-4 text-left transition-all hover:border-accent/40 hover:bg-bg-hover hover:shadow-soft"
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold text-fg-secondary group-hover:text-accent transition-colors">
                <span className="text-accent">{s.icon}</span>
                {s.title}
              </span>
              <span className="text-[12.5px] leading-relaxed text-fg-muted line-clamp-2">
                {s.prompt}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="chat-reading flex-1 overflow-y-auto">
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
          <div className="mx-auto mt-4 rounded-xl border border-danger/30 bg-danger-soft/60 px-4 py-3 text-[13px] text-danger" style={{ maxWidth: contentWidth }}>
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
      </div>
      {/* Spacer keeps the last message from hiding behind the composer */}
      <div className="h-8" />
    </div>
  );
}
