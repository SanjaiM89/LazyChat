"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PrefabHost } from "@/lib/genui/host";
import type { Envelope } from "@/lib/genui/envelope";
import { useAppStore } from "@/lib/app-store";

/**
 * Renders a Prefab envelope with the official renderer inside a sandboxed iframe (opaque origin: it cannot touch
 * the app's cookies, storage or DOM) and bridges its actions back to the chat.
 */
export function PrefabView({
  envelope,
  onUserMessage,
  streaming = false,
  className,
}: {
  envelope: Envelope | null;
  onUserMessage?: (text: string) => void;
  streaming?: boolean;
  className?: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<PrefabHost | null>(null);
  const [height, setHeight] = useState(0);
  const [rendered, setRendered] = useState(false);
  const theme = useAppStore((s) => s.theme);
  const dark = useMemo(() => {
    if (theme === "dark") return true;
    if (theme === "light") return false;
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }, [theme]);

  const messageRef = useRef(onUserMessage);
  useEffect(() => {
    messageRef.current = onUserMessage;
  });

  // One host per iframe lifetime.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const host = new PrefabHost(
      (msg) => frame.contentWindow?.postMessage(msg, "*"),
      {
        onUserMessage: (t) => messageRef.current?.(t),
        onOpenLink: (url) => window.open(url, "_blank", "noopener,noreferrer"),
        onSize: (h) => setHeight(Math.min(h, 2400)),
        onReady: () => {},
      },
      dark ? "dark" : "light",
    );
    hostRef.current = host;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return; // only our own iframe
      host.handle(e.data);
    };
    window.addEventListener("message", onMessage);
    // Load the renderer only now: it sends `ui/initialize` once on startup, so the listener must already exist.
    frame.src = "/prefab/index.html";
    return () => {
      window.removeEventListener("message", onMessage);
      hostRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    hostRef.current?.setTheme(dark ? "dark" : "light");
  }, [dark]);

  // Push each distinct envelope; the renderer re-renders in place.
  const serialized = useMemo(() => (envelope ? JSON.stringify(envelope) : ""), [envelope]);
  useEffect(() => {
    if (!envelope || !hostRef.current) return;
    // Breathing room inside the frame: the renderer itself draws edge to edge.
    hostRef.current.sendEnvelope({ ...envelope, view: { type: "Div", cssClass: "p-4", children: [envelope.view] } });
    setRendered(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);

  return (
    <div className={className} data-genui-streaming={streaming || undefined}>
      <div className="relative overflow-hidden rounded-xl border border-border bg-bg-elevated">
        {!rendered && <GenUiSkeleton />}
        <iframe
          ref={frameRef}
          title="Generated interface"
          sandbox="allow-scripts allow-popups"
          className="block w-full border-0 bg-transparent"
          style={{ height: rendered ? Math.max(height, 48) : 0, colorScheme: dark ? "dark" : "light" }}
        />
      </div>
    </div>
  );
}

export function GenUiSkeleton() {
  return (
    <div className="space-y-2.5 p-4" aria-label="Building interface">
      <div className="h-4 w-1/3 animate-pulse rounded bg-bg-hover" />
      <div className="h-20 w-full animate-pulse rounded-lg bg-bg-hover" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-bg-hover" />
    </div>
  );
}
