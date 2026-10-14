"use client";

import * as React from "react";
import { api, streamChat, API_URL, type ActivityItem, type GraphNode, type MemoryNode, type Procedure, type SchemaInfo, type SessionSummary, type SubGraph, type TraceStep, type Turn } from "@/lib/brainApi";
import { GraphCanvas, Legend } from "./GraphCanvas";
import { AgentActivity, MemoryPanel, ProceduresPanel, ReasoningTrace } from "./Panels";
import { Button, cn } from "@/components/ui";

const USER_ID = "demo-user";

const SUGGESTIONS = [
  "Which tickets are blocked by the auth migration?",
  "If the notifications service goes down, what breaks?",
  "Who knows the auth system?",
  "What did we decide about the database and why?",
  "Which services are bottlenecks?",
  "Who worked on the payments service and what decisions did they make?",
  "File a p1 ticket for the auth outage and assign it to the best expert",
];

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  trace?: TraceStep[];
  agents?: string[];
  sources?: string[];
  streaming?: boolean;
};

function mergeProcedures(current: Procedure[], incoming: Procedure[]): Procedure[] {
  const byId = new Map(current.map((p) => [p.id, p]));
  for (const p of incoming) {
    if (!p?.id) continue;
    const prev = byId.get(p.id);
    byId.set(p.id, { ...prev, ...p, uses: Math.max(prev?.uses ?? 0, p.uses ?? 0) });
  }
  return [...byId.values()].sort(
    (a, b) => Number(!!b.learned) - Number(!!a.learned) || (b.uses ?? 0) - (a.uses ?? 0),
  );
}

