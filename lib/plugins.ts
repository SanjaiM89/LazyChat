import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";

import { readJSON, writeJSON } from "@/lib/store";

export interface PluginDef {
  id: string;
  name: string;
  description?: string;
  /** 'builtin' | 'local' | 'npm' — where the plugin lives. */
  source: "builtin" | "local" | "npm";
  enabled: boolean;
  /** Path or npm package for local/npm plugins. */
  path?: string;
  entry?: string;
  createdAt: number;
  updatedAt: number;
}

const PLUGINS_FILE = "plugins.json";

async function loadPlugins(): Promise<PluginDef[]> {
  return readJSON<PluginDef[]>(PLUGINS_FILE, []);
}

async function savePlugins(plugins: PluginDef[]): Promise<void> {
  await writeJSON(PLUGINS_FILE, plugins);
}

// Built-in plugins that ship with Omnia and can't be deleted.
const BUILTIN_PLUGINS: PluginDef[] = [
  {
    id: "omnia-memory",
    name: "Omnia Memory",
    description: "FalkorDB-backed memory for workspace and session context",
    source: "builtin",
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: "omnia-agents",
    name: "Agent Orchestration",
    description: "Docker-sandboxed agent spawning and management",
    source: "builtin",
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

/** Ensure builtin plugins exist in the config. */
async function ensureBuiltins(): Promise<PluginDef[]> {
  const all = await loadPlugins();
  for (const bp of BUILTIN_PLUGINS) {
    if (!all.find((p) => p.id === bp.id)) {
      all.push(bp);
    }
  }
  await savePlugins(all);
  return all;
}

export function buildPluginManagerTool() {
  return {
    plugin_manager: tool({
      description: `Manage Omnia plugins: list, enable, disable, install, or uninstall. Built-in plugins provide core capabilities (memory, agents). Local plugins live on disk; npm plugins are installed from the registry. Use 'list' to see all plugins and their status.`,
      inputSchema: z.object({
        action: z.enum(["list", "enable", "disable", "install", "uninstall"]).describe("Action to perform"),
        id: z.string().optional().describe("Plugin id (for enable/disable/uninstall)"),
        name: z.string().optional().describe("Plugin name (for install)"),
        path: z.string().optional().describe("Plugin path or npm package (for install)"),
        source: z.enum(["local", "npm"]).optional().describe("Source type for install"),
      }),
      execute: async ({ action, id, name, path, source }) => {
        let plugins = await ensureBuiltins();

        switch (action) {
          case "list":
            return {
              plugins: plugins.map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                source: p.source,
                enabled: p.enabled,
                path: p.path,
              })),
            };

          case "enable":
          case "disable": {
            if (!id) return { error: "id is required for enable/disable" };
            const idx = plugins.findIndex((p) => p.id === id);
            if (idx === -1) return { error: `Plugin not found: ${id}` };
            if (plugins[idx].source === "builtin") {
              // Allow toggling builtins
              plugins[idx].enabled = action === "enable";
              plugins[idx].updatedAt = Date.now();
              await savePlugins(plugins);
              return { plugin: { id, enabled: plugins[idx].enabled } };
            }
            plugins[idx].enabled = action === "enable";
            plugins[idx].updatedAt = Date.now();
            await savePlugins(plugins);
            return { plugin: { id, enabled: plugins[idx].enabled } };
          }

          case "install": {
            if (!name || !path) return { error: "name and path are required for install" };
            const existing = plugins.find((p) => p.id === name);
            if (existing) {
              return { error: `Plugin already exists: ${name}. Use enable/disable instead.` };
            }
            const p: PluginDef = {
              id: name,
              name: name,
              path,
              source: source || "local",
              enabled: true,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            plugins.push(p);
            await savePlugins(plugins);
            return { plugin: { id: p.id, name: p.name, enabled: p.enabled } };
          }

          case "uninstall": {
            if (!id) return { error: "id is required for uninstall" };
            const idx = plugins.findIndex((p) => p.id === id);
            if (idx === -1) return { error: `Plugin not found: ${id}` };
            if (plugins[idx].source === "builtin") {
              return { error: "Cannot uninstall built-in plugins." };
            }
            plugins.splice(idx, 1);
            await savePlugins(plugins);
            return { uninstalled: id };
          }

          default:
            return { error: `Unknown action: ${action}` };
        }
      },
    }),
  };
}
