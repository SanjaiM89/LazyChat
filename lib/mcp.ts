import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { jsonSchema, tool, type Schema, type ToolSet } from "ai";
import type { MCPServerDef, MCPToolInfo } from "@/lib/types";
import { readScoped, writeScoped } from "@/lib/store";
import { currentUser } from "@/lib/auth/context";
import { scopeKey } from "@/lib/auth/server";


interface Session {
  client: Client;
  def: MCPServerDef;
  tools: MCPToolInfo[];
}

/** Connections are keyed per org/user so tenants never see or call each other's servers. */
const sessions = new Map<string, Session>();

function scopeId(): string {
  const u = currentUser();
  return u ? scopeKey(u) : "global";
}
const skey = (id: string) => `${scopeId()}::${id}`;
function mine(): Session[] {
  const prefix = `${scopeId()}::`;
  return [...sessions].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
}

export async function listMCPServers(): Promise<MCPServerDef[]> {
  const data = await readScoped<MCPServerDef[]>("mcp-servers.json", []);
  return data.map((d) => {
    const s = sessions.get(skey(d.id));
    return { ...d, status: s ? "connected" : d.status || "disconnected" };
  });
}

export async function saveMCPServers(servers: MCPServerDef[]): Promise<void> {
  await writeScoped("mcp-servers.json", servers);
}

function stdioEnv(def: MCPServerDef): Record<string, string> {
  return { ...(def.env || {}) };
}

export async function connectMCPServer(def: MCPServerDef): Promise<{
  ok: boolean;
  error?: string;
  tools?: MCPToolInfo[];
}> {
  await disconnectMCPServer(def.id);
  try {
    const client = new Client(
      { name: "omnia-app", version: "0.1.0" },
      { capabilities: {} },
    );

    let transport;
    if (def.type === "stdio") {
      if (!def.command) throw new Error("stdio servers need a command");
      transport = new StdioClientTransport({
        command: def.command,
        args: def.args || [],
        env: stdioEnv(def),
      });
    } else {
      if (!def.url) throw new Error("http servers need a URL");
      transport = new StreamableHTTPClientTransport(new URL(def.url));
    }

    await client.connect(transport);
    const list = await client.listTools();

    const tools: MCPToolInfo[] = (list.tools || []).map((t) => ({
      serverId: def.id,
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema as Record<string, unknown>) || {},
    }));

    sessions.set(skey(def.id), { client, def: { ...def, status: "connected" }, tools });

    const servers = await listMCPServers();
    const updated = servers.map((s) =>
      s.id === def.id ? { ...s, status: "connected" as const, tools: tools.map((t) => t.name) } : s,
    );
    await writeScoped("mcp-servers.json", updated);

    return { ok: true, tools };
  } catch (e: any) {
    const servers = await readScoped<MCPServerDef[]>("mcp-servers.json", []);
    const updated = servers.map((s) =>
      s.id === def.id ? { ...s, status: "error" as const, error: e.message } : s,
    );
    await writeScoped("mcp-servers.json", updated);
    return { ok: false, error: e.message };
  }
}

export async function disconnectMCPServer(id: string): Promise<void> {
  const s = sessions.get(skey(id));
  if (s) {
    try {
      await s.client.close();
    } catch {
    }
    sessions.delete(skey(id));
  }
}

export async function allMCPTools(): Promise<MCPToolInfo[]> {
  const out: MCPToolInfo[] = [];
  for (const s of mine()) out.push(...s.tools);
  return out;
}

export interface MCPResourceInfo {
  server: string;
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPResourceTemplateInfo {
  server: string;
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** Every resource the connected MCP servers offer. */
export async function listMCPResources(): Promise<MCPResourceInfo[]> {
  const out: MCPResourceInfo[] = [];
  for (const s of mine()) {
    try {
      const res = await s.client.listResources();
      for (const r of res.resources ?? []) {
        out.push({
          server: s.def.name,
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        });
      }
    } catch {
      // A server that does not implement resources simply has none.
    }
  }
  return out;
}

/** Every resource template the connected MCP servers offer. */
export async function listMCPResourceTemplates(): Promise<MCPResourceTemplateInfo[]> {
  const out: MCPResourceTemplateInfo[] = [];
  for (const s of mine()) {
    try {
      const res = await s.client.listResourceTemplates();
      for (const t of res.resourceTemplates ?? []) {
        out.push({
          server: s.def.name,
          uriTemplate: t.uriTemplate,
          name: t.name,
          description: t.description,
          mimeType: t.mimeType,
        });
      }
    } catch {
      // As above: a server without templates has none.
    }
  }
  return out;
}

/** Read one resource from a connected server. */
export async function readMCPResource(
  server: string,
  uri: string,
): Promise<{ contents: unknown } | { error: string }> {
  const session = mine().find((s) => s.def.name === server || s.def.id === server);
  if (!session) return { error: `No connected MCP server called "${server}".` };
  try {
    const res = await session.client.readResource({ uri });
    return { contents: res.contents };
  } catch (e) {
    return { error: (e as Error).message || "The resource could not be read." };
  }
}

export async function buildMCPToolSet(): Promise<ToolSet> {
  const set: ToolSet = {};
  for (const s of mine()) {
    for (const t of s.tools) {
      const inputSchema = (t.inputSchema || {}) as Record<string, unknown>;
      // The server name is part of the tool name: two servers that expose the
      // same tool must not collide, so the model can tell them apart.
      const exposed = `${s.def.name}__${t.name}`;
      set[exposed] = tool({
        description: `[MCP:${s.def.name}] ${t.description || t.name}`,
        inputSchema: jsonSchema(inputSchema as any) as Schema<Record<string, unknown>>,
        execute: async (args: Record<string, unknown>) => {
          try {
            const res = await s.client.callTool({
              name: t.name,
              arguments: args,
            });
            return formatMCPResult(res);
          } catch (e: any) {
            return `MCP tool error: ${e.message}`;
          }
        },
      });
    }
  }
  return set;
}

function formatMCPResult(res: any): string {
  const parts: string[] = [];
  if (res.content) {
    for (const c of Array.isArray(res.content) ? res.content : [res.content]) {
      if (c.type === "text") parts.push(c.text);
      else if (c.type === "image" && c.data) parts.push(`[image ${c.mimeType}]`);
      else if (c.type === "resource") parts.push(`[resource ${c.uri}]`);
      else parts.push(JSON.stringify(c));
    }
  }
  if (res.isError) {
    return `[MCP error] ${parts.join("\n")}`;
  }
  return parts.join("\n");
}
