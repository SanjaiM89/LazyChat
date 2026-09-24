"use client";

import * as React from "react";
import { Globe, Plus, Trash2, Loader2 } from "lucide-react";
import { Modal, Button, Badge, Toggle } from "@/components/ui";
import type { PublicSearchProvider, SearchProviderKind } from "@/lib/search-providers";

const SEARCH_KINDS: Record<
  SearchProviderKind,
  { label: string; needsKey: boolean; needsUrl: boolean; hint: string }
> = {
  tavily: {
    label: "Tavily",
    needsKey: true,
    needsUrl: false,
    hint: "AI-optimized search with answers + citations. Key from tavily.com.",
  },
  brave: {
    label: "Brave Search",
    needsKey: true,
    needsUrl: false,
    hint: "Privacy-first results. Key from brave.com/search/api.",
  },
  serper: {
    label: "Serper (Google)",
    needsKey: true,
    needsUrl: false,
    hint: "Fast Google results proxy. Key from serper.dev.",
  },
  searxng: {
    label: "SearXNG (self-hosted)",
    needsKey: false,
    needsUrl: true,
    hint: "Your own SearXNG instance URL, e.g. https://search.example.com",
  },
  duckduckgo: {
    label: "DuckDuckGo (built-in)",
    needsKey: false,
    needsUrl: false,
    hint: "No key needed. Built-in fallback, may rate-limit.",
  },
};


export function SearchProvidersDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [providers, setProviders] = React.useState<PublicSearchProvider[]>([]);
  const [kind, setKind] = React.useState<SearchProviderKind>("tavily");
  const [name, setName] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [apiKeyEnv, setApiKeyEnv] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/search-providers", { cache: "no-store" });
      if (res.ok) setProviders(await res.json());
    } catch {
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      setErr(null);
      void refresh();
    }
  }, [open, refresh]);

  const meta = SEARCH_KINDS[kind];

  const add = async () => {
    if (busy) return;
    if (meta.needsUrl && !/^https?:\/\/.+/i.test(baseUrl.trim())) {
      setErr("Enter a valid http(s) base URL for this provider.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/search-providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || meta.label,
          kind,
          apiKey: apiKey.trim(),
          apiKeyEnv: apiKeyEnv.trim(),
          baseUrl: baseUrl.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to add provider.");
      setProviders(data.providers || []);
      setName("");
      setApiKey("");
      setApiKeyEnv("");
      setBaseUrl("");
    } catch (e: any) {
      setErr(e.message || "Failed to add provider.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (p: PublicSearchProvider) => {
    await fetch("/api/search-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: p.id, enabled: !p.enabled }),
    });
    void refresh();
  };

  const remove = async (id: string) => {
    await fetch(`/api/search-providers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    void refresh();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Search providers"
      subtitle="Add Tavily, Brave, Serper or a self-hosted SearXNG endpoint. Enabled providers are tried first; DuckDuckGo stays as the free fallback."
      width="max-w-lg"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-bg-subtle/50 p-3.5 space-y-2">
          <div className="flex items-center gap-2 text-[13px] font-medium text-fg-secondary">
            <Plus size={14} className="text-accent" /> Add a search provider
          </div>
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SearchProviderKind)}
              className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[13px] text-fg focus:outline-none focus:border-accent/50 cursor-pointer"
            >
              {(Object.keys(SEARCH_KINDS) as SearchProviderKind[]).map((k) => (
                <option key={k} value={k}>
                  {SEARCH_KINDS[k].label}
                </option>
              ))}
            </select>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${meta.label} (name)`}
              className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
            />
          </div>
          <p className="text-[11.5px] text-fg-muted">{meta.hint}</p>
          {meta.needsUrl && (
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://search.example.com"
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
            />
          )}
          {meta.needsKey && (
            <>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste API key… (stored server-side)"
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
              />
              <input
                value={apiKeyEnv}
                onChange={(e) => setApiKeyEnv(e.target.value)}
                placeholder="…or env var name (e.g. TAVILY_API_KEY)"
                spellCheck={false}
                className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
              />
            </>
          )}
          {err && <p className="text-[12.5px] text-danger">{err}</p>}
          <div className="flex justify-end">
            <Button variant="primary" onClick={add} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add provider
            </Button>
          </div>
        </div>

        {providers.length === 0 ? (
          <p className="text-center text-[13px] text-fg-muted py-2">
            No custom search providers — DuckDuckGo is used by default.
          </p>
        ) : (
          <div className="space-y-2">
            {providers.map((p) => (
              <div
                key={p.id}
                className="flex items-start gap-3 rounded-xl border border-border bg-bg-elevated p-3"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Globe size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13.5px] font-medium text-fg truncate">{p.name}</p>
                    <Badge tone={p.enabled ? "success" : "neutral"}>
                      {p.enabled ? "enabled" : "disabled"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[12px] text-fg-muted truncate">
                    {SEARCH_KINDS[p.kind]?.label || p.kind}
                    {p.hasApiKey ? " · key set" : meta.needsKey ? " · no key" : ""}
                    {p.baseUrl ? ` · ${p.baseUrl}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Toggle checked={p.enabled} onChange={() => toggle(p)} label="enable" />
                  <button
                    onClick={() => remove(p.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-danger-soft hover:text-danger transition-colors"
                    title="Delete provider"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
