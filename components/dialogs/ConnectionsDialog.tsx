"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Plug, Plus, Trash2, RefreshCw, Wrench } from "lucide-react";
import { Modal, Button, Badge, Toggle, Spinner, Segmented } from "@/components/ui";
import { BrandIcon, BrandTile, connectorIconKey } from "@/components/brand/BrandIcon";
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
        <div className="space-y-2 rounded-lg border border-border bg-bg-surface-100 p-3.5">
          <div className="flex items-center gap-2.5">
            <BrandTile name={connectorIconKey(name, url, command, args)} size={28} />
            <span className="eyebrow">Add MCP server</span>
            <Segmented
              className="ml-auto w-[220px]"
              value={type}
              onChange={setType}
              options={[
                { value: "stdio", label: "Local command" },
                { value: "http", label: "HTTP URL" },
              ]}
            />
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. 'filesystem', 'github')"
            className="w-full rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          {type === "stdio" ? (
            <>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Command (e.g. npx)"
                className="w-full rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
              />
              <input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="Args, comma-separated (e.g. -y, @modelcontextprotocol/server-filesystem, /workspace)"
                className="w-full rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
              />
            </>
          ) : (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com/sse or /mcp endpoint"
              className="w-full rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
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
              {busy ? <Spinner size={13} /> : <Plus size={14} />}
              Add & connect
            </Button>
          </div>
        </div>

        {mcpServers.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-6 text-center text-[13px] text-fg-muted">
            <span className="flex items-center gap-2 opacity-60 grayscale">
              {(["github", "notion", "linear", "postgresql", "figma"] as const).map((k) => (
                <BrandIcon key={k} name={k} size={16} />
              ))}
            </span>
            No MCP servers connected.
          </div>
        )}
        <div className="space-y-2 stagger [--stagger:45ms]">
          {mcpServers.map((s) => (
            <div key={s.id} className="lift group rounded-lg border border-border bg-bg-surface-100 p-3 hover:border-border-strong">
              <div className="flex items-center gap-3">
                <span className="relative">
                  <BrandTile name={connectorIconKey(s.name, s.url, s.command, (s.args || []).join(" "))} size={34} glow fallback={<Plug size={14} />} />
                  {s.status === "connected" && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex rounded-full ring-2 ring-bg-surface-100"><span className="live-dot !h-2 !w-2" /></span>
                  )}
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
                  className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted opacity-60 transition-all group-hover:opacity-100 hover:bg-danger-soft hover:text-danger"
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
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-surface-200 px-2 py-0.5 font-mono text-[11px] text-fg-secondary"
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
          <div className="rounded-lg border border-border bg-bg-surface-100 p-3">
            <div className="eyebrow mb-2 flex items-center gap-2">
              <RefreshCw size={12} />
              {mcpTools.length} MCP tool(s) available to the model
            </div>
            <div className="flex flex-wrap gap-1.5">
              {mcpTools.map((t, i) => (
                <span key={i} className="rounded-md border border-border bg-bg-surface-200 px-2 py-0.5 font-mono text-[11px] text-fg-secondary">
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
