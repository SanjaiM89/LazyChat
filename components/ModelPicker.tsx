"use client";

import * as React from "react";
import {
  ChevronDown,
  Check,
  Plus,
  Pencil,
  Trash2,
  KeyRound,
} from "lucide-react";
import { cn, Dropdown, MenuItem, Modal, Button, IconButton, Spinner } from "@/components/ui";
import { PROVIDER_LIST } from "@/lib/models";
import { useAppStore, modelLabel, providerGlyph } from "@/lib/app-store";
import type { ProviderId, ProviderProtocol, PublicCustomProvider } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Provider + model picker (user-added custom providers only)          */
/* ------------------------------------------------------------------ */

interface PickModel {
  id: string;
  name: string;
  supportsThinking: boolean;
}

/** Copy per API dialect, shared by the dropdown subtitle and the add form. */
const PROTOCOL_META: Record<
  ProviderProtocol,
  { short: string; blurb: string; baseUrlPlaceholder: string; error: string }
> = {
  openai: {
    short: "OpenAI-compatible",
    blurb:
      "Standard /chat/completions endpoint with an API key (OpenRouter, Groq, Together, a local vLLM server…).",
    baseUrlPlaceholder: "https://api.groq.com/openai/v1",
    error: "Base URL must be an http(s) URL, e.g. https://api.example.com/v1",
  },
  anthropic: {
    short: "Anthropic-compatible",
    blurb:
      "For Anthropic Messages API gateways (e.g. agentrouter). Key is sent the same way Anthropic SDK clients do.",
    baseUrlPlaceholder:
      "https://agentrouter.org   (we call /v1/messages on this base)",
    error: "Base URL must be an http(s) host root, e.g. https://agentrouter.org",
  },
  gemini: {
    short: "Google Gemini (native)",
    blurb:
      "Google's Interactions API (what tools like Claude Code gateways proxy). Key is sent as x-goog-api-key.",
    baseUrlPlaceholder:
      "https://generativelanguage.googleapis.com/v1beta   (we call /interactions)",
    error:
      "Base URL must be the Google API root, e.g. https://generativelanguage.googleapis.com/v1beta",
  },
};

function normProtocol(p: ProviderProtocol | undefined): ProviderProtocol {
  return p === "anthropic" || p === "gemini" ? p : "openai";
}

