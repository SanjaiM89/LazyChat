/**
 * Company Brain as an MCP server (Track 1: "tool selection through MCP").
 *
 * Any MCP-capable agent — Claude Code, inspector, another framework — can
 * connect here and drive the same tool registry the built-in agent uses:
 * graph reads, graph algorithms, memory-aware answers, and graph *actions*
 * (file/assign tickets, record decisions, map open facts).
 *
 * Stateless + JSON responses: no session bookkeeping, works behind any proxy.
 * Mount point: POST /api/brain/mcp  (Accept: application/json, text/event-stream)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { compact, execute, REGISTRY, type InputSchema } from "@/lib/brain/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Narrow subset of JSON Schema our tool specs use → zod. */
function toZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const description = typeof schema.description === "string" ? schema.description : undefined;
  const withDesc = (inner: z.ZodTypeAny): z.ZodTypeAny => {
    if (description && typeof (inner as { describe?: unknown }).describe === "function") {
      return (inner as unknown as { describe: (d: string) => z.ZodTypeAny }).describe(description);
    }
    return inner;
  };
  const wrapDefault = (inner: z.ZodTypeAny): z.ZodTypeAny => {
    if (schema.default !== undefined) return inner.default(schema.default);
    return inner.optional();
  };
  switch (schema.type) {
    case "integer":
      return wrapDefault(withDesc(z.number().int()));
    case "number":
      return wrapDefault(withDesc(z.number()));
    case "boolean":
      return wrapDefault(withDesc(z.boolean()));
    case "array": {
      const items = toZod((schema.items ?? { type: "string" }) as Record<string, unknown>);
      return wrapDefault(withDesc(z.array(items)));
    }
    case "object": {
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, sub] of Object.entries(props)) shape[key] = toZod(sub);
      const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
      const requiredShape: Record<string, z.ZodTypeAny> = {};
      for (const [key, zodType] of Object.entries(shape)) {
        requiredShape[key] = required.has(key) ? zodType : zodType.optional();
      }
      return withDesc(z.object(requiredShape));
    }
    default: {
      // strings (incl. enums)
      if (Array.isArray(schema.enum)) {
        const values = (schema.enum as unknown[]).filter((v): v is string => typeof v === "string");
        if (values.length > 0) return wrapDefault(withDesc(z.enum(values as [string, ...string[]])));
      }
      return wrapDefault(withDesc(z.string()));
    }
  }
}

function shapeFromInputSchema(input: InputSchema): Record<string, z.ZodTypeAny> {
  const props = (input.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set(input.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, sub] of Object.entries(props)) {
    const zodType = toZod(sub);
    shape[key] = required.has(key) ? zodType : zodType.optional();
  }
  return shape;
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "company-brain", version: "1.0.0" },
    {
      instructions:
        "The Company Brain: a FalkorDB-backed engineering knowledge graph (people, teams, services, " +
        "tickets, decisions, chat) with graph algorithms and memory. Prefer the dedicated tools over " +
        "hand-written Cypher; every result carries its summary, the Cypher that ran, and the nodes " +
        "touched. Reads answer questions; the create/update/record/note/remember tools ACT on the graph.",
    },
  );
  for (const def of REGISTRY.values()) {
    const shape = shapeFromInputSchema(def.input_schema);
    server.tool(def.name, def.description, shape, async (args: Record<string, unknown>) => {
      const client = await FalkorClient.get();
      const result = await execute(def.name, client, args ?? {});
      return { content: [{ type: "text" as const, text: compact(result) }] };
    });
  }
  return server;
}

export async function POST(request: Request) {
  await ensureReady();
  try {
    // Stateless: a fresh server per request (a shared instance cannot
    // re-connect to a new transport on every call).
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    await buildServer().connect(transport);
    return await transport.handleRequest(request, { parsedBody: await request.json() });
  } catch (err) {
    if (err instanceof GraphError) {
      return Response.json({ detail: err.message }, { status: 503 });
    }
    console.error(`[brain] mcp failed: ${(err as Error).stack ?? err}`);
    return Response.json({ detail: "internal server error" }, { status: 500 });
  }
}

export async function GET() {
  return Response.json(
    {
      detail:
        "Company Brain MCP endpoint. Connect an MCP client with transport type 'streamable-http' " +
        "pointing at POST /api/brain/mcp (stateless, JSON responses).",
    },
    { status: 405 },
  );
}

export async function DELETE() {
  return Response.json({ detail: "stateless mode: no sessions to delete" }, { status: 405 });
}
