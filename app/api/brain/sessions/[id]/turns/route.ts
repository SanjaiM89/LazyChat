import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { getTurns } from "@/lib/brain/memory/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Full conversation history for a session. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureReady();
  const { id: sessionId } = await params;
  const sid = decodeURIComponent(sessionId);
  const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? "200");
  const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 200, 1000));
  try {
    const client = await FalkorClient.get();
    const turns = await getTurns(client, sid, limit);
    if (turns.length === 0) {
      return NextResponse.json({ detail: `unknown session '${sid}'` }, { status: 404 });
    }
    return NextResponse.json({ session_id: sid, turns });
  } catch (err) {
    if (err instanceof GraphError) {
      return NextResponse.json({ detail: err.message }, { status: 503 });
    }
    throw err;
  }
}
