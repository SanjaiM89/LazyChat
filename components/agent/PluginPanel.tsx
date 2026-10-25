"use client";

import * as React from "react";
import { Boxes, Package, RefreshCw } from "lucide-react";

import { Toggle } from "@/components/ui";

/**
 * The plugin registry, as the user sees it.
 *
 * A plugin is a group of tools the agent may use; a bundle is a group of
 * plugins. Switching one off takes its tools away from the next turn.
 */

interface PluginInfo {
  id: string;
  title: string;
  description: string;
  tools: string[];
  version: string;
  enabled: boolean;
  pinned_to: string | null;
}

interface BundleInfo {
  id: string;
  title: string;
  description: string;
  plugins: string[];
  enabled: boolean;
}

export function PluginPanel() {
  const [plugins, setPlugins] = React.useState<PluginInfo[]>([]);
  const [bundles, setBundles] = React.useState<BundleInfo[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/agent/plugins", { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setPlugins(data.plugins ?? []);
      setBundles(data.bundles ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "The registry could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const setPlugin = React.useCallback(async (id: string, enabled: boolean) => {
    setPlugins((current) => current.map((p) => (p.id === id ? { ...p, enabled } : p)));
    try {
      await fetch("/api/agent/plugins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plugin: id, enabled }),
      });
    } catch {
      void load();
    }
  }, [load]);

  const setBundle = React.useCallback(async (id: string, enabled: boolean) => {
    setBundles((current) => current.map((b) => (b.id === id ? { ...b, enabled } : b)));
    setPlugins((current) =>
      current.map((p) => {
        const bundle = bundles.find((b) => b.id === id);
        return bundle?.plugins.includes(p.id) ? { ...p, enabled } : p;
      }),
    );
    try {
      await fetch("/api/agent/plugins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundle: id, enabled }),
      });
    } catch {
      void load();
    }
  }, [bundles, load]);

  if (loading) {
    return <div className="p-4 text-[12px] text-fg-muted">Reading the registry…</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Package size={15} className="text-fg-muted" />
        <span className="text-[13px] font-medium">Plugins</span>
        <button
          onClick={() => void load()}
          className="ml-auto rounded p-1 text-fg-muted hover:bg-bg-hover hover:text-fg"
          title="Reload"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {error && <div className="px-4 py-2 text-[12px] text-danger">{error}</div>}

      {bundles.length > 0 && (
        <section className="border-b border-border px-4 py-3">
          <div className="eyebrow mb-2">Bundles</div>
          <div className="space-y-2">
            {bundles.map((bundle) => (
              <div key={bundle.id} className="flex items-start gap-3">
                <Toggle
                  checked={bundle.enabled}
                  onChange={(next) => void setBundle(bundle.id, next)}

                />
                <div className="min-w-0">
                  <div className="text-[12px] font-medium">{bundle.title}</div>
                  <div className="text-[11px] leading-relaxed text-fg-muted">{bundle.description}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="px-4 py-3">
        <div className="eyebrow mb-2">Plugins</div>
        <div className="space-y-3">
          {plugins.map((plugin) => (
            <div key={plugin.id} className="flex items-start gap-3">
              <Toggle
                checked={plugin.enabled}
                onChange={(next) => void setPlugin(plugin.id, next)}

              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-medium">{plugin.title}</span>
                  <span className="font-mono text-[10px] text-fg-muted">{plugin.version}</span>
                </div>
                <div className="text-[11px] leading-relaxed text-fg-muted">{plugin.description}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {plugin.tools.slice(0, 6).map((tool) => (
                    <span
                      key={tool}
                      className="rounded border border-border bg-bg-surface-200 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted"
                    >
                      {tool}
                    </span>
                  ))}
                  {plugin.tools.length > 6 && (
                    <span className="text-[10px] text-fg-muted">+{plugin.tools.length - 6} more</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {plugins.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-[12px] text-fg-muted">
          <Boxes size={14} className="mr-2" />
          No plugins registered.
        </div>
      )}
    </div>
  );
}
