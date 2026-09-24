"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  Monitor,
  X,
  Terminal,
  Power,
  FileText,
  Download,
  AlertTriangle,
} from "lucide-react";
import { cn, Button, IconButton, Badge } from "@/components/ui";
import { useAppStore } from "@/lib/app-store";
import type { SandboxMeta } from "@/lib/types";


export function SandboxPanel() {
  const sandboxStatus = useAppStore((s) => s.sandboxStatus);
  const setSandboxStatus = useAppStore((s) => s.setSandboxStatus);
  const sandboxes = useAppStore((s) => s.sandboxes);
  const activeSandboxId = useAppStore((s) => s.activeSandboxId);
  const setActiveSandbox = useAppStore((s) => s.setActiveSandbox);
  const setPanel = useAppStore((s) => s.setPanel);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/sandbox", { cache: "no-store" });
        const data = await res.json();
        setSandboxStatus(data?.ok ? "ok" : "down");
      } catch {
        setSandboxStatus("down");
      }
    })();
  }, [setSandboxStatus]);

  const active = sandboxes.find((s) => s.id === activeSandboxId) ?? sandboxes[0] ?? null;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-info-soft text-info">
          <Monitor size={14} />
        </span>
        <h2 className="text-[14px] font-semibold text-fg flex-1">Sandbox</h2>
        <Badge tone={sandboxStatus === "ok" ? "success" : sandboxStatus === "unknown" ? "neutral" : "danger"}>
          {sandboxStatus === "ok" ? "online" : sandboxStatus === "unknown" ? "checking" : "offline"}
        </Badge>
        <IconButton onClick={() => setPanel(null)} title="Close panel">
          <X size={16} />
        </IconButton>
      </div>

      {sandboxStatus === "down" ? (
        <SandboxDown onRetry={() => setSandboxStatus("unknown")} />
      ) : !active ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-info-soft text-info">
            <Terminal size={20} />
          </span>
          <p className="text-[13px] text-fg-muted max-w-[260px]">
            No sandbox running. Ask the model to run an agent task or open a
            browser — a Docker VM will appear here.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {sandboxes.length > 1 && (
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
              {sandboxes.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSandbox(s.id)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[12px] font-medium",
                    s.id === active.id
                      ? "bg-accent-soft text-accent"
                      : "text-fg-muted hover:bg-bg-hover",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <ActiveSandboxView key={active.id} active={active} />
        </div>
      )}
    </div>
  );
}


function ActiveSandboxView({ active }: { active: SandboxMeta }) {
  const lines = useSandboxActivity(active.id, active.state !== "error");
  return (
    <>
      <SandboxScreen active={active} lines={lines} />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <SandboxFiles id={active.id} />
        <SandboxTerminal id={active.id} feed={lines} />
      </div>
    </>
  );
}


type ActivityKind =
  | "cmd"
  | "tool"
  | "file"
  | "thinking"
  | "text"
  | "log"
  | "error"
  | "status";

interface ActivityLine {
  t: number;
  kind: ActivityKind;
  text: string;
}

function formatToolEvent(msg: string): { kind: ActivityKind; text: string } {
  const m = /^→\s*([a-z_]+)\s*([\s\S]*)$/.exec(msg || "");
  if (!m) return { kind: "tool", text: msg || "" };
  const name = m[1];
  const rest = m[2].trim();
  if (name === "exec_command") {
    let cmd = rest;
    try {
      const parsed = JSON.parse(rest);
      if (typeof parsed?.command === "string") cmd = parsed.command;
    } catch {
    }
    return { kind: "cmd", text: cmd };
  }
  return { kind: "tool", text: `→ ${name}${rest ? ` ${rest}` : ""}` };
}

interface RunnerEvent {
  type?: string;
  message?: unknown;
  value?: unknown;
  name?: unknown;
  t?: number;
}

