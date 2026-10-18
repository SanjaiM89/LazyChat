import { NextResponse } from "next/server";
import { authed } from "@/lib/auth/context";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { proceduresForUser } from "@/lib/brain/memory/consolidation";
import { memoryStats, recallMemories } from "@/lib/brain/memory/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Memory panel: this user's episodic and semantic memory nodes. */
export const GET = authed<{ userId: string }>(async (request, user, { params }) => {
  await ensureReady();
  const { userId } = await params;
  const uid = user.uid;
  if (decodeURIComponent(userId) !== uid) return NextResponse.json({ detail: "not found" }, { status: 404 });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const client = await FalkorClient.get();
    const [memories, stats, procedures] = await Promise.all([
      recallMemories(client, uid, q, 50),
      memoryStats(client, uid),
      proceduresForUser(client, uid),
    ]);
    return NextResponse.json({ user_id: uid, memories, stats, procedures });
  } catch (err) {
    if (err instanceof GraphError) {
      return NextResponse.json({ detail: err.message }, { status: 503 });
    }
    throw err;
  }
});
