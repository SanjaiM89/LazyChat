"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Plug, Plus, Trash2, RefreshCw, Loader2, Wrench } from "lucide-react";
import { Modal, Button, Badge, Toggle } from "@/components/ui";
import { useAppStore } from "@/lib/app-store";
import type { MCPServerDef } from "@/lib/types";


export function ConnectionsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const mcpServers = useAppStore((s) => s.mcpServers);
  const mcpTools = useAppStore((s) => s.mcpTools);
  const setMCP = useAppStore((s) => s.setMCP);

  const [type, setType] = useState<"stdio" | "http">("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const res = await fetch("/api/mcp", { cache: "no-store" });
    if (res.ok) {
      const { servers, tools } = await res.json();
      setMCP(servers || [], tools || []);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const add = async () => {
    if (!name.trim() || busy) return;
    if (type === "stdio" && !command.trim()) return;
    if (type === "http" && !url.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          command: command.trim() || undefined,
          args: args.split(",").map((a) => a.trim()).filter(Boolean),
          url: url.trim() || undefined,
        }),
      });
      if (res.ok) {
        const { servers, tools } = await res.json();
        setMCP(servers || [], tools || []);
        setName("");
        setCommand("");
        setArgs("");
        setUrl("");
      }
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: MCPServerDef, connect: boolean) => {
    await fetch("/api/mcp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: s.id, connect }),
    });
    void refresh();
  };

  const remove = async (id: string) => {
    await fetch(`/api/mcp?id=${id}`, { method: "DELETE" });
    void refresh();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connections"
      subtitle="Connect MCP servers to give the model live tools (filesystem, browser, databases…)."
      width="max-w-3xl"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-bg-subtle/50 p-3.5 space-y-2">
          <div className="flex items-center gap-2">
            <Plus size={14} className="text-accent" />
            <span className="text-[13px] font-medium text-fg-secondary">
              Add MCP server
            </span>
            <div className="ml-auto flex rounded-lg border border-border overflow-hidden">
              {(["stdio", "http"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={
                    "px-3 py-1.5 text-[12px] font-medium transition-colors " +
                    (type === t
                      ? "bg-accent-soft text-accent"
                      : "text-fg-muted hover:bg-bg-hover")
                  }
                >
                  {t === "stdio" ? "Local command" : "HTTP URL"}
                </button>
              ))}
            </div>
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. 'filesystem', 'github')"
            className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
          />
          {type === "stdio" ? (
            <>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Command (e.g. npx)"
                className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
              />
              <input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="Args, comma-separated (e.g. -y, @modelcontextprotocol/server-filesystem, /workspace)"
                className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
              />
            </>
          ) : (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com/sse or /mcp endpoint"
              className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
            />
          )}
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={add}
              disabled={
                busy || !name.trim() || (type === "stdio" && !command.trim()) || (type === "http" && !url.trim())
              }
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add & connect
            </Button>
          </div>
        </div>

        {mcpServers.length === 0 && (
          <p className="py-3 text-center text-[13px] text-fg-muted">
            No MCP servers connected.
          </p>
        )}
        <div className="space-y-2">
          {mcpServers.map((s) => (
            <div key={s.id} className="rounded-xl border border-border bg-bg-elevated p-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info">
                  <Plug size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13.5px] font-medium text-fg">{s.name}</p>
                    <Badge tone={s.status === "connected" ? "success" : s.status === "error" ? "danger" : "neutral"}>
                      {s.status || "disconnected"}
                    </Badge>
                  </div>
                  <p className="truncate text-[11.5px] text-fg-muted font-mono">
                    {s.type === "stdio"
                      ? `${s.command} ${(s.args || []).join(" ")}`
                      : s.url}
                  </p>
                </div>
                <Toggle
                  checked={s.enabled}
                  onChange={(v) => toggle(s, v)}
                  label="connect"
                />
                <button
                  onClick={() => remove(s.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-danger-soft hover:text-danger transition-colors"
                  title="Remove server"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {s.enabled && s.status === "connected" && s.tools && s.tools.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {s.tools.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-md bg-bg-inset px-2 py-1 text-[11px] font-medium text-fg-secondary"
                    >
                      <Wrench size={10} className="text-accent" />
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {mcpTools.length > 0 && (
          <div className="rounded-xl border border-border bg-bg-subtle/40 p-3">
            <div className="flex items-center gap-2 text-[12px] font-medium text-fg-muted mb-2">
              <RefreshCw size={12} />
              {mcpTools.length} MCP tool(s) available to the model
            </div>
            <div className="flex flex-wrap gap-1.5">
              {mcpTools.map((t, i) => (
                <span key={i} className="rounded-md border border-border px-2 py-1 text-[11px] text-fg-secondary">
                  {t.serverId}/{t.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