function useSandboxActivity(id: string, enabled: boolean): ActivityLine[] {
  const [lines, setLines] = useState<ActivityLine[]>([]);

  useEffect(() => {
    if (!id || !enabled) return;
    let cancelled = false;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let emptyReconnects = 0;

    const push = (evt: RunnerEvent) => {
      if (cancelled) return;
      let kind: ActivityKind;
      let text = "";
      const msg = evt.message == null ? "" : String(evt.message);
      switch (evt.type) {
        case "tool": {
          const f = formatToolEvent(msg);
          kind = f.kind;
          text = f.text;
          break;
        }
        case "file":
          kind = "file";
          text = msg;
          break;
        case "thinking":
          kind = "thinking";
          text = msg;
          break;
        case "text":
          kind = "text";
          text = msg;
          break;
        case "log":
          kind = "log";
          text = msg;
          break;
        case "error":
          kind = "error";
          text = msg || (evt.name == null ? "" : String(evt.name));
          break;
        case "done":
          kind = "status";
          text = msg || "Agent finished";
          break;
        case "status":
          kind = "status";
          text = `status: ${String(evt.value)}`;
          break;
        case "screenshot":
          kind = "status";
          text = "📷 browser screenshot captured";
          break;
        case "progress":
          return;
        default:
          return;
      }
      text = text.trim();
      if (!text) return;
      setLines((prev) => {
        const next = [
          ...prev,
          { t: typeof evt.t === "number" ? evt.t : Date.now(), kind, text },
        ];
        return next.length > 300 ? next.slice(next.length - 300) : next;
      });
    };

    const connect = async () => {
      let res: Response;
      try {
        res = await fetch(`/api/sandbox/${id}/events`, { cache: "no-store" });
      } catch {
        if (!cancelled) reconnect = setTimeout(connect, 1200);
        return;
      }
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let gotData = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (cancelled) {
            reader.cancel().catch(() => {});
            break;
          }
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n");
          buf = parts.pop() ?? "";
          for (const line of parts) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            try {
              push(JSON.parse(trimmed.slice(5).trim()) as RunnerEvent);
              gotData = true;
            } catch {
            }
          }
        }
      } catch {
      }
      if (!cancelled) {
        if (gotData) emptyReconnects = 0;
        else if (++emptyReconnects >= 6) return;
        reconnect = setTimeout(connect, 1200);
      }
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnect) clearTimeout(reconnect);
    };
  }, [id, enabled]);

  return lines;
}

