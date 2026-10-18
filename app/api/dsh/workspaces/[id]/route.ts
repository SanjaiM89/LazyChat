import { NextResponse } from "next/server";
import { authed } from "@/lib/auth/context";
import { ownedWorkspace } from "@/lib/dsh/access";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { archiveWorkspace, listSessions, updateWorkspace } from "@/lib/dsh/workspaces";
import { buildMemoryContext, listTodos } from "@/lib/dsh/memory";
import type { WorkspaceStatus } from "@/lib/dsh/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authed<{ id: string }>(async (_request, user, { params }) => {
  await ensureReady();
  const { id } = await params;
  try {
    const client = await FalkorClient.get();
    const ws = await ownedWorkspace(client, decodeURIComponent(id), user);
    if (!ws) return NextResponse.json({ detail: "unknown workspace" }, { status: 404 });
    const [sessions, todos, context] = await Promise.all([
      listSessions(client, ws.id),
      listTodos(client, ws.id),
      buildMemoryContext(client, ws.id, 2000),
    ]);
    return NextResponse.json({ workspace: ws, sessions, todos, memory_preview: context });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    throw err;
  }
});

export const PATCH = authed<{ id: string }>(async (request, user, { params }) => {
  await ensureReady();
  const { id } = await params;
  let body: { name?: string; description?: string; owner?: string; tags?: string[]; status?: WorkspaceStatus; position?: number; archived?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: "request body must be JSON" }, { status: 400 });
  }
  try {
    const client = await FalkorClient.get();
    if (!(await ownedWorkspace(client, decodeURIComponent(id), user))) {
      return NextResponse.json({ detail: "unknown workspace" }, { status: 404 });
    }
    const patch = { ...body } as Record<string, unknown>;
    delete patch.archived;
    delete patch.owner;
    const ws = body.archived
      ? await archiveWorkspace(client, decodeURIComponent(id))
      : await updateWorkspace(client, decodeURIComponent(id), patch as Parameters<typeof updateWorkspace>[2]);
    return NextResponse.json({ workspace: ws });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    return NextResponse.json({ detail: (err as Error).message }, { status: 400 });
  }
});
