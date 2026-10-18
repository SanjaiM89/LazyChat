import { NextResponse } from "next/server";
import { authed } from "@/lib/auth/context";
import { ownedWorkspace } from "@/lib/dsh/access";
import type { AuthUser } from "@/lib/auth/shared";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { deleteShared, updateShared } from "@/lib/dsh/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Memory belongs to the user's own global pool or to one of their workspaces. */
async function canTouch(client: FalkorClient, id: string, user: AuthUser): Promise<boolean> {
  const rows = await client.query<{ scope: string }>("MATCH (m:SharedMemory {id: $id}) RETURN m.scope AS scope LIMIT 1", { id });
  const scope = rows[0]?.scope ?? "";
  if (scope === `global:${user.uid}`) return true;
  if (scope.startsWith("workspace:")) return !!(await ownedWorkspace(client, scope.slice("workspace:".length), user));
  return false;
}

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = authed<{ id: string }>(async (request, user, { params }) => {
  await ensureReady();
  const { id } = await params;
  let body: { text?: string; tags?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: "request body must be JSON" }, { status: 400 });
  }
  try {
    const client = await FalkorClient.get();
    if (!(await canTouch(client, decodeURIComponent(id), user))) return NextResponse.json({ detail: "unknown memory" }, { status: 404 });
    const mem = await updateShared(client, decodeURIComponent(id), body);
    if (!mem) return NextResponse.json({ detail: "unknown memory" }, { status: 404 });
    return NextResponse.json({ memory: mem });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    throw err;
  }
});

export const DELETE = authed<{ id: string }>(async (_request, user, { params }) => {
  await ensureReady();
  const { id } = await params;
  try {
    const client = await FalkorClient.get();
    if (!(await canTouch(client, decodeURIComponent(id), user))) return NextResponse.json({ detail: "unknown memory" }, { status: 404 });
    const deleted = await deleteShared(client, decodeURIComponent(id));
    if (!deleted) return NextResponse.json({ detail: "unknown memory" }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    throw err;
  }
});
