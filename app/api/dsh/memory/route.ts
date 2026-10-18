import { NextResponse } from "next/server";
import { authed } from "@/lib/auth/context";
import { ownedWorkspace } from "@/lib/dsh/access";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { recallShared, storeShared } from "@/lib/dsh/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Recall shared memory (global + optional workspace scope). */
export const GET = authed(async (request, user) => {
  await ensureReady();
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspace_id") ?? "";
  const q = searchParams.get("q") ?? "";
  const limit = Math.max(1, Math.min(Number(searchParams.get("limit") ?? "20") || 20, 100));
  try {
    const client = await FalkorClient.get();
    if (workspaceId && !(await ownedWorkspace(client, workspaceId, user))) {
      return NextResponse.json({ detail: "unknown workspace" }, { status: 404 });
    }
    return NextResponse.json({ memories: await recallShared(client, workspaceId, q, limit) });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    throw err;
  }
});

/** Store shared memory (secrets redacted, deduped, slot-conflicts resolved). */
export const POST = authed(async (request, user) => {
  await ensureReady();
  let body: { scope?: string; kind?: string; text?: string; slot?: string | null; tags?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: "request body must be JSON" }, { status: 400 });
  }
  if (!body.scope || !body.text?.trim()) {
    return NextResponse.json({ detail: "scope and text are required" }, { status: 400 });
  }
  try {
    const client = await FalkorClient.get();
    if (body.scope !== "global") {
      const wid = body.scope.startsWith("workspace:") ? body.scope.slice("workspace:".length) : "";
      if (!wid || !(await ownedWorkspace(client, wid, user))) {
        return NextResponse.json({ detail: "unknown workspace" }, { status: 404 });
      }
    }
    const mem = await storeShared(client, {
      scope: body.scope,
      kind: body.kind ?? "note",
      text: body.text,
      slot: body.slot,
      tags: body.tags,
    });
    return NextResponse.json({ memory: mem }, { status: 201 });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    return NextResponse.json({ detail: (err as Error).message }, { status: 400 });
  }
});
