import { NextResponse } from "next/server";
import { authed } from "@/lib/auth/context";
import { sessionOwned } from "@/lib/brain/access";

import { knownServices, knownTopics } from "@/lib/brain/agent";
import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { getLlm } from "@/lib/brain/llm";
import { consolidateSession } from "@/lib/brain/memory/consolidation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Force consolidation of a session (used by the demo flow). */
export const POST = authed<{ userId: string }>(async (request, user, { params }) => {
  await ensureReady();
  const { userId } = await params;
  const uid = user.uid;
  if (decodeURIComponent(userId) !== uid) return NextResponse.json({ detail: "not found" }, { status: 404 });
  let body: { session_id?: string };
  try {
    body = (await request.json()) as { session_id?: string };
  } catch {
    return NextResponse.json({ detail: "request body must be JSON" }, { status: 400 });
  }
  if (!body.session_id) {
    return NextResponse.json({ detail: "session_id is required" }, { status: 400 });
  }
  try {
    const client = await FalkorClient.get();
    if (!(await sessionOwned(client, body.session_id, uid))) return NextResponse.json({ detail: "not found" }, { status: 404 });
    const out = await consolidateSession(client, body.session_id, uid, {
      force: true,
      llm: getLlm({
        knownServices: await knownServices(client),
        knownTopics: await knownTopics(client),
      }),
    });
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof GraphError) {
      return NextResponse.json({ detail: err.message }, { status: 503 });
    }
    throw err;
  }
});
