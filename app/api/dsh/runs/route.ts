import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { getLiveRun, spawnAgentRun, stopAgentRun } from "@/lib/dsh/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Start an agent run inside a workspace. */
export async function POST(request: Request) {
  await ensureReady();
  let body: { workspace_id?: string; task?: string; session_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: "request body must be JSON" }, { status: 400 });
  }
  if (!body.workspace_id || !body.task?.trim()) {
    return NextResponse.json({ detail: "workspace_id and task are required" }, { status: 400 });
  }
  try {
    const client = await FalkorClient.get();
    const { run } = await spawnAgentRun(client, body.workspace_id, body.task, {
      sessionId: body.session_id,
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    return NextResponse.json({ detail: (err as Error).message }, { status: 400 });
  }
}
