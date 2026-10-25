import { authed } from "@/lib/auth/context";
import {
  BUILTIN_BUNDLES,
  BUILTIN_PLUGINS,
  isPluginEnabled,
  readPluginState,
  writePluginState,
} from "@/lib/agent/plugins";

export const dynamic = "force-dynamic";

/** The plugin registry: what there is, and what is switched on. */
export const GET = authed(async () => {
  const state = await readPluginState();
  return Response.json({
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
  });
});

/** Switch a plugin or a bundle on or off. */
export const POST = authed(async (req) => {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const state = await readPluginState();

  if (typeof body.bundle === "string") {
    const bundle = BUILTIN_BUNDLES[body.bundle];
    if (!bundle) return Response.json({ error: `No bundle called "${body.bundle}".` }, { status: 404 });
    const enabled = body.enabled !== false;
    state.bundles[body.bundle] = enabled;
    for (const pluginId of bundle.plugins) state.enabled[pluginId] = enabled;
    await writePluginState(state);
    return Response.json({ bundle: body.bundle, enabled, plugins: bundle.plugins });
  }

  if (typeof body.plugin === "string") {
    const plugin = BUILTIN_PLUGINS.find((p) => p.id === body.plugin);
    if (!plugin) return Response.json({ error: `No plugin called "${body.plugin}".` }, { status: 404 });
    const enabled = body.enabled !== false;
    state.enabled[plugin.id] = enabled;
    await writePluginState(state);
    return Response.json({ plugin: plugin.id, enabled, tools: plugin.tools });
  }

  return Response.json({ error: "Say which plugin or bundle to change." }, { status: 400 });
});
