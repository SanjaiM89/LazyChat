"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { GenUiCard } from "@/components/genui/GenUiCard";
import { setGenUiMessageHandler } from "@/lib/genui/bus";
import { GENUI_EXAMPLE } from "@/lib/genui/prompt";
import { parsePartialJson } from "ai";

/** Dev-only harness: streams the prompt's example UI into the real GenUiCard (no model, no login needed). */
export default function GenUiDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const [ui, setUi] = useState<unknown>(undefined);
  const [streaming, setStreaming] = useState(true);
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    setGenUiMessageHandler((t) => setMessages((m) => [...m, t]));
    return () => setGenUiMessageHandler(null);
  }, []);

  useEffect(() => {
    const text = JSON.stringify(GENUI_EXAMPLE);
    let n = 0;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      n = Math.min(text.length, n + 37);
      const { value } = await parsePartialJson(text.slice(0, n));
      setUi(value);
      if (n >= text.length) {
        setStreaming(false);
        return;
      }
      setTimeout(tick, 40);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 animate-fade-in-up">
      <div>
        <p className="eyebrow">Developer</p>
        <h1 className="text-[18px] font-medium tracking-tight text-fg">GenUI harness</h1>
      </div>
      <GenUiCard args={{ title: "Sales overview", ui }} result={streaming ? undefined : { ok: true }} streaming={streaming} />
      <pre data-testid="messages" className="rounded-md border border-border bg-bg-surface-100 p-3 font-mono text-xs text-fg-muted">{JSON.stringify(messages)}</pre>
    </main>
  );
}
