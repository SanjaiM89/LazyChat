import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { getWorkspace } from "@/lib/dsh/workspaces";
import { recentCommands } from "@/lib/dsh/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Command/output history for a workspace (task history). */
export async function GET(request: Request, { params }: Ctx) {
  await ensureReady();
  const { id } = await params;
  const limit = Math.max(1, Math.min(Number(new URL(request.url).searchParams.get("limit") ?? "30") || 30, 100));
  try {
    const client = await FalkorClient.get();
    const ws = await getWorkspace(client, decodeURIComponent(id));
    if (!ws) return NextResponse.json({ detail: "unknown workspace" }, { status: 404 });
    return NextResponse.json({ commands: await recentCommands(client, ws.id, limit) });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    throw err;
  }
}
