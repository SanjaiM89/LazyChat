import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { subgraphAround } from "@/lib/brain/cypher";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { shapeSubgraph } from "@/lib/brain/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Neighbourhood of a node for the graph canvas. */
export async function GET(request: Request) {
  await ensureReady();
  const { searchParams } = new URL(request.url);
  const nodeId = searchParams.get("node_id");
  if (!nodeId) {
    return NextResponse.json({ detail: "node_id is required" }, { status: 400 });
  }
  const rawDepth = Number(searchParams.get("depth") ?? "2");
  const depth = Math.max(1, Math.min(Number.isFinite(rawDepth) ? rawDepth : 2, 3));
  try {
    const client = await FalkorClient.get();
    const shaped = shapeSubgraph(await subgraphAround(client, nodeId, depth));
    if (shaped.nodes.length === 0) {
      return NextResponse.json({ detail: `no node with id '${nodeId}'` }, { status: 404 });
    }
    return NextResponse.json(shaped);
  } catch (err) {
    if (err instanceof GraphError) {
      return NextResponse.json({ detail: err.message }, { status: 503 });
    }
    throw err;
  }
}
