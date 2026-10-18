import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { createWorkspace, listWorkspaces } from "@/lib/dsh/workspaces";
import { authed } from "@/lib/auth/context";
import { insideRoot, workspaceRoot } from "@/lib/dsh/access";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = authed(async (_req, user) => {
  await ensureReady();
  try {
    const client = await FalkorClient.get();
    return NextResponse.json({ workspaces: await listWorkspaces(client, false, user.uid) });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    throw err;
  }
});

export const POST = authed(async (request, user) => {
  await ensureReady();
  let body: { name?: string; path?: string; description?: string; owner?: string; tags?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: "request body must be JSON" }, { status: 400 });
  }
  // Workspaces are folders inside the user's own area; a name alone creates a fresh one.
  const root = workspaceRoot(user.uid);
  let dir = body.path ? path.resolve(body.path) : "";
  if (!dir) {
    const slug = (body.name ?? "").trim().replace(/[^A-Za-z0-9 _.-]/g, "").slice(0, 60);
    if (!slug) return NextResponse.json({ detail: "name or path is required" }, { status: 400 });
    dir = path.join(root, slug);
    fs.mkdirSync(dir, { recursive: true });
  }
  try {
    dir = fs.realpathSync(dir);
  } catch {
    return NextResponse.json({ detail: "no such directory" }, { status: 400 });
  }
  if (!insideRoot(root, dir)) {
    return NextResponse.json({ detail: "folder must be inside your workspace area" }, { status: 400 });
  }
  try {
    const client = await FalkorClient.get();
    const ws = await createWorkspace(client, {
      name: body.name ?? "",
      path: dir,
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
