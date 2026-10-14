import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { runCustomQuery } from "@/lib/brain/cypher";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { shapeSubgraph } from "@/lib/brain/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read-only Cypher console. Writes are rejected server-side. */
export async function POST(request: Request) {
  await ensureReady();
  let body: { cypher?: string; params?: Record<string, unknown> };
  try {
    body = (await request.json()) as { cypher?: string; params?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ detail: "request body must be JSON" }, { status: 400 });
  }
  if (!body.cypher || !body.cypher.trim()) {
    return NextResponse.json({ detail: "cypher is required" }, { status: 400 });
  }
  try {
    const client = await FalkorClient.get();
    const out = await runCustomQuery(client, body.cypher, body.params ?? {});
    return NextResponse.json({ rows: out.rows, subgraph: shapeSubgraph(out.subgraph) });
  } catch (err) {
    if (err instanceof GraphError) {
      return NextResponse.json({ detail: err.message }, { status: 400 });
    }
    throw err;
  }
}
