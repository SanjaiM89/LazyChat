import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BUILTIN_BUNDLES,
  BUILTIN_PLUGINS,
  disabledToolNames,
  enabledToolNames,
  isPluginEnabled,
  unclaimedTools,
  type PluginState,
} from "@/lib/agent/plugins";
import { TOOL_CATALOG } from "@/lib/agent/catalog";

const empty: PluginState = { enabled: {}, bundles: {}, exemptions: {} };

test("every plugin tool exists in the catalog", () => {
  for (const plugin of BUILTIN_PLUGINS) {
    for (const tool of plugin.tools) {
      assert.ok(TOOL_CATALOG[tool], `${plugin.id} claims unknown tool ${tool}`);
    }
  }
});

test("every catalog tool is claimed by a plugin", () => {
  const unclaimed = unclaimedTools();
  assert.deepEqual(unclaimed, [], `unclaimed tools: ${unclaimed.join(", ")}`);
});

test("bundles only name plugins that exist", () => {
  const ids = new Set(BUILTIN_PLUGINS.map((p) => p.id));
  for (const [id, bundle] of Object.entries(BUILTIN_BUNDLES)) {
    for (const pluginId of bundle.plugins) {
      assert.ok(ids.has(pluginId), `bundle ${id} names unknown plugin ${pluginId}`);
    }
  }
});

test("a plugin is on until the user switches it off", () => {
  assert.equal(isPluginEnabled(empty, "browser"), true);
  assert.equal(isPluginEnabled({ ...empty, enabled: { browser: false } }, "browser"), false);
});

test("a disabled plugin takes its tools away", () => {
  const state: PluginState = { ...empty, enabled: { browser: false } };
  const disabled = disabledToolNames(state);
  assert.ok(disabled.has("computer_click"));
  assert.ok(!disabled.has("ws_read"));
});

test("switching a plugin off removes it from the enabled set", () => {
  const state: PluginState = { ...empty, enabled: { browser: false } };
  const enabled = enabledToolNames(state);
  assert.ok(!enabled.has("computer_click"));
  assert.ok(enabled.has("web_search"));
});
