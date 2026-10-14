import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { NODE_COLORS } from "@/lib/brain/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Type-ahead over node names, for clickable citations. */
export async function GET(request: Request) {
  await ensureReady();
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  if (q.length < 2) {
    return NextResponse.json({ detail: "q must be at least 2 characters" }, { status: 400 });
  }
  const rawLimit = Number(searchParams.get("limit") ?? "20");
  const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 20, 100));
  try {
    const client = await FalkorClient.get();
    const rows = await client.query<{ id: string; label: string | null; name: string }>(
      "MATCH (n) WHERE toLower(coalesce(n.name,'')) CONTAINS toLower($q) " +
        "   OR toLower(coalesce(n.title,'')) CONTAINS toLower($q) " +
        "   OR toLower(coalesce(n.key,'')) CONTAINS toLower($q) " +
        "RETURN n.id AS id, head(labels(n)) AS label, " +
        "       coalesce(n.name, n.key, n.title, n.id) AS name " +
        "ORDER BY name LIMIT $limit",
      { q, limit },
    );
    return NextResponse.json({
      results: rows.map((r) => ({
        id: r.id,
        label: r.label,
        name: r.name,
        color: NODE_COLORS[r.label ?? ""] ?? "#64748b",
      })),
    });
  } catch (err) {
    if (err instanceof GraphError) {
      return NextResponse.json({ detail: err.message }, { status: 503 });
    }
    throw err;
  }
}
