import { tool } from "ai";
import { z } from "zod";

import { readScoped, writeScoped } from "@/lib/store";
import { LspClient, LSP_OPERATIONS, MAX_LOCATIONS, serverFor, type LspServerConfig } from "@/lib/agent/lsp";

/**
 * The `lsp` tool: precise code navigation.
 *
 * Which language server answers is the user's choice — the configuration maps
 * a file extension to a command. Without one the tool says exactly what to
 * configure; it never guesses.
 */

const CONFIG_FILE = "lsp-servers.json";

export async function readLspServers(): Promise<Record<string, LspServerConfig>> {
  const stored = await readScoped<Record<string, LspServerConfig>>(CONFIG_FILE, {});
  const out: Record<string, LspServerConfig> = {};
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (value && typeof value.command === "string" && value.command.trim()) {
      out[key] = value;
    }
  }
  return out;
}

export async function writeLspServers(servers: Record<string, LspServerConfig>): Promise<void> {
  await writeScoped(CONFIG_FILE, servers);
}

export function buildLspTools(ctx: { cwd?: string }) {
  return {
    lsp: tool({
      description:
        "Query a language server for precise code navigation. operation is one of goToDefinition, " +
        "findReferences, goToImplementation, hover. line and character are one-based UTF-16 cursor " +
        "coordinates. findReferences includes the declaration. Needs an attached workspace and a " +
        "configured language server for the file's type.",
      inputSchema: z.object({
        operation: z
          .enum(["goToDefinition", "findReferences", "goToImplementation", "hover"])
          .describe("What to ask the server."),
        file_path: z.string().describe("The source file, relative to the workspace or absolute."),
        line: z.number().int().min(1).describe("One-based line of the cursor."),
        character: z.number().int().min(1).describe("One-based UTF-16 column of the cursor."),
      }),
      execute: async ({ operation, file_path, line, character }) => {
        if (!ctx.cwd) {
          return {
            error:
              "The lsp tool needs a workspace: attach a folder to this chat so the server has a " +
              "project to look at.",
          };
        }
        const servers = await readLspServers();
        const config = serverFor(servers, file_path);
        if (!config) {
          const extension = file_path.split(".").pop() ?? "";
          return {
            error:
              `No language server is configured for ".${extension}" files. Configure one (for ` +
              `example: typescript-language-server --stdio for "ts") and this tool will work.`,
            configured: Object.keys(servers),
          };
        }

        const client = new LspClient(config, ctx.cwd);
        try {
          const locations = await client.query(operation, file_path, line, character);
          const rendered = locations.slice(0, MAX_LOCATIONS).map((location) => ({
            file: location.file,
            line: location.line,
            character: location.character,
            ...(location.text ? { text: location.text.slice(0, 4000) } : {}),
          }));
          return {
            operation,
            count: rendered.length,
            locations: rendered,
          };
        } catch (e) {
          return { error: (e as Error).message || "The language server did not answer." };
        } finally {
          await client.stop();
        }
      },
    }),

    lsp_servers: tool({
      description:
        "List the configured language servers, or set one for a file extension. Setting one is how the " +
        "lsp tool gets to work: the command must speak LSP over stdio.",
      inputSchema: z.object({
        extension: z
          .string()
          .optional()
          .describe("The file extension to configure, e.g. 'ts'. Omit to only list."),
        command: z.string().optional().describe("The command to run, e.g. 'typescript-language-server'"),
        args: z.array(z.string()).optional().describe("Its arguments, e.g. ['--stdio']"),
        remove: z.boolean().optional().describe("Remove the server for this extension"),
      }),
      execute: async ({ extension, command, args, remove }) => {
        const servers = await readLspServers();
        if (!extension) {
          return { count: Object.keys(servers).length, servers };
        }
        const key = extension.replace(/^\./, "").toLowerCase();
        if (remove) {
          delete servers[key];
          await writeLspServers(servers);
          return { extension: key, removed: true };
        }
        if (!command) {
          return { extension: key, configured: servers[key] ?? null, servers };
        }
        servers[key] = { command, ...(args?.length ? { args } : {}) };
        await writeLspServers(servers);
        return { extension: key, configured: servers[key] };
      },
    }),
  };
}
