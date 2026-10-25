import { NextResponse } from "next/server";
import { authed } from "@/lib/auth/context";
import { ownedWorkspace } from "@/lib/workspace/access";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { recentCommands } from "@/lib/workspace/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Command/output history for a workspace (task history). */
export const GET = authed<{ id: string }>(async (request, user, { params }) => {
  await ensureReady();
  const { id } = await params;
  const limit = Math.max(1, Math.min(Number(new URL(request.url).searchParams.get("limit") ?? "30") || 30, 100));
  try {
    const client = await FalkorClient.get();
    const ws = await ownedWorkspace(client, decodeURIComponent(id), user);
    if (!ws) return NextResponse.json({ detail: "unknown workspace" }, { status: 404 });
    return NextResponse.json({ commands: await recentCommands(client, ws.id, limit) });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    throw err;
  }
});