export function ModelPicker() {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const customProviders = useAppStore((s) => s.customProviders);

  const [menuOpen, setMenuOpen] = React.useState(false);
  const [manageOpen, setManageOpen] = React.useState(false);
  const [live, setLive] = React.useState<Record<string, any[]>>({});
  const [liveOk, setLiveOk] = React.useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = React.useState(false);

  const refreshLive = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/models", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const models: Record<string, any[]> = {};
      const ok: Record<string, boolean> = {};
      for (const [pid, v] of Object.entries<any>(data)) {
        models[pid] = Array.isArray(v?.effective) ? v.effective : [];
        ok[pid] = !!v?.liveOk;
      }
      setLive(models);
      setLiveOk(ok);
    } finally {
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    if (menuOpen && Object.keys(live).length === 0) void refreshLive();
  }, [menuOpen, live, refreshLive]);

  const customById = React.useMemo(
    () => new Map(customProviders.map((c) => [c.id, c])),
    [customProviders],
  );

  // Selected label/glyph: built-ins via the shared maps, custom via the
  // loaded registry (so we can show a friendly model name + glyph).
  const selectedCustom = customById.get(settings.provider);
  const glyph = selectedCustom
    ? selectedCustom.glyph || "◆"
    : providerGlyph(settings.provider);
  const label = selectedCustom
    ? (selectedCustom.models.find((m) => m.id === settings.model)?.name ||
        settings.model)
    : modelLabel(settings.provider, settings.model);

  const pick = (provider: string, modelId: string, supportsThinking: boolean) => {
    setSettings({
      provider: provider as ProviderId,
      model: modelId,
      thinking: settings.thinking && supportsThinking,
    });
  };

  const defaultModelId = (provider: string): string => {
    const cfg = PROVIDER_LIST.find((p) => p.id === provider);
    if (cfg?.models?.length) {
      return cfg.models.find((m) => m.default)?.id ?? cfg.models[0].id;
    }
    const cp = customById.get(provider);
    return cp?.models[0]?.id || "";
  };

  const modelRow = (provider: string, m: PickModel & { retired?: boolean; liveOnly?: boolean }) => {
    const selected = settings.provider === provider && settings.model === m.id;
    return (
      <MenuItem
        key={m.id}
        active={selected}
        onClick={() => pick(provider, m.id, m.supportsThinking)}
        className="pr-8"
      >
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {m.name}
          {m.retired && (
            <span className="ml-1.5 rounded bg-warning/15 px-1 py-px text-[10px] font-medium text-warning">
              retired?
            </span>
          )}
          {m.liveOnly && (
            <span className="ml-1.5 rounded bg-success-soft px-1 py-px text-[10px] font-medium text-success">
              live
            </span>
          )}
        </span>
        {m.supportsThinking && (
          <span className="text-[10px] text-fg-muted">●</span>
        )}
        {selected && (
          <Check size={14} className="ml-auto text-accent shrink-0" />
        )}
      </MenuItem>
    );
  };

  const customNorm = (c: PublicCustomProvider): PickModel[] =>
    c.models.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      supportsThinking: m.supportsThinking ?? false,
    }));

  return (
    <>
      <Dropdown
        align="right"
        open={menuOpen}
        onOpenChange={setMenuOpen}
        trigger={
          <button
            data-testid="model-picker-trigger"
            className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-fg-secondary hover:bg-bg-hover hover:text-fg transition-colors"
          >
            <span className="text-accent">{glyph}</span>
            <span className="max-w-[150px] truncate">{label}</span>
            <ChevronDown size={14} className="text-fg-muted" />
          </button>
        }
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
          <div className="flex items-center justify-between px-3 pb-1">
            <span className="text-[11px] text-fg-muted">
              {refreshing ? "Refreshing models from providers…" : liveOk && Object.keys(liveOk).length
                ? "Live model lists loaded where the provider supports it"
                : "Model lists refresh live from providers when opened"}
            </span>
            <button
              onClick={() => void refreshLive()}
              disabled={refreshing}
              className="text-[11px] font-medium text-accent hover:underline disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {PROVIDER_LIST.map((p) => {
              const effective = live[p.id] && live[p.id].length ? live[p.id] : p.models;
              return (
              <div key={p.id}>
                <div className="flex items-center justify-between px-3 pt-1 pb-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                    {p.glyph} {p.name}
                  </span>
                  <span className="max-w-[45%] truncate text-[10px] text-fg-muted/70">
                    {p.keyEnv ? "API key" : "local"}
                    {liveOk[p.id] ? " · live" : ""}
                  </span>
                </div>
                <div className="mb-1">
                  {effective.map((m: any) =>
                    modelRow(
                      p.id,
                      {
                        id: m.id,
                        name: m.name || m.id,
                        supportsThinking: m.supportsThinking ?? true,
                        retired: m.retired,
                        liveOnly: m.liveOnly,
                      },
                    ),
                  )}
                </div>
              </div>
              );
            })}
            {customProviders.length === 0 ? (
              <p className="px-3 py-3 text-center text-[12px] leading-relaxed text-fg-muted">
                No custom providers yet. Add one below to point Omnia at any
                other OpenAI-, Anthropic- or Gemini-compatible API.
              </p>
            ) : (
              customProviders.map((c) => (
                <div key={c.id}>
                  <div className="flex items-center justify-between px-3 pt-1 pb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                      {c.glyph || "◆"} {c.name}
                    </span>
                    <span className="text-[10px] text-fg-muted/70">
                      {PROTOCOL_META[normProtocol(c.protocol)].short}
                    </span>
                  </div>
                  <div className="mb-1">
                    {customNorm(c).map((m) => modelRow(c.id, m))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-1.5 flex flex-col gap-0.5 border-t border-border pt-1.5">
          <MenuItem
            icon={<KeyRound size={13} />}
            onClick={() => {
              setMenuOpen(false);
              useAppStore.getState().setApiKeysOpen(true);
            }}
            className="text-[13px] text-fg-secondary"
          >
            API keys… (OpenCode Zen, Anthropic…)
          </MenuItem>
          <MenuItem
            icon={<Plus size={13} />}
            onClick={() => {
              setMenuOpen(false);
              setManageOpen(true);
            }}
            className="text-[13px] text-fg-secondary"
          >
            Add or manage custom providers…
          </MenuItem>
          <button
            onClick={() => {
              const m = defaultModelId(settings.provider);
              if (m) setSettings({ model: m });
            }}
            className="px-3 py-1.5 text-left text-[11.5px] text-fg-muted hover:text-accent rounded-lg"
          >
            Reset to default model
          </button>
        </div>
      </Dropdown>

      <CustomProviderDialog open={manageOpen} onClose={() => setManageOpen(false)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Custom provider manager dialog (add / edit / delete)               */
/* ------------------------------------------------------------------ */

const inputCls =
  "w-full rounded-lg border border-border bg-bg-subtle px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50";

function parseModelsText(text: string): { id: string; name?: string; supportsThinking?: boolean }[] {
  const out: { id: string; name?: string; supportsThinking?: boolean }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const supportsThinking = line.endsWith("*");
    const body = supportsThinking ? line.slice(0, -1).trim() : line;
    const [id, ...nameParts] = body.split("|");
    const idClean = id.trim();
    if (!idClean) continue;
    const name = nameParts.join("|").trim();
    out.push({
      id: idClean,
      name: name && name !== idClean ? name : undefined,
      supportsThinking,
    });
  }
  return out;
}

function modelsToText(models: { id: string; name?: string; supportsThinking?: boolean }[]): string {
  return models
    .map((m) => `${m.id}${m.name && m.name !== m.id ? `|${m.name}` : ""}${m.supportsThinking ? "*" : ""}`)
    .join("\n");
}

function CustomProviderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const customProviders = useAppStore((s) => s.customProviders);
  const saveCustomProvider = useAppStore((s) => s.saveCustomProvider);
  const removeCustomProvider = useAppStore((s) => s.removeCustomProvider);
  const setSettings = useAppStore((s) => s.setSettings);
  const settings = useAppStore((s) => s.settings);

  const [mode, setMode] = React.useState<"list" | "form">("list");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    name: "",
    glyph: "",
    protocol: "openai" as ProviderProtocol,
    baseUrl: "",
    apiKey: "",
    apiKeyEnv: "",
    modelsText: "",
  });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setMode("list");
      setEditingId(null);
      setErr(null);
    }
  }, [open]);

  const beginAdd = () => {
    setEditingId(null);
    setForm({ name: "", glyph: "", protocol: "openai", baseUrl: "", apiKey: "", apiKeyEnv: "", modelsText: "" });
    setErr(null);
    setMode("form");
  };

  const beginEdit = (p: PublicCustomProvider) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      glyph: p.glyph || "",
      protocol: normProtocol(p.protocol),
      baseUrl: p.baseUrl,
      apiKey: "",
      apiKeyEnv: p.apiKeyEnv || "",
      modelsText: modelsToText(p.models),
    });
    setErr(null);
    setMode("form");
  };

  const remove = async (p: PublicCustomProvider) => {
    await removeCustomProvider(p.id);
    if (mode === "list") setMode("list");
  };

  const baseUrlPlaceholder = PROTOCOL_META[form.protocol].baseUrlPlaceholder;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const baseUrl = form.baseUrl.trim().replace(/\/+$/, "");
    const models = parseModelsText(form.modelsText);
    if (!name) return setErr("Give the provider a name.");
    if (!/^https?:\/\/.+/i.test(baseUrl))
      return setErr(PROTOCOL_META[form.protocol].error);
    if (!models.length) return setErr("List at least one model id.");

    setBusy(true);
    setErr(null);
    try {
      const saved = await saveCustomProvider({
        id: editingId || undefined,
        name,
        glyph: form.glyph.trim(),
        baseUrl,
        protocol: form.protocol,
        apiKey: form.apiKey.trim(),
        apiKeyEnv: form.apiKeyEnv.trim(),
        models,
      });
      if (!editingId) {
        // brand-new provider → jump straight to its first model
        const first = saved.models[0];
        setSettings({
          provider: saved.id as ProviderId,
          model: first?.id || "",
          thinking: settings.thinking && (first?.supportsThinking ?? true),
        });
      }
      setMode("list");
      setEditingId(null);
    } catch (e: any) {
      setErr(e.message || "Failed to save provider.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Custom providers"
      subtitle="Endpoints you configure yourself: OpenAI-, Anthropic- or Gemini-compatible (e.g. Groq, OpenRouter, a Claude Code gateway like agentrouter, Google's Interactions API, a local vLLM server)."
      width="max-w-lg"
    >
      {mode === "list" ? (
        <div>
          {customProviders.length === 0 ? (
            <p className="text-[13px] text-fg-muted">
              No custom providers yet. Add one to point Omnia at any OpenAI-,
              Anthropic- or Gemini-compatible API.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {customProviders.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-bg-subtle/50 px-3 py-2"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bg-inset text-[13px]">
                    {p.glyph || "◆"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-fg">
                      {p.name}
                      {settings.provider === p.id && (
                        <span className="ml-1.5 text-[10px] uppercase text-accent">
                          ● in use
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-fg-muted">
                      {PROTOCOL_META[normProtocol(p.protocol)].short}
                      {" · "}
                      {p.models.length} model{p.models.length === 1 ? "" : "s"}
                      {p.hasApiKey ? " · key set" : " · no key"}
                    </p>
                  </div>
                  <IconButton title="Edit" onClick={() => beginEdit(p)}>
                    <Pencil size={14} />
                  </IconButton>
                  <IconButton
                    title="Delete"
                    onClick={() => void remove(p)}
                    className="hover:text-danger"
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}

          <Button variant="outline" className="mt-4 w-full" onClick={beginAdd}>
            <Plus size={14} /> Add custom provider
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_64px] gap-2">
            <div>
              <label className="mb-1 block text-[11.5px] font-medium text-fg-secondary">
                Name
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Groq"
                className={inputCls}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-medium text-fg-secondary">
                Glyph
              </label>
              <input
                value={form.glyph}
                onChange={(e) => setForm({ ...form, glyph: e.target.value })}
                placeholder="◆"
                maxLength={2}
                className={cn(inputCls, "text-center")}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-fg-secondary">
              API format
            </label>
            <select
              value={form.protocol}
              onChange={(e) =>
                setForm({ ...form, protocol: e.target.value as ProviderProtocol })
              }
              className={cn(inputCls, "cursor-pointer")}
            >
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">
                Anthropic-compatible (Claude Code style)
              </option>
              <option value="gemini">Google Gemini (native Interactions API)</option>
            </select>
            <p className="mt-1 text-[11px] text-fg-muted">
              {PROTOCOL_META[form.protocol].blurb}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-fg-secondary">
              Base URL <span className="text-danger">*</span>
            </label>
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder={baseUrlPlaceholder}
              spellCheck={false}
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-fg-secondary">
              API key
            </label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="sk-… (stored server-side; leave blank for a local endpoint)"
              className={inputCls}
              spellCheck={false}
            />
            <p className="mt-1 text-[11px] text-fg-muted">
              …or reference a server env var instead:
            </p>
            <input
              value={form.apiKeyEnv}
              onChange={(e) => setForm({ ...form, apiKeyEnv: e.target.value })}
              placeholder="MY_API_KEY (env var name)"
              className={cn(inputCls, "mt-1")}
              spellCheck={false}
            />
          </div>

          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-fg-secondary">
              Models <span className="text-danger">*</span>
            </label>
            <textarea
              value={form.modelsText}
              onChange={(e) => setForm({ ...form, modelsText: e.target.value })}
              rows={4}
              placeholder={
                "One model per line:\nllama-3.3-70b-versatile|Llama 3.3 70B\nqwen/qwen-2.5-72b-instruct\nmy-reasoning-model*    (* = supports thinking)"
              }
              className={cn(inputCls, "resize-y font-mono text-[12.5px] leading-relaxed")}
              spellCheck={false}
            />
          </div>

          {err && <p className="text-[12.5px] text-danger">{err}</p>}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            {editingId && (
              <span className="mr-auto text-[11px] text-fg-muted">
                Editing {editingId} — same id will be updated.
              </span>
            )}
            <Button variant="ghost" type="button" onClick={() => setMode("list")}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy && <Spinner size={13} className="text-white" />}
              {editingId ? "Save changes" : "Add provider"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
