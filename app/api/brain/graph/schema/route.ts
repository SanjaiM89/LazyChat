import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { schemaSummary } from "@/lib/brain/cypher";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { NODE_COLORS, NODE_LABELS, RELATIONSHIP_PROPERTIES, RELATIONSHIPS } from "@/lib/brain/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Legend data: every label, relationship and colour, plus live counts. */
export async function GET() {
  await ensureReady();
  try {
    const client = await FalkorClient.get();
    const summary = await schemaSummary(client);
    return NextResponse.json({
      labels: NODE_LABELS.map((label) => ({ label, color: NODE_COLORS[label] ?? "#64748b" })),
      relationships: [...RELATIONSHIPS],
      relationship_properties: RELATIONSHIP_PROPERTIES,
      node_counts: summary.node_counts,
      edge_counts: summary.edge_counts,
    });
  } catch (err) {
    if (err instanceof GraphError) {
      return NextResponse.json({ detail: err.message }, { status: 503 });
    }
    throw err;
  }
}
