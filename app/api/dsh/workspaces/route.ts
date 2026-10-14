import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { createWorkspace, listWorkspaces } from "@/lib/dsh/workspaces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  await ensureReady();
  try {
    const client = await FalkorClient.get();
    return NextResponse.json({ workspaces: await listWorkspaces(client) });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    throw err;
  }
}

export async function POST(request: Request) {
  await ensureReady();
  let body: { name?: string; path?: string; description?: string; owner?: string; tags?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: "request body must be JSON" }, { status: 400 });
  }
  if (!body.path) return NextResponse.json({ detail: "path is required" }, { status: 400 });
  try {
    const client = await FalkorClient.get();
    const ws = await createWorkspace(client, {
      name: body.name ?? "",
      path: body.path,
      description: body.description,
      owner: body.owner,
      tags: body.tags,
    });
    return NextResponse.json({ workspace: ws }, { status: 201 });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    return NextResponse.json({ detail: (err as Error).message }, { status: 400 });
  }
}
