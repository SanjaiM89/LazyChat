"use client";

import * as React from "react";
import { Globe, Plus, Trash2 } from "lucide-react";
import { Modal, Button, Badge, Toggle, Spinner } from "@/components/ui";
import { BrandIcon, BrandTile, searchIconKey } from "@/components/brand/BrandIcon";
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
        <div className="space-y-2 rounded-lg border border-border bg-bg-surface-100 p-3.5">
          <div className="eyebrow flex items-center gap-2">
            <Plus size={12} className="text-accent" /> Add a search provider
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {(Object.keys(SEARCH_KINDS) as SearchProviderKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                title={SEARCH_KINDS[k].label}
                className={
                  "group flex flex-col items-center gap-1.5 rounded-md border px-1 py-2 text-[10.5px] transition-all duration-200 " +
                  (kind === k
                    ? "border-brand/50 bg-accent-soft text-fg shadow-[0_0_0_3px_var(--accent-soft)]"
                    : "border-border bg-bg-surface-200 text-fg-muted hover:border-border-strong hover:text-fg-secondary")
                }
              >
                <span className={"transition-transform duration-300 group-hover:scale-110 " + (kind === k ? "" : "opacity-75 grayscale group-hover:opacity-100 group-hover:grayscale-0")}>
                  <BrandIcon name={searchIconKey(k)} size={18} fallback={<Globe size={18} />} />
                </span>
                <span className="w-full truncate text-center">{SEARCH_KINDS[k].label.split(" ")[0]}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SearchProviderKind)}
              className="rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-1.5 text-[13px] text-fg focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)] cursor-pointer"
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
              className="rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            />
          </div>
          <p className="text-[11.5px] text-fg-muted">{meta.hint}</p>
          {meta.needsUrl && (
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://search.example.com"
              spellCheck={false}
              className="w-full rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
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
                className="w-full rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
              />
              <input
                value={apiKeyEnv}
                onChange={(e) => setApiKeyEnv(e.target.value)}
                placeholder="…or env var name (e.g. TAVILY_API_KEY)"
                spellCheck={false}
                className="w-full rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
              />
            </>
          )}
          {err && <p className="text-[12.5px] text-danger">{err}</p>}
          <div className="flex justify-end">
            <Button variant="primary" onClick={add} disabled={busy}>
              {busy ? <Spinner size={13} /> : <Plus size={14} />}
              Add provider
            </Button>
          </div>
        </div>

        {providers.length === 0 ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-4 text-[13px] text-fg-muted">
            <BrandIcon name="duckduckgo" size={16} />
            No custom search providers — DuckDuckGo is used by default.
          </div>
        ) : (
          <div className="space-y-2 stagger [--stagger:45ms]">
            {providers.map((p) => (
              <div
                key={p.id}
                className="lift group flex items-start gap-3 rounded-lg border border-border bg-bg-surface-100 p-3 hover:border-border-strong"
              >
                <BrandTile name={searchIconKey(p.kind)} size={32} glow className="mt-0.5" fallback={<Globe size={14} className="text-accent" />} />
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
                    className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted opacity-60 transition-all group-hover:opacity-100 hover:bg-danger-soft hover:text-danger"
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