function SandboxScreen({ active, lines }: { active: SandboxMeta; lines: ActivityLine[] }) {
  const removeSandbox = useAppStore((s) => s.removeSandbox);
  const outRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<"auto" | "screen" | "console">("auto");

  const hasShot = !!active.lastScreenshot;
  const showScreen =
    view === "screen" || (view === "auto" && hasShot && !!active.hasBrowser);
  const showConsole = !showScreen;

  useEffect(() => {
    if (showConsole) outRef.current?.scrollTo(0, outRef.current.scrollHeight);
  }, [lines.length, showConsole]);

  const live = active.state === "ready" || active.state === "busy";

  return (
    <div className="shrink-0 border-b border-border p-3">
      <div className="overflow-hidden rounded-xl border border-border bg-[#0d0d0c] shadow-soft">
        <div className="flex items-center gap-1.5 bg-bg-inset px-2.5 py-1.5 border-b border-border">
          <span className="h-2 w-2 rounded-full bg-danger/70" />
          <span className="h-2 w-2 rounded-full bg-warning/70" />
          <span className="h-2 w-2 rounded-full bg-success/70" />
          <span className="ml-1 flex items-center gap-1.5 text-[11px] text-fg-muted font-medium truncate">
            <span>{active.label}</span>
            {live && (
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-success">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
                </span>
                live
              </span>
            )}
            <span className="text-fg-muted/60">· {active.state}</span>
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            {hasShot && (
              <div className="flex overflow-hidden rounded-md border border-border">
                <button
                  onClick={() => setView("screen")}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center text-fg-muted transition-colors hover:text-fg",
                    !showScreen && "bg-bg-hover text-fg",
                  )}
                  title="Show browser screen"
                >
                  <Monitor size={12} />
                </button>
                <button
                  onClick={() => setView("console")}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center text-fg-muted transition-colors hover:text-fg",
                    showConsole && "bg-bg-hover text-fg",
                  )}
                  title="Show agent console (live commands)"
                >
                  <Terminal size={12} />
                </button>
              </div>
            )}
            <button
              onClick={() => {
                void fetch(`/api/sandbox/${active.id}/kill`, { method: "POST" }).catch(() => {});
                removeSandbox(active.id);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-danger-soft hover:text-danger transition-colors"
              title="Kill sandbox"
            >
              <Power size={13} />
            </button>
          </span>
        </div>

        {showScreen ? (
          <div className="relative flex h-64 items-center justify-center bg-[#0d0d0c]">
            <img
              src={active.lastScreenshot}
              alt="sandbox screen"
              className="h-full w-full object-contain"
            />
          </div>
        ) : (
          <div className="bg-[#0d0d0c]">
            <div
              ref={outRef}
              className="max-h-64 min-h-[132px] overflow-y-auto p-2.5 font-mono text-[11px] leading-relaxed"
            >
              {lines.length === 0 && active.state === "starting" && (
                <p className="text-fg-muted/70">Booting container…</p>
              )}
              {lines.length === 0 && active.state !== "starting" && (
                <div className="flex flex-col gap-1 py-2 text-fg-muted/70">
                  <p>
                    The agent is running headless (no browser) — the commands it
                    executes will stream here live.
                  </p>
                  <p className="text-fg-muted/50">
                    Tip: open the <span className="text-fg-secondary">Agents</span> panel to see the full run log.
                  </p>
                </div>
              )}
              {lines.map((l, i) => (
                <ConsoleLine key={i} line={l} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConsoleLine({ line }: { line: ActivityLine }) {
  const time = new Date(line.t).toLocaleTimeString([], { hour12: false });
  const tone =
    line.kind === "cmd"
      ? "text-success"
      : line.kind === "tool"
        ? "text-info"
        : line.kind === "file"
          ? "text-success"
          : line.kind === "thinking"
            ? "text-accent"
            : line.kind === "error"
              ? "text-danger"
              : line.kind === "status"
                ? "text-warning"
                : line.kind === "text"
                  ? "text-fg-secondary"
                  : "text-fg-muted";
  return (
    <pre className={cn("whitespace-pre-wrap break-words", tone)}>
      <span className="mr-1.5 text-fg-muted/40 select-none">{time}</span>
      {line.kind === "cmd" && (
        <span className="mr-0.5 font-semibold text-success/80 select-none">$</span>
      )}
      {line.text}
    </pre>
  );
}


function SandboxDown({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <AlertTriangle size={20} />
      </span>
      <p className="text-[14px] font-medium text-fg">Sandbox service offline</p>
      <p className="text-[12.5px] text-fg-muted max-w-[300px] leading-relaxed">
        The Docker sandbox service isn't running. Start it with{" "}
        <code className="rounded bg-bg-inset px-1.5 py-0.5 text-[11px]">node sandbox/server.mjs</code>{" "}
        and make sure Docker is available.
      </p>
      <Button onClick={onRetry}>Retry connection</Button>
    </div>
  );
}


function SandboxFiles({ id }: { id: string }) {
  const [files, setFiles] = useState<any[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/sandbox/${id}/list?path=/workspace/out`, {
        cache: "no-store",
      }).catch(() => null);
      if (!res || cancelled) return;
      const { files } = await res.json();
      if (!cancelled) setFiles(files || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="rounded-xl border border-border bg-bg-elevated">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FileText size={13} className="text-accent" />
        <span className="text-[12px] font-medium text-fg-secondary">Output files</span>
        <span className="text-[11px] text-fg-muted">/workspace/out</span>
      </div>
      <div className="p-2">
        {!files ? (
          <p className="px-2 py-2 text-[12px] text-fg-muted">Loading…</p>
        ) : files.length === 0 ? (
          <p className="px-2 py-2 text-[12px] text-fg-muted">
            No output files yet.
          </p>
        ) : (
          files.map((f: any, i: number) => (
            <a
              key={i}
              href={`/api/sandbox/${id}/download?path=${encodeURIComponent(f.path || `/workspace/out/${f.name}`)}`}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-fg-secondary hover:bg-bg-hover transition-colors"
            >
              <FileText size={13} className="text-fg-muted" />
              <span className="truncate flex-1">{f.name}</span>
              {typeof f.size === "number" && (
                <span className="text-[10.5px] text-fg-muted">{fmt(f.size)}</span>
              )}
              <Download size={12} className="text-fg-muted" />
            </a>
          ))
        )}
      </div>
    </div>
  );
}


function SandboxTerminal({ id, feed }: { id: string; feed: ActivityLine[] }) {
  const [cmd, setCmd] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const outRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    outRef.current?.scrollTo(0, outRef.current.scrollHeight);
  }, [output, feed.length]);

  const run = async (command: string) => {
    if (!command.trim() || busy) return;
    setBusy(true);
    setOutput((o) => [...o, `$ ${command}`]);
    try {
      const res = await fetch(`/api/sandbox/${id}/exec`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command, timeout: 60_000 }),
      });
      const data = await res.json();
      const text =
        (data?.output as string) ||
        (data?.stdout as string) ||
        (typeof data === "string" ? data : JSON.stringify(data));
      setOutput((o) => [...o, text.split("\n").filter(Boolean).join("\n")]);
    } catch (e: any) {
      setOutput((o) => [...o, `error: ${e.message}`]);
    } finally {
      setBusy(false);
      setCmd("");
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-[#121210]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Terminal size={13} className="text-success" />
        <span className="text-[12px] font-medium text-fg-secondary">Terminal</span>
      </div>
      <div ref={outRef} className="h-40 overflow-auto p-2.5 font-mono text-[11.5px] leading-relaxed text-fg-secondary">
        {feed.length > 0 && (
          <div className="mb-1.5 border-b border-white/10 pb-1.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted/60">
              Agent activity
            </p>
            {feed.map((line, i) => (
              <ConsoleLine key={`agent-${i}`} line={line} />
            ))}
          </div>
        )}
        {feed.length === 0 && output.length === 0 && (
          <p className="text-fg-muted/60">Run a command, e.g. <span className="text-fg-secondary">ls /workspace/out</span></p>
        )}
        {output.map((line, i) => (
          <pre key={i} className="whitespace-pre-wrap">{line}</pre>
        ))}
        {busy && <pre className="text-accent">…</pre>}
      </div>
      <div className="flex items-center gap-1.5 border-t border-white/10 px-2.5 py-2">
        <span className="text-success font-mono text-[12px]">$</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run(cmd)}
          placeholder="type a command"
          className="flex-1 bg-transparent font-mono text-[12px] text-fg placeholder:text-fg-muted/50 focus:outline-none"
        />
        <Button size="sm" variant="ghost" onClick={() => run(cmd)} disabled={busy || !cmd.trim()}>
          Run
        </Button>
      </div>
    </div>
  );
}

function fmt(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
