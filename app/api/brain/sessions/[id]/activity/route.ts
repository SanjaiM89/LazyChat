import { NextResponse } from "next/server";
import { authed } from "@/lib/auth/context";
import { sessionOwned } from "@/lib/brain/access";

import { ensureReady } from "@/lib/brain/bootstrap";
import { sessionActivity } from "@/lib/brain/crew";
import { FalkorClient, GraphError } from "@/lib/brain/graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Agent Activity panel: findings written and handoffs made, in order. */
export const GET = authed<{ id: string }>(async (_request, user, { params }) => {
  await ensureReady();
  const { id: sessionId } = await params;
  const sid = decodeURIComponent(sessionId);
  try {
    const client = await FalkorClient.get();
    if (!(await sessionOwned(client, sid, user.uid))) return NextResponse.json({ detail: "not found" }, { status: 404 });
    const activity = await sessionActivity(client, sid);
    return NextResponse.json({ session_id: sid, activity });
  } catch (err) {
    if (err instanceof GraphError) {
      return NextResponse.json({ detail: err.message }, { status: 503 });
    }
    throw err;
  }
});
