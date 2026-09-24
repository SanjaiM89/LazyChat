"use client";

import * as React from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { Modal, Button, IconButton, Spinner } from "@/components/ui";
import { PROVIDER_LIST } from "@/lib/models";
import { useAppStore } from "@/lib/app-store";

/* ------------------------------------------------------------------ */
/*  API keys dialog — paste keys for built-in providers (OpenCode Zen, */
/*  Anthropic, …). Saved server-side in data/provider-keys.json and    */
/*  used with priority over env vars. The raw key never leaves the      */
/*  server; the client only sees configured/source status.              */
/* ------------------------------------------------------------------ */

const HELP_LINKS: Record<string, { label: string; href: string }> = {
  opencode: { label: "Get a key at opencode.ai/auth", href: "https://opencode.ai/auth" },
};

export function ApiKeysDialog() {
  const open = useAppStore((s) => s.apiKeysOpen);
  const setOpen = useAppStore((s) => s.setApiKeysOpen);
  const status = useAppStore((s) => s.providerKeyStatus);
  const loadStatus = useAppStore((s) => s.loadProviderKeys);

  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<Record<string, any[]>>({});
  const [editing, setEditing] = React.useState<Record<string, { oldId: string; id: string; name: string }>>({});
  const [newModel, setNewModel] = React.useState<Record<string, { id: string; name: string }>>({});

  const loadModels = React.useCallback(async () => {
    try {
      const res = await fetch("/api/provider-models", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const out: Record<string, any[]> = {};
      for (const [pid, v] of Object.entries<any>(data)) {
        out[pid] = Array.isArray(v?.effective) ? v.effective : [];
      }
      setModels(out);
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      setDrafts({});
      setErr(null);
      void loadStatus();
      void loadModels();
    }
  }, [open, loadStatus, loadModels]);

  const keyed = React.useMemo(() => {
    const list = PROVIDER_LIST.filter((p) => p.requiresKey && p.keyEnv);
    return [
      ...list.filter((p) => p.id === "opencode"),
      ...list.filter((p) => p.id !== "opencode"),
    ];
  }, []);

  const save = async (id: string) => {
    const apiKey = (drafts[id] || "").trim();
    if (!apiKey || busy) return;
    setBusy(id);
    setErr(null);
    try {
      const res = await fetch("/api/provider-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: id, apiKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save key.");
      setDrafts((d) => ({ ...d, [id]: "" }));
      await loadStatus();
    } catch (e: any) {
      setErr(e.message || "Failed to save key.");
    } finally {
      setBusy(null);
    }
  };

  const clear = async (id: string) => {
    if (busy) return;
    setBusy(id);
    setErr(null);
    try {
      await fetch(`/api/provider-keys?provider=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await loadStatus();
    } catch (e: any) {
      setErr(e.message || "Failed to clear key.");
    } finally {
      setBusy(null);
    }
  };

  const saveModel = async (provider: string) => {
    const draft = newModel[provider];
    const id = (draft?.id || "").trim();
    if (!id || busy) return;
    setBusy(`${provider}-model`);
    setErr(null);
    try {
      const res = await fetch("/api/provider-models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, id, name: (draft?.name || "").trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to add model.");
      setModels((m) => ({ ...m, [provider]: data.effective || m[provider] }));
      setNewModel((m) => ({ ...m, [provider]: { id: "", name: "" } }));
    } catch (e: any) {
      setErr(e.message || "Failed to add model.");
    } finally {
      setBusy(null);
    }
  };

  const renameModel = async (provider: string) => {
    const e = editing[provider];
    if (!e?.oldId || !(e.id || "").trim() || busy) return;
    setBusy(`${provider}-rename`);
    setErr(null);
    try {
      const res = await fetch("/api/provider-models", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          oldId: e.oldId,
          id: e.id.trim(),
          name: e.name.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to rename model.");
      setModels((m) => ({ ...m, [provider]: data.effective || m[provider] }));
      setEditing((m) => {
        const next = { ...m };
        delete next[provider];
        return next;
      });
    } catch (err: any) {
      setErr(err.message || "Failed to rename model.");
    } finally {
      setBusy(null);
    }
  };

  const removeModel = async (provider: string, id: string) => {
    if (busy) return;
    setBusy(`${provider}-del`);
    try {
      const res = await fetch(
        `/api/provider-models?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) setModels((m) => ({ ...m, [provider]: data.effective || m[provider] }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="API keys"
      subtitle="Keys are stored on this server only (data/provider-keys.json) and take priority over env vars. Nothing secret is ever sent to the browser."
      width="max-w-lg"
    >
      <ul className="flex flex-col gap-2.5">
        {keyed.map((p) => {
          const st = status[p.id];
          const configured = st?.configured ?? false;
          const stored = st?.source === "stored";
          const viaEnv = st?.source === "env";
          const help = HELP_LINKS[p.id];
          return (
            <li
              key={p.id}
              className="rounded-xl border border-border bg-bg-subtle/50 px-3.5 py-3"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-inset text-[14px] text-accent">
                  {p.glyph}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-fg">{p.name}</p>
                  <p className="truncate text-[11px] text-fg-muted">
                    {p.keyEnv}
                    {help ? (
                      <>
                        {" · "}
                        <a
                          href={help.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline"
                        >
                          {help.label}
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
                <span
                  className={
                    configured
                      ? "shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success"
                      : "shrink-0 rounded-full bg-bg-inset px-2 py-0.5 text-[11px] font-medium text-fg-muted"
                  }
                  title={
                    stored
                      ? "Key saved in the app"
                      : viaEnv
                        ? `Key comes from the ${p.keyEnv} env var`
                        : "No key configured"
                  }
                >
                  {configured ? (stored ? "● saved" : "● via env") : "○ missing"}
                </span>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                <input
                  type="password"
                  value={drafts[p.id] || ""}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void save(p.id);
                  }}
                  placeholder={
                    stored
                      ? "Saved — paste a new key to replace it"
                      : `Paste ${p.name} key…`
                  }
                  spellCheck={false}
                  autoComplete="off"
                  className="flex-1 rounded-lg border border-border bg-bg-subtle px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
                />
                <Button
                  variant="primary"
                  onClick={() => void save(p.id)}
                  disabled={busy === p.id || !(drafts[p.id] || "").trim()}
                >
                  {busy === p.id ? <Spinner size={13} className="text-white" /> : <KeyRound size={14} />}
                  Save
                </Button>
                {stored && (
                  <IconButton
                    title="Remove the saved key (falls back to env var)"
                    onClick={() => void clear(p.id)}
                    className="hover:text-danger"
                  >
                    <Trash2 size={14} />
                  </IconButton>
                )}
              </div>

              {/* Models: rename / add / remove ids (e.g. retired Gemini ids) */}
              <div className="mt-2.5 rounded-lg border border-border/70 bg-bg-elevated/60 px-2.5 py-2">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                  Models — rename or add ids
                </p>
                <div className="flex flex-col gap-1">
                  {(models[p.id] || []).map((m: any) => {
                    const ed = editing[p.id];
                    const isEd = ed?.oldId === m.id;
                    return (
                      <div key={m.id} className="flex items-center gap-1.5">
                        {isEd ? (
                          <>
                            <input
                              value={ed.id}
                              onChange={(e) =>
                                setEditing((s) => ({
                                  ...s,
                                  [p.id]: { ...ed, id: e.target.value },
                                }))
                              }
                              placeholder="model id"
                              spellCheck={false}
                              className="min-w-0 flex-1 rounded-md border border-border bg-bg-subtle px-2 py-1 font-mono text-[12px] text-fg focus:outline-none focus:border-accent/50"
                            />
                            <input
                              value={ed.name}
                              onChange={(e) =>
                                setEditing((s) => ({
                                  ...s,
                                  [p.id]: { ...ed, name: e.target.value },
                                }))
                              }
                              placeholder="label (optional)"
                              spellCheck={false}
                              className="min-w-0 flex-1 rounded-md border border-border bg-bg-subtle px-2 py-1 text-[12px] text-fg focus:outline-none focus:border-accent/50"
                            />
                            <Button
                              variant="primary"
                              onClick={() => void renameModel(p.id)}
                              disabled={busy === `${p.id}-rename` || !(ed.id || "").trim()}
                              className="!px-2 !py-1 !text-[12px]"
                            >
                              Save
                            </Button>
                            <button
                              onClick={() =>
                                setEditing((s) => {
                                  const next = { ...s };
                                  delete next[p.id];
                                  return next;
                                })
                              }
                              className="rounded-md px-1.5 py-1 text-[12px] text-fg-muted hover:text-fg"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-secondary" title={m.id}>
                              {m.id}
                              {m.name && m.name !== m.id && (
                                <span className="ml-1.5 font-sans text-fg-muted">· {m.name}</span>
                              )}
                            </span>
                            <button
                              onClick={() =>
                                setEditing((s) => ({
                                  ...s,
                                  [p.id]: { oldId: m.id, id: m.id, name: m.name || "" },
                                }))
                              }
                              className="rounded-md px-1.5 py-1 text-[12px] text-fg-muted hover:text-accent"
                              title="Rename model id"
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => void removeModel(p.id, m.id)}
                              className="rounded-md px-1.5 py-1 text-[12px] text-fg-muted hover:text-danger"
                              title="Remove / hide this model id"
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <input
                    value={newModel[p.id]?.id || ""}
                    onChange={(e) =>
                      setNewModel((s) => ({
                        ...s,
                        [p.id]: { id: e.target.value, name: s[p.id]?.name || "" },
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveModel(p.id);
                    }}
                    placeholder="Add model id (e.g. gemini-3.5-flash-lite)"
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded-md border border-border bg-bg-subtle px-2 py-1 font-mono text-[12px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
                  />
                  <input
                    value={newModel[p.id]?.name || ""}
                    onChange={(e) =>
                      setNewModel((s) => ({
                        ...s,
                        [p.id]: { id: s[p.id]?.id || "", name: e.target.value },
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveModel(p.id);
                    }}
                    placeholder="Label (optional)"
                    spellCheck={false}
                    className="w-28 rounded-md border border-border bg-bg-subtle px-2 py-1 text-[12px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
                  />
                  <Button
                    variant="outline"
                    onClick={() => void saveModel(p.id)}
                    disabled={busy === `${p.id}-model` || !(newModel[p.id]?.id || "").trim()}
                    className="!px-2 !py-1 !text-[12px]"
                  >
                    Add
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {err && <p className="mt-3 text-[12.5px] text-danger">{err}</p>}
      <p className="mt-3 text-[11.5px] leading-relaxed text-fg-muted">
        Tip: keys in <span className="font-mono">.env</span> keep working — a key
        saved here simply overrides them. Restarting is never required.
      </p>
    </Modal>
  );
}
