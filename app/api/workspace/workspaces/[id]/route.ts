import { NextResponse } from "next/server";
import { authed } from "@/lib/auth/context";
import { ownedWorkspace } from "@/lib/workspace/access";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import {
  archiveWorkspace,
  deleteWorkspace,
  listSessions,
  moveWorkspaceBefore,
  updateWorkspace,
} from "@/lib/workspace/workspaces";
import { buildMemoryContext, listTodos } from "@/lib/workspace/memory";
import { membersOf } from "@/lib/workspace/membership";
import { listConversations } from "@/lib/store";
import type { WorkspaceStatus } from "@/lib/workspace/types";

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
    const [sessions, todos, context, conversations] = await Promise.all([
      listSessions(client, ws.id),
      listTodos(client, ws.id),
      buildMemoryContext(client, ws.id, 2000),
      listConversations(user.uid),
    ]);
    // Membership is by working directory: the sessions that run in this
    // folder are the ones whose cwd is this path.
    const members = membersOf(
      conversations.map((c) => ({ id: c.id, title: c.title, cwd: c.cwd ?? "", updatedAt: c.updatedAt })),
      ws.path,
    );
    return NextResponse.json({ workspace: ws, sessions, todos, members, memory_preview: context });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    throw err;
  }
});

/**
 * Rename, reorder, archive, or describe a workspace.
 *
 * `title` replaces the display title, `before` moves the workspace in the
 * order, and `archived` hides it without touching the directory.
 */
export const PATCH = authed<{ id: string }>(async (request, user, { params }) => {
  await ensureReady();
  const { id } = await params;
  let body: {
    title?: string;
    description?: string;
    tags?: string[];
    status?: WorkspaceStatus;
    position?: number;
    archived?: boolean;
    before?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: "request body must be JSON" }, { status: 400 });
  }
  try {
    const client = await FalkorClient.get();
    const target = decodeURIComponent(id);
    if (!(await ownedWorkspace(client, target, user))) {
      return NextResponse.json({ detail: "unknown workspace" }, { status: 404 });
    }
    if (body.before !== undefined) {
      await moveWorkspaceBefore(client, target, body.before);
    }
    if (body.archived) {
      const archived = await archiveWorkspace(client, target);
      return NextResponse.json({ workspace: archived });
    }
    const patch: Parameters<typeof updateWorkspace>[2] = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.tags !== undefined) patch.tags = body.tags;
    if (body.status !== undefined) patch.status = body.status;
    if (body.position !== undefined) patch.position = body.position;
    const ws = await updateWorkspace(client, target, patch);
    return NextResponse.json({ workspace: ws });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    return NextResponse.json({ detail: (err as Error).message }, { status: 400 });
  }
});

/**
 * Remove the registration. The directory, its files and the sessions that ran
 * there are untouched — they simply become ungrouped.
 */
export const DELETE = authed<{ id: string }>(async (_request, user, { params }) => {
  await ensureReady();
  const { id } = await params;
  try {
    const client = await FalkorClient.get();
    const target = decodeURIComponent(id);
    if (!(await ownedWorkspace(client, target, user))) {
      return NextResponse.json({ detail: "unknown workspace" }, { status: 404 });
    }
    const deleted = await deleteWorkspace(client, target);
    return NextResponse.json({ deleted });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    return NextResponse.json({ detail: (err as Error).message }, { status: 400 });
  }
});
