/**
 * Workspace + shared memory as an MCP server for harness agents.
 *
 * Mounted into every spawned run via the bridge overlay, so dsh agents get
 * tool selection through MCP: recall workspace/global memory, store what they
 * learn (with scope tags), manage TODOs, and record plans/decisions/errors.
 *
 * Stateless + JSON responses, like /api/brain/mcp.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient } from "@/lib/brain/graph";
import {
  addTodo,
  buildMemoryContext,
  listTodos,
  readWorkspaceRecords,
  recallShared,
  recordCommandRun,
  setTodoStatus,
  storeShared,
  writeWorkspaceRecord,
  type RecordKind,
} from "@/lib/dsh/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function client() {
  await ensureReady();
  return FalkorClient.get();
}

function text(result: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 1).slice(0, 12000) }] };
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "lazychat-memory", version: "1.0.0" },
    {
      instructions:
        "Workspace and shared memory for this coding workspace. Recall before acting " +
        "(memory_recall loads shared global + this workspace; workspace_context loads the full " +
        "briefing); store anything globally useful with scope 'global', workspace-local facts " +
        "with scope 'workspace:<id>'. Secrets are redacted automatically — never try to store credentials.",
    },
  );

  server.tool(
    "memory_recall",
    "Recall shared memory (global scope + one workspace scope), ranked by keyword overlap.",
    { query: z.string(), workspace_id: z.string().optional(), limit: z.number().int().optional() },
    async ({ query, workspace_id, limit }) => {
      const c = await client();
      const mems = await recallShared(c, workspace_id ?? "", query, limit ?? 12);
      return text({ count: mems.length, memories: mems });
    },
  );

  server.tool(
    "memory_store",
    "Store shared memory. Use scope 'global' for cross-workspace knowledge (patterns, fixes, preferences); scope 'workspace:<id>' for local facts. Same slot replaces on conflict; identical content dedups.",
    {
      scope: z.string(),
      kind: z.string(),
      text: z.string(),
      slot: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ scope, kind, text: body, slot, tags }) => {
      const c = await client();
      const mem = await storeShared(c, { scope, kind, text: body, slot, tags });
      return text({ stored: mem });
    },
  );

  server.tool(
    "workspace_context",
    "Full memory briefing for a workspace: shared memory + plans/decisions/errors/preferences/open TODOs, formatted for prompts.",
    { workspace_id: z.string() },
    async ({ workspace_id }) => {
      const c = await client();
      return text({ context: await buildMemoryContext(c, workspace_id) });
    },
  );

  const recordShapes: Record<string, Record<string, z.ZodTypeAny>> = {
    record_plan: { workspace_id: z.string(), title: z.string(), body: z.string(), session_id: z.string().optional() },
    record_decision: { workspace_id: z.string(), title: z.string(), body: z.string(), session_id: z.string().optional() },
    record_error: { workspace_id: z.string(), error: z.string(), fix: z.string(), session_id: z.string().optional() },
    record_summary: { workspace_id: z.string(), session_id: z.string(), summary: z.string() },
  };
  const recordKinds: Record<string, RecordKind> = {
    record_plan: "plan",
    record_decision: "decision",
    record_error: "error",
    record_summary: "summary",
  };
  for (const [name, shape] of Object.entries(recordShapes)) {
    server.tool(name, `Persist a workspace ${recordKinds[name]} record (durable, survives restarts).`, shape, async (args) => {
      const c = await client();
      const { workspace_id, session_id, ...data } = args as Record<string, unknown>;
      const id = await writeWorkspaceRecord(c, workspace_id as string, recordKinds[name], data, session_id as string | undefined);
      return text({ id });
    });
  }

  server.tool("todo_add", "Add a workspace TODO.", { workspace_id: z.string(), text: z.string() }, async ({ workspace_id, text: body }) => {
    const c = await client();
    return text({ todo: await addTodo(c, workspace_id, body) });
  });

  server.tool(
    "todo_set",
    "Set a TODO status.",
    { id: z.string(), status: z.enum(["open", "doing", "done"]) },
    async ({ id, status }) => {
      const c = await client();
      await setTodoStatus(c, id, status);
      return text({ id, status });
    },
  );

  server.tool("todo_list", "List workspace TODOs.", { workspace_id: z.string() }, async ({ workspace_id }) => {
    const c = await client();
    return text({ todos: await listTodos(c, workspace_id) });
  });

  server.tool(
    "command_log",
    "Log an executed command and its output (truncated) to workspace memory.",
    {
      workspace_id: z.string(),
      command: z.string(),
      output: z.string(),
      exit_code: z.number().int(),
      duration_ms: z.number(),
      session_id: z.string().optional(),
    },
    async ({ workspace_id, command, output, exit_code, duration_ms, session_id }) => {
      const c = await client();
      const id = await recordCommandRun(c, workspace_id, command, output, exit_code, duration_ms, session_id);
      return text({ id });
    },
  );

  server.tool(
    "workspace_records",
    "Read workspace records of one kind (plan/decision/change/command/error/dependency/todo/preference/link/summary).",
    { workspace_id: z.string(), kind: z.string(), limit: z.number().int().optional() },
    async ({ workspace_id, kind, limit }) => {
      const c = await client();
      const valid: RecordKind[] = ["plan", "decision", "change", "command", "error", "dependency", "todo", "preference", "link", "summary"];
      if (!valid.includes(kind as RecordKind)) return text({ error: `unknown kind '${kind}'` });
      return text({ records: await readWorkspaceRecords(c, workspace_id, kind as RecordKind, limit ?? 20) });
    },
  );

  return server;
}

export async function POST(request: Request) {
  try {
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await buildServer().connect(transport);
    return await transport.handleRequest(request, { parsedBody: await request.json() });
  } catch (err) {
    console.error(`[dsh] memory mcp failed: ${(err as Error).stack ?? err}`);
    return Response.json({ detail: "internal server error" }, { status: 500 });
  }
}

export async function GET() {
  return Response.json(
    { detail: "Workspace memory MCP endpoint. POST Streamable HTTP (stateless, JSON responses)." },
    { status: 405 },
  );
}
