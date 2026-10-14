import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { sessionActivity } from "@/lib/brain/crew";
import { FalkorClient, GraphError } from "@/lib/brain/graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Agent Activity panel: findings written and handoffs made, in order. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureReady();
  const { id: sessionId } = await params;
  const sid = decodeURIComponent(sessionId);
  try {
    const client = await FalkorClient.get();
    const activity = await sessionActivity(client, sid);
    return NextResponse.json({ session_id: sid, activity });
  } catch (err) {
    if (err instanceof GraphError) {
      return NextResponse.json({ detail: err.message }, { status: 503 });
    }
    throw err;
  }
}
