"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  X,
  Play,
  Square,
  Terminal,
  FileText,
  ChevronDown,
  ChevronRight,
  Monitor,
  Globe,
} from "lucide-react";
import { cn, Button, Badge, IconButton, Spinner } from "@/components/ui";
import { useAppStore, modelLabel, providerGlyph } from "@/lib/app-store";
import type { AgentMeta, ProviderId } from "@/lib/types";


const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "danger" | "warning"> = {
  queued: "neutral",
  starting: "info",
  running: "info",
  done: "success",
  failed: "danger",
  stopped: "warning",
};

export function AgentsPanel() {
  const agents = useAppStore((s) => s.agents);
  const setAgents = useAppStore((s) => s.setAgents);
  const setPanel = useAppStore((s) => s.setPanel);
  const [showFinished, setShowFinished] = React.useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        if (res.ok && !cancelled) {
          setAgents(await res.json());
        }
      } catch {
      }
      if (!cancelled) timer = setTimeout(poll, 2500);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [setAgents]);

  const running = agents
    .filter((a) => ["queued", "starting", "running"].includes(a.status))
    .sort((a, b) => b.createdAt - a.createdAt);
  const finished = agents
    .filter((a) => ["done", "failed", "stopped"].includes(a.status))
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-info-soft text-info">
          <Bot size={14} />
        </span>
        <h2 className="text-[14px] font-semibold text-fg flex-1">Agents</h2>
        <Badge tone="info">{running.length} running</Badge>
        <IconButton onClick={() => setPanel(null)} title="Close panel">
          <X size={16} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2.5 space-y-2">
        <SpawnAgent />
        {agents.length === 0 && (
          <p className="px-3 pt-6 text-center text-[13px] text-fg-muted">
            No agents yet. Ask the model to run a task, or spawn one below.
          </p>
        )}
        {running.map((a) => (
          <AgentCard key={a.id} agent={a} />
        ))}
        {finished.length > 0 && (
          <div>
            <button
              onClick={() => setShowFinished(!showFinished)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-fg-muted hover:bg-bg-hover hover:text-fg-secondary transition-colors"
            >
              {showFinished ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Completed ({finished.length})
            </button>
            {showFinished &&
              finished.map((a) => <AgentCard key={a.id} agent={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}


function SpawnAgent() {
  const [task, setTask] = useState("");
  const [provider, setProvider] = useState<ProviderId>("");
  const [engine, setEngine] = useState<"tool-loop" | "agent-sdk">("tool-loop");
  const [research, setResearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customProviders = useAppStore((s) => s.customProviders);

  const agentProviders = React.useMemo(() => {
    const builtins: ProviderId[] = ["opencode", "anthropic", "openai", "google", "ollama", "lmstudio"];
    const customs = customProviders.map((c) => c.id);
    return [...customs, ...builtins];
  }, [customProviders]);

  const autoProvider = (): ProviderId =>
    customProviders[0]?.id || "anthropic";

  const providerLabel = (id: ProviderId) => {
    const c = customProviders.find((x) => x.id === id);
    if (c) return `${c.glyph || "◆"} ${c.name}`;
    return `${providerGlyph(id)} ${id}`;
  };

  const spawn = async () => {
    if (!task.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const useProvider = provider || autoProvider();
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task: task.trim(),
          provider: useProvider,
          engine,
          research,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "spawn failed");
      }
      setTask("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-fg-secondary">
          Spawn an agent
        </span>
        <div className="flex gap-1">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
            className="rounded-lg border border-border bg-bg-subtle px-2 py-1 text-[12px] text-fg focus:outline-none"
            title="Which provider runs the agent (Auto picks your first configured provider)"
          >
            <option value="">Auto · {autoProvider()}</option>
            {agentProviders.map((p) => (
              <option key={p} value={p}>
                {providerLabel(p)}
              </option>
            ))}
          </select>
          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value as any)}
            className="rounded-lg border border-border bg-bg-subtle px-2 py-1 text-[12px] text-fg focus:outline-none"
          >
            <option value="tool-loop">tool loop</option>
            <option value="agent-sdk">agent SDK</option>
          </select>
          <button
            type="button"
            onClick={() => setResearch(!research)}
            title={
              research
                ? "Research mode ON — agent opens pages in a live Chromium browser"
                : "Research mode OFF — plain agent"
            }
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] font-medium transition-colors",
              research
                ? "border-accent/50 bg-accent-soft text-accent"
                : "border-border bg-bg-subtle text-fg-muted hover:text-fg-secondary",
            )}
          >
            <Globe size={13} />
            Research
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && spawn()}
          placeholder={
            research
              ? "What should the agent research? (e.g. compare current GPU prices and save a briefing to /workspace/out/briefing.md)"
              : "What should the agent do? (e.g. build a PDF report in /workspace/out)"
          }
          className="flex-1 rounded-lg border border-border bg-bg-subtle px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
        />
        <Button variant="primary" onClick={spawn} disabled={busy || !task.trim()}>
          {busy ? <Spinner size={14} className="text-white" /> : <Play size={14} />}
          Run
        </Button>
      </div>
      {research && (
        <p className="mt-2 text-[11.5px] leading-snug text-accent/80">
          🌐 Research mode — the agent will search the web and actually open the
          pages in a live Chromium browser (screenshots stream in), then save a
          cited briefing.
        </p>
      )}
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}


function AgentCard({ agent }: { agent: AgentMeta }) {
  const [open, setOpen] = React.useState(
    agent.status === "running" || agent.status === "starting",
  );
  const setActiveSandbox = useAppStore((s) => s.setActiveSandbox);
  const setPanel = useAppStore((s) => s.setPanel);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [agent.log.length, open]);

  const running = ["queued", "starting", "running"].includes(agent.status);
  const logs = agent.log.slice(-60);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-elevated">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            running ? "bg-info-soft text-info" : "bg-bg-inset text-fg-muted",
          )}
        >
          {running ? <Spinner size={14} /> : <Terminal size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-fg">
            {agent.label}
          </p>
          <p className="truncate text-[11px] text-fg-muted">
            {providerGlyph(agent.provider)} {modelLabel(agent.provider, agent.model)} ·{" "}
            {agent.engine}
          </p>
        </div>
        <Badge tone={STATUS_TONE[agent.status] || "neutral"}>{agent.status}</Badge>
        {running && agent.sandboxId && (
          <IconButton
            title="Open sandbox screen"
            onClick={() => {
              setActiveSandbox(agent.sandboxId!);
              setPanel("sandbox");
            }}
          >
            <Monitor size={14} />
          </IconButton>
        )}
        {running && (
          <IconButton
            title="Stop agent"
            onClick={() => void fetch(`/api/agents/${agent.id}`, { method: "DELETE" })}
          >
            <Square size={13} />
          </IconButton>
        )}
        <IconButton title={open ? "Collapse" : "Expand"} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </IconButton>
      </div>

      {running && (
        <div className="px-3 pb-1">
          <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
            <div
              className="h-full bg-info rounded-full transition-all"
              style={{ width: `${Math.max(3, agent.progress)}%` }}
            />
          </div>
        </div>
      )}

      {open && (
        <div className="border-t border-border">
          <div className="px-3 pt-2.5">
            <p className="text-[12.5px] leading-relaxed text-fg-secondary line-clamp-3">
              {agent.task}
            </p>
          </div>
          <div
            ref={logRef}
            className="mx-3 mt-2 max-h-44 overflow-y-auto rounded-lg bg-[#121210] p-2.5 font-mono text-[11px] leading-relaxed"
          >
            {logs.length === 0 && <p className="text-fg-muted/60">Waiting for events…</p>}
            {logs.map((l, i) => (
              <pre
                key={i}
                className={cn(
                  "whitespace-pre-wrap",
                  l.level === "error"
                    ? "text-danger"
                    : l.level === "tool"
                      ? "text-info"
                      : l.level === "thinking"
                        ? "text-accent"
                        : l.level === "file"
                          ? "text-success"
                          : "text-fg-secondary",
                )}
              >
                <span className="text-fg-muted/50">
                  {new Date(l.t).toLocaleTimeString([], { hour12: false })}
                </span>{" "}
                {l.message}
              </pre>
            ))}
          </div>
          {agent.resultFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
              {agent.resultFiles.map((f, i) => (
                <a
                  key={i}
                  href={`/api/files/${f.id}/${f.filename}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-fg-secondary hover:border-accent/40 hover:text-accent transition-colors"
                >
                  <FileText size={12} />
                  {f.title}
                </a>
              ))}
            </div>
          )}
          {agent.error && (
            <p className="px-3 pb-2.5 text-[12px] text-danger">{agent.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
