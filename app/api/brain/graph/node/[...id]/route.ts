import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { coerceNode, FalkorClient, GraphError } from "@/lib/brain/graph";
import { NODE_COLORS } from "@/lib/brain/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One node plus its immediate relationships — the citation detail view. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string[] }> }) {
  await ensureReady();
  const { id } = await params;
  const nodeId = id.map(decodeURIComponent).join("/");
  try {
    const client = await FalkorClient.get();
    const rows = await client.query<{
      label: string | null;
      n: unknown;
      neighbours: Array<{ id?: string; name?: string; label?: string; rel?: string }> | null;
    }>(
      "MATCH (n {id: $nid}) " +
        "OPTIONAL MATCH (n)-[r]-(m) " +
        "RETURN labels(n)[0] AS label, n AS n, " +
        "collect({id: m.id, name: coalesce(m.name, m.key, m.title, m.id), " +
        "         label: head(labels(m)), rel: type(r)}) AS neighbours",
      { nid: nodeId },
    );
    if (rows.length === 0 || !rows[0].n) {
      return NextResponse.json({ detail: `no node with id '${nodeId}'` }, { status: 404 });
    }
    const node = coerceNode(rows[0].n);
    if (!node) {
      return NextResponse.json({ detail: `no node with id '${nodeId}'` }, { status: 404 });
    }
    const props = node.properties;
    const label = rows[0].label ?? node.labels[0] ?? "Node";
    return NextResponse.json({
      id: node.id,
      label,
      name: (props.name as string) || (props.key as string) || (props.title as string) || node.id,
      color: NODE_COLORS[label] ?? "#64748b",
      properties: props,
      neighbours: (rows[0].neighbours ?? []).filter((n) => n && n.id),
    });
  } catch (err) {
    if (err instanceof GraphError) {
      return NextResponse.json({ detail: err.message }, { status: 503 });
    }
    throw err;
  }
}
