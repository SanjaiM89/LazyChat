import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import {
  createWorkspace,
  listWorkspaces,
  recoverWorkspaceRegistry,
} from "@/lib/workspace/workspaces";
import { authed } from "@/lib/auth/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = authed(async (_req, user) => {
  await ensureReady();
  try {
    const client = await FalkorClient.get();
    // Finish an interrupted registration before answering, so the list is
    // never a half-written order.
    await recoverWorkspaceRegistry(client);
    return NextResponse.json({ workspaces: await listWorkspaces(client, false, user.uid) });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    throw err;
  }
});

/**
 * Register a workspace.
 *
 * The path must be an absolute path to a directory that exists — any folder on
 * this machine, the way the harness treats a workspace. The canonical path is
 * the record's identity, so registering the same folder twice returns the
 * record that is already there.
 */
export const POST = authed(async (request, user) => {
  await ensureReady();
  let body: { path?: string; title?: string; description?: string; tags?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: "request body must be JSON" }, { status: 400 });
  }

  let dir = (body.path ?? "").trim();
  if (!dir) {
    // A workspace with no path is a new folder in the user's home.
    const slug = (body.title ?? "").trim().replace(/[^A-Za-z0-9 _.-]/g, "").slice(0, 60);
    if (!slug) return NextResponse.json({ detail: "path or title is required" }, { status: 400 });
    dir = path.join(os.homedir(), slug);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      return NextResponse.json({ detail: (e as Error).message }, { status: 400 });
    }
  }
  if (!path.isAbsolute(dir)) {
    return NextResponse.json({ detail: `workspace path is not fully qualified: '${dir}'` }, { status: 400 });
  }
  try {
    const client = await FalkorClient.get();
    const ws = await createWorkspace(client, {
      path: dir,
      title: body.title,
      description: body.description,
      owner: user.uid,
      tags: body.tags,
    });
    return NextResponse.json({ workspace: ws }, { status: 201 });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    return NextResponse.json({ detail: (err as Error).message }, { status: 400 });
  }
});