export function BrainApp() {
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sessionId, setSessionId] = React.useState<string | null>(null);

  const [graph, setGraph] = React.useState<SubGraph>({ nodes: [], edges: [] });
  const [highlight, setHighlight] = React.useState<Set<string>>(new Set());
  const [traverse, setTraverse] = React.useState<string[]>([]);
  const [showReasoning, setShowReasoning] = React.useState(true);

  const [schema, setSchema] = React.useState<SchemaInfo | null>(null);
  const [sessions, setSessions] = React.useState<SessionSummary[]>([]);
  const [activity, setActivity] = React.useState<ActivityItem[]>([]);
  const [memories, setMemories] = React.useState<MemoryNode[]>([]);
  const [memStats, setMemStats] = React.useState<Record<string, number>>({});
  const [procedures, setProcedures] = React.useState<Procedure[]>([]);
  const [justLearned, setJustLearned] = React.useState<Procedure | null>(null);
  const [detail, setDetail] = React.useState<GraphNode | null>(null);
  const [tab, setTab] = React.useState<"graph" | "activity" | "memory">("graph");
  const [memView, setMemView] = React.useState<"memories" | "procedures">("memories");
  const [error, setError] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState<boolean | null>(null);

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const closeStream = React.useRef<(() => void) | null>(null);

  // --- bootstrap ---------------------------------------------------------
  React.useEffect(() => {
    api.health().then(() => setConnected(true)).catch(() => setConnected(false));
    api.schema().then(setSchema).catch(() => {});
    api.sessions(USER_ID).then((r) => setSessions(r.sessions)).catch(() => {});
    api.memory(USER_ID).then((r) => {
      setMemories(r.memories);
      setMemStats(r.stats);
      setProcedures(r.procedures);
    }).catch(() => {});
    return () => closeStream.current?.();
  }, []);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // --- send --------------------------------------------------------------
  const applyGraph = React.useCallback((sub: SubGraph) => {
    setGraph(sub);
    setHighlight(new Set(sub.nodes.map((n) => n.id)));
  }, []);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    setError(null);
    setInput("");
    setBusy(true);
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: question };
    const replyId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      userMsg,
      { id: replyId, role: "assistant", content: "", trace: [], streaming: true },
    ]);

    const liveTrace: TraceStep[] = [];
    const appendDelta = (chunk: string) =>
      setMessages((m) =>
        m.map((x) => (x.id === replyId ? { ...x, content: x.content + chunk } : x)),
      );
    const setTrace = () =>
      setMessages((m) =>
        m.map((x) => (x.id === replyId ? { ...x, trace: [...liveTrace] } : x)),
      );

    let gotDone = false;
    // The socket is the primary path. The REST fallback fires only if the
    // socket actually FAILED (error/close) — never merely because the answer
    // is slow. A time-based fallback would double every question's cost with a
    // 20-90s model while both calls run concurrently.
    let socketFailed = false;
    let poll: number | undefined;
    try {
      closeStream.current = streamChat(
        { message: question, session_id: sessionId, user_id: USER_ID },
        (ev) => {
          switch (ev.type) {
            case "start":
              setSessionId(ev.session_id);
              break;
            case "tool":
              liveTrace.push({
                tool: ev.tool,
                arguments: ev.arguments,
                cypher: ev.cypher,
                result_summary: ev.result_summary,
                row_count: ev.row_count,
                duration_ms: ev.duration_ms,
                error: ev.error,
              });
              setTrace();
              break;
            case "handoff":
              setActivity((a) => [
                ...a,
                {
                  kind: "handoff",
                  agent: ev.from,
                  detail: `→ ${ev.to}: ${ev.findings} finding(s) handed off`,
                  timestamp: new Date().toISOString(),
                },
              ]);
              break;
            case "memory":
              if (ev.memories?.length) setMemories((m) => [...ev.memories, ...m]);
              break;
            case "procedures":
              if (ev.procedures?.length) setProcedures((p) => mergeProcedures(p, ev.procedures!));
              break;
            case "procedure_learned":
              setJustLearned(ev.procedure ?? null);
              setProcedures((p) => mergeProcedures(p, [ev.procedure!]));
              break;
            case "delta":
              appendDelta(ev.text);
              break;
            case "done": {
              gotDone = true;
              setSessionId(ev.session_id);
              applyGraph(ev.graph_context);
              setTraverse(ev.graph_context.nodes.map((n) => n.id));
              setActivity(ev.activity || []);
              setMessages((m) =>
                m.map((x) =>
                  x.id === replyId
                    ? {
                        ...x,
                        content: ev.answer,
                        trace: ev.reasoning_trace,
                        agents: ev.agents_involved,
                        sources: ev.sources,
                        streaming: false,
                      }
                    : x,
                ),
              );
              break;
            }
            case "error":
              setError(ev.message);
              break;
          }
        },
        () => {
          // Closed without a `done`: the stream failed, so fall back to REST.
          if (!gotDone) socketFailed = true;
        },
      );

      const useRestFallback = async () => {
        if (gotDone || !socketFailed) return;
        try {
          const r = await api.chat(question, sessionId, USER_ID);
          gotDone = true;
          setSessionId(r.session_id);
          applyGraph(r.graph_context);
          setTraverse(r.graph_context.nodes.map((n) => n.id));
          setActivity(r.activity || []);
          if (r.procedure_learned) {
            setJustLearned(r.procedure_learned);
            setProcedures((p) => mergeProcedures(p, [r.procedure_learned!]));
          }
          setMessages((m) =>
            m.map((x) =>
              x.id === replyId
                ? {
                    ...x,
                    content: r.answer,
                    trace: r.reasoning_trace,
                    agents: r.agents_involved,
                    sources: r.sources,
                    streaming: false,
                  }
                : x,
            ),
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setMessages((m) =>
            m.map((x) => (x.id === replyId ? { ...x, streaming: false } : x)),
          );
        }
      };

      // Poll briefly: if the socket dies we want to react in seconds, but a
      // slow-but-healthy stream must not trigger a duplicate call.
      let waited = 0;
      poll = window.setInterval(async () => {
        waited += 500;
        if (gotDone) {
          window.clearInterval(poll);
          return;
        }
        if (socketFailed) {
          window.clearInterval(poll);
          await useRestFallback();
        } else if (waited > 60000) {
          window.clearInterval(poll);
          setError("The agent is taking longer than a minute. Check the backend logs.");
        }
      }, 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }

    // Release the UI only when the turn really finished. A 20-90s model must
    // keep the Send button disabled, otherwise the user can fire a second
    // question into the same session mid-answer.
    const finish = () => {
      if (poll !== undefined) window.clearInterval(poll);
      setBusy(false);
      closeStream.current?.();
      api.sessions(USER_ID).then((r) => setSessions(r.sessions)).catch(() => {});
      api.memory(USER_ID).then((r) => {
        setMemories(r.memories);
        setMemStats(r.stats);
        setProcedures(r.procedures);
      }).catch(() => {});
    };
    const watch = window.setInterval(() => {
      if (gotDone) {
        window.clearInterval(watch);
        finish();
      }
    }, 300);
  }

  // --- sessions ----------------------------------------------------------
  async function loadSession(sid: string) {
    try {
      const { turns } = await api.turns(sid);
      const msgs: Msg[] = turns.map((t) => ({
        id: t.id,
        role: (t.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: t.content,
      }));
      setMessages(msgs);
      setSessionId(sid);
      const act = await api.activity(sid);
      setActivity(act.activity);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function newSession() {
    setSessionId(null);
    setMessages([]);
    setGraph({ nodes: [], edges: [] });
    setHighlight(new Set());
    setTraverse([]);
    setActivity([]);
    setDetail(null);
  }

  // --- graph interaction --------------------------------------------------
  async function onNodeClick(node: GraphNode) {
    setDetail(node);
    try {
      const full = await api.node(node.id);
      setDetail({ ...node, properties: full.properties, label: full.label, name: full.name });
    } catch {
      /* keep the partial node detail */
    }
    try {
      const sub = await api.subgraph(node.id, 2);
      applyGraph(sub);
    } catch {
      /* expansion is best-effort */
    }
  }

  const activeNode = detail ? detail.id : null;

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg text-fg">
      {/* ---------------- sidebar ---------------- */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-bg-subtle">
        <div className="border-b border-border p-3">
          <h1 className="text-sm font-semibold">Company Brain</h1>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            {connected === null ? "connecting…" : connected ? "FalkorDB connected" : "backend unreachable"}
          </p>
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" variant="primary" onClick={newSession}>New session</Button>
            <Button size="sm" variant="ghost" onClick={() => { setTab("memory"); api.memory(USER_ID).then((r) => { setMemories(r.memories); setMemStats(r.stats); }); }}>
              Refresh memory
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
            Past sessions
          </p>
          {sessions.length === 0 && (
            <p className="px-1 text-[11px] text-fg-muted">No sessions yet.</p>
          )}
          {sessions.map((s) => (
            <button
              key={s.session_id}
              onClick={() => loadSession(s.session_id)}
              className={cn(
                "mb-1 block w-full rounded-md border p-2 text-left transition",
                s.session_id === sessionId
                  ? "border-accent bg-accent-soft"
                  : "border-border bg-bg-elevated hover:bg-bg-hover",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[11px] font-medium">
                  {s.preview || s.session_id.slice(0, 22)}
                </span>
                <span className="ml-auto shrink-0 rounded bg-bg-inset px-1 text-[9px] text-fg-muted">
                  {s.turn_count}
                </span>
              </div>
              {s.last_active_at && (
                <p className="mt-0.5 text-[10px] text-fg-muted">
                  {s.last_active_at.slice(0, 16).replace("T", " ")}
                </p>
              )}
            </button>
          ))}
        </div>

        <div className="border-t border-border p-2">
          <p className="text-[10px] text-fg-muted">
            API: <span className="font-mono">{API_URL}</span>
          </p>
        </div>
      </aside>

      {/* ---------------- chat ---------------- */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <span className="text-xs font-medium text-fg-secondary">Ask the company</span>
          {messages.length === 0 && (
            <span className="text-[11px] text-fg-muted">
              every answer is a graph traversal — nothing is invented
            </span>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
          {messages.length === 0 && (
            <div className="mx-auto max-w-2xl pt-8">
              <p className="mb-3 text-center text-sm text-fg-muted">
                Try one of these — each one needs a different graph traversal:
              </p>
              <div className="flex flex-col gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-left text-xs hover:border-accent hover:bg-bg-hover"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-xl rounded-br-sm bg-accent px-3.5 py-2 text-sm text-white">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="rounded-xl border border-border bg-bg-elevated p-3">
                  {m.agents && m.agents.length > 1 && (
                    <div className="mb-1.5 flex gap-1">
                      {m.agents.map((a) => (
                        <span
                          key={a}
                          className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                    {m.content || (m.streaming ? <span className="animate-pulse">…</span> : "")}
                  </div>
                  {m.trace && m.trace.length > 0 && (
                    <ReasoningTrace trace={m.trace} defaultOpen={showReasoning} />
                  )}
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.sources.slice(0, 10).map((s) => {
                        const id = s.includes(":") ? s.split(":").slice(1).join(":") : s;
                        return (
                          <button
                            key={s}
                            onClick={() => {
                              const node = graph.nodes.find((n) => n.id === id);
                              if (node) onNodeClick(node);
                            }}
                            className="rounded border border-border bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary hover:border-accent hover:text-accent-strong"
                            title="Highlight this source in the graph"
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        </div>

        <div className="border-t border-border p-3">
          <div className="mx-auto flex max-w-3xl gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={2}
              placeholder="Ask about people, services, tickets, decisions…  (Enter to send)"
              className="flex-1 resize-none rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <Button variant="primary" onClick={() => send(input)} disabled={busy || !input.trim()}>
              {busy ? "Thinking…" : "Send"}
            </Button>
          </div>
          {error && (
            <p className="mx-auto mt-2 max-w-3xl rounded bg-danger-soft px-2 py-1 text-[11px] text-danger">
              {error}
            </p>
          )}
        </div>
      </section>

      {/* ---------------- graph panel ---------------- */}
      <aside className="flex w-[460px] shrink-0 flex-col border-l border-border bg-bg-subtle">
        <div className="flex gap-1 border-b border-border p-2">
          {(["graph", "activity", "memory"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs capitalize transition",
                tab === t ? "bg-accent text-white" : "text-fg-secondary hover:bg-bg-hover",
              )}
            >
              {t === "activity" ? "Agent activity" : t}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1 text-[11px] text-fg-secondary">
            <input
              type="checkbox"
              checked={showReasoning}
              onChange={(e) => setShowReasoning(e.target.checked)}
            />
            show trace
          </label>
        </div>

        {tab === "graph" && (
          <>
            <div className="h-[52%] border-b border-border">
              <GraphCanvas
                data={graph}
                highlight={highlight}
                traverse={traverse}
                onNodeClick={onNodeClick}
              />
            </div>
            <div className="border-b border-border p-2">
              <Legend
                labels={schema?.labels ?? []}
                active={highlight}
                onToggle={() => {}}
              />
              <p className="mt-1.5 text-[10px] text-fg-muted">
                {graph.nodes.length} nodes · {graph.edges.length} edges contributed to
                the last answer. Click a node to expand its neighbourhood.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {detail ? (
                <NodeDetail node={detail} />
              ) : (
                <p className="text-[11px] text-fg-muted">
                  Click any node to inspect its properties and neighbours.
                </p>
              )}
            </div>
          </>
        )}

        {tab === "activity" && (
          <div className="flex-1 overflow-y-auto p-2">
            <AgentActivity activity={activity} />
          </div>
        )}

        {tab === "memory" && (
          <div className="flex-1 overflow-y-auto p-2">
            <div className="mb-1 flex gap-1">
              <button
                onClick={() => setMemView("memories")}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px]",
                  memView === "memories" ? "bg-bg-inset font-medium" : "text-fg-muted",
                )}
              >
                Memories
              </button>
              <button
                onClick={() => setMemView("procedures")}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px]",
                  memView === "procedures" ? "bg-bg-inset font-medium" : "text-fg-muted",
                )}
              >
                Procedures ({procedures.filter((p) => p.learned).length} learned)
              </button>
            </div>
            {memView === "procedures" ? (
              <ProceduresPanel procedures={procedures} justLearned={justLearned} />
            ) : (
              <MemoryPanel memories={memories} stats={memStats} />
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function NodeDetail({ node }: { node: GraphNode }) {
  const entries = Object.entries(node.properties || {}).filter(
    ([, v]) => v !== null && v !== undefined && typeof v !== "object",
  );
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: node.color || "#64748b" }}
        />
        <span className="text-sm font-medium">{node.name}</span>
        <span className="rounded bg-bg-inset px-1.5 py-0.5 text-[10px] text-fg-muted">
          {node.label}
        </span>
      </div>
      <p className="mt-0.5 font-mono text-[10px] text-fg-muted">{node.id}</p>
      <dl className="mt-2 space-y-1">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-[11px]">
            <dt className="w-28 shrink-0 text-fg-muted">{k}</dt>
            <dd className="min-w-0 flex-1 break-words text-fg-secondary">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
