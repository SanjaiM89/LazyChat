import { tool } from "ai";
import { z } from "zod";

import { listSkills } from "@/lib/skills";
import {
  listMCPResourceTemplates,
  listMCPResources,
  readMCPResource,
} from "@/lib/mcp";
import { TOOL_CATALOG } from "@/lib/agent/catalog";
import { BUILTIN_PLUGINS, readPluginState, isPluginEnabled } from "@/lib/agent/plugins";
import { appendEvent } from "@/lib/agent/session";

/**
 * The small always-on tools: load a skill, present what was delivered, look
 * at the registry, and read the resources an MCP server offers.
 */
export function buildSkillTools() {
  return {
    skill: tool({
      description:
        "Load a skill's instructions into the conversation. A skill is a named set of steps the user prepared for a " +
        "kind of task; call this when the task matches one of the listed skills.",
      inputSchema: z.object({
        name: z.string().describe("The skill's name, as listed by the skills panel"),
      }),
      execute: async ({ name }) => {
        const skills = await listSkills();
        const wanted = name.toLowerCase();
        const skill =
          skills.find((s) => s.name.toLowerCase() === wanted) ??
          skills.find((s) => s.id === name) ??
          skills.find((s) => s.name.toLowerCase().includes(wanted));
        if (!skill) {
          return {
            error: `There is no skill called "${name}".`,
            available: skills.map((s) => s.name),
          };
        }
        if (!skill.enabled) {
          return { error: `The skill "${skill.name}" is switched off.`, name: skill.name };
        }
        return { name: skill.name, instructions: skill.prompt, source: skill.source ?? null };
      },
    }),
  };
}

export function buildDeliverableTools(conversationId?: string) {
  return {
    present: tool({
      description:
        "Present the finished work: name what was delivered and where it lives. Call this once at the end, when the " +
        "deliverable exists — a file, an artifact, a document, a link.",
      inputSchema: z.object({
        title: z.string().describe("What was delivered, in a few words"),
        summary: z.string().describe("One paragraph describing the deliverable and how to use it"),
        items: z
          .array(
            z.object({
              name: z.string().describe("The name of the item"),
              location: z.string().describe("Where it is: a path, an artifact id, or a URL"),
              kind: z.string().optional().describe("file | artifact | document | link | other"),
            }),
          )
          .optional()
          .describe("The individual pieces that make up the deliverable"),
      }),
      execute: async ({ title, summary, items }) => {
        const payload = { title, summary, items: items ?? [], at: Date.now() };
        if (conversationId) {
          appendEvent("deliverables/presented", payload, { conversationId });
        }
        return { presented: true, ...payload };
      },
    }),
  };
}

export function buildInspectTools() {
  return {
    inspect_list: tool({
      description:
        "List the tools this agent can use, with the family they belong to and what they do. Use it to find the " +
        "right tool for a task before guessing at names.",
      inputSchema: z.object({
        family: z
          .string()
          .optional()
          .describe("Only list the tools of this family, e.g. 'workspace' or 'web'"),
      }),
      execute: async ({ family }) => {
        const state = await readPluginState();
        const plugins = BUILTIN_PLUGINS.filter((p) => isPluginEnabled(state, p.id));
        const names = new Set(plugins.flatMap((p) => p.tools));
        const tools = Object.values(TOOL_CATALOG)
          .filter((meta) => names.has(meta.name))
          .filter((meta) => !family || meta.family === family)
          .map((meta) => ({
            name: meta.name,
            family: meta.family,
            title: meta.title,
            effect: meta.effect,
            plugin: plugins.find((p) => p.tools.includes(meta.name))?.id ?? null,
          }));
        return {
          count: tools.length,
          families: [...new Set(tools.map((t) => t.family))],
          tools,
        };
      },
    }),

    inspect_query: tool({
      description:
        "Look up one tool in detail: what it does, what it may do to the machine, and which plugin provides it.",
      inputSchema: z.object({
        name: z.string().describe("The tool name"),
      }),
      execute: async ({ name }) => {
        const meta = TOOL_CATALOG[name];
        if (!meta) return { error: `There is no tool called "${name}".` };
        const state = await readPluginState();
        const plugin = BUILTIN_PLUGINS.find((p) => p.tools.includes(name));
        return {
          ...meta,
          plugin: plugin?.id ?? null,
          enabled: plugin ? isPluginEnabled(state, plugin.id) : true,
        };
      },
    }),
  };
}

export function buildMCPResourceTools() {
  return {
    mcp_list_resources: tool({
      description: "List the resources the connected MCP servers offer.",
      inputSchema: z.object({
        server: z.string().optional().describe("Only the resources of this server"),
      }),
      execute: async ({ server }) => {
        const resources = await listMCPResources();
        const filtered = server ? resources.filter((r) => r.server === server) : resources;
        return { count: filtered.length, resources: filtered };
      },
    }),

    mcp_list_resource_templates: tool({
      description: "List the resource templates the connected MCP servers offer.",
      inputSchema: z.object({}),
      execute: async () => {
        const templates = await listMCPResourceTemplates();
        return { count: templates.length, templates };
      },
    }),

    mcp_read_resource: tool({
      description: "Read one resource from a connected MCP server.",
      inputSchema: z.object({
        server: z.string().describe("The server's name"),
        uri: z.string().describe("The resource's URI"),
      }),
      execute: async ({ server, uri }) => readMCPResource(server, uri),
    }),
  };
}
