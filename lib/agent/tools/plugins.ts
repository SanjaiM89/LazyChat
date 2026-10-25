import { tool } from "ai";
import { z } from "zod";

import {
  BUILTIN_BUNDLES,
  BUILTIN_PLUGINS,
  isPluginEnabled,
  readPluginState,
  writePluginState,
} from "@/lib/agent/plugins";

/**
 * The plugin manager, as the model sees it.
 *
 * The model can inspect the registry and switch a capability on or off; the
 * change takes effect from the next turn. The same registry backs the plugin
 * panel in the UI.
 */
export function buildPluginTools() {
  return {
    plugin_list: tool({
      description:
        "List the available plugins and bundles, and whether each is currently on. A plugin is a group of tools " +
        "the agent may use; a bundle is a group of plugins.",
      inputSchema: z.object({}),
      execute: async () => {
        const state = await readPluginState();
        return {
          plugins: BUILTIN_PLUGINS.map((plugin) => ({
            id: plugin.id,
            title: plugin.title,
            description: plugin.description,
            tools: plugin.tools,
            version: plugin.version,
            enabled: isPluginEnabled(state, plugin.id),
            pinned_to: state.exemptions[plugin.id] ?? null,
          })),
          bundles: Object.entries(BUILTIN_BUNDLES).map(([id, bundle]) => ({
            id,
            title: bundle.title,
            description: bundle.description,
            plugins: bundle.plugins,
            enabled: state.bundles[id] !== false,
          })),
        };
      },
    }),

    plugin_set: tool({
      description:
        "Turn a plugin on or off. The tools it contributes are unavailable to the agent until it is on again.",
      inputSchema: z.object({
        id: z.string().describe("The plugin id, e.g. 'browser' or 'web'"),
        enabled: z.boolean().describe("true to turn it on, false to turn it off"),
      }),
      execute: async ({ id, enabled }) => {
        const plugin = BUILTIN_PLUGINS.find((p) => p.id === id);
        if (!plugin) return { error: `There is no plugin called "${id}".` };
        const state = await readPluginState();
        state.enabled[id] = enabled;
        await writePluginState(state);
        return {
          id,
          enabled,
          tools: plugin.tools,
          note: "The change applies from the next turn.",
        };
      },
    }),

    plugin_bundle_set: tool({
      description: "Turn a bundle of plugins on or off.",
      inputSchema: z.object({
        id: z.string().describe("The bundle id, e.g. 'research'"),
        enabled: z.boolean(),
      }),
      execute: async ({ id, enabled }) => {
        const bundle = BUILTIN_BUNDLES[id];
        if (!bundle) return { error: `There is no bundle called "${id}".` };
        const state = await readPluginState();
        state.bundles[id] = enabled;
        for (const pluginId of bundle.plugins) {
          state.enabled[pluginId] = enabled;
        }
        await writePluginState(state);
        return { id, enabled, plugins: bundle.plugins };
      },
    }),

    plugin_exemption_list: tool({
      description: "List the version pins the user set on plugins.",
      inputSchema: z.object({}),
      execute: async () => {
        const state = await readPluginState();
        return { exemptions: state.exemptions };
      },
    }),

    plugin_exemption_set: tool({
      description:
        "Pin a plugin to a version, or release the pin. A pinned plugin keeps its version when the app updates.",
      inputSchema: z.object({
        id: z.string().describe("The plugin id"),
        version: z.string().nullable().describe("The version to pin, or null to release the pin"),
      }),
      execute: async ({ id, version }) => {
        if (!BUILTIN_PLUGINS.some((p) => p.id === id)) {
          return { error: `There is no plugin called "${id}".` };
        }
        const state = await readPluginState();
        if (version) state.exemptions[id] = version;
        else delete state.exemptions[id];
        await writePluginState(state);
        return { id, version: state.exemptions[id] ?? null };
      },
    }),
  };
}
