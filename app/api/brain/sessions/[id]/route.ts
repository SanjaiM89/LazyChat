import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { listSessions } from "@/lib/brain/memory/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Past conversations for one user, newest first. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureReady();
  const { id: userId } = await params;
  try {
    const client = await FalkorClient.get();
    const sessions = await listSessions(client, decodeURIComponent(userId));
    return NextResponse.json({ user_id: decodeURIComponent(userId), sessions });
  } catch (err) {
    if (err instanceof GraphError) {
      return NextResponse.json({ detail: err.message }, { status: 503 });
    }
    throw err;
  }
}
