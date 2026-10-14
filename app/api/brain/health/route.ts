import { NextResponse } from "next/server";

import { brainConfig } from "@/lib/brain/config";
import { FalkorClient } from "@/lib/brain/graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Liveness + dependency check. Reports outages instead of throwing. */
export async function GET() {
  const { falkordb, provider } = brainConfig();
  let reachable = true;
  let error: string | null = null;
  try {
    const client = await FalkorClient.get();
    reachable = await client.ping();
    if (!reachable) error = "ping failed";
  } catch (err) {
    reachable = false;
    error = (err as Error).message;
  }
  return NextResponse.json({
    status: reachable ? "ok" : "degraded",
    falkordb: {
      host: falkordb.host,
      port: falkordb.port,
      graph: falkordb.graphName,
      reachable,
      error,
    },
    llm: provider,
  });
}
