import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { getWorkspace } from "@/lib/dsh/workspaces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export type FileEntry = {
  name: string;
  path: string; // workspace-relative, posix
  dir: boolean;
  size?: number;
  modified?: string;
};

/** Directory listing confined to the workspace root (no traversal escapes). */
export async function GET(request: Request, { params }: Ctx) {
  await ensureReady();
  const { id } = await params;
  const rel = new URL(request.url).searchParams.get("path") ?? "";
  try {
    const client = await FalkorClient.get();
    const ws = await getWorkspace(client, decodeURIComponent(id));
    if (!ws) return NextResponse.json({ detail: "unknown workspace" }, { status: 404 });
    const root = path.resolve(ws.path);
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
      return NextResponse.json({ detail: "path escapes the workspace" }, { status: 400 });
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      return NextResponse.json({ detail: "no such path" }, { status: 404 });
    }
    if (!stat.isDirectory()) {
      const content = fs.readFileSync(target, "utf8").slice(0, 20000);
      return NextResponse.json({ file: { name: path.basename(target), path: rel, dir: false }, content });
    }
    const names = fs.readdirSync(target);
    const entries: FileEntry[] = [];
    for (const name of names.slice(0, 500)) {
      if (name === ".git" || name === "node_modules") continue;
      try {
        const st = fs.statSync(path.join(target, name));
        entries.push({
          name,
          path: path.posix.join(rel, name),
          dir: st.isDirectory(),
          size: st.isDirectory() ? undefined : st.size,
          modified: st.mtime.toISOString(),
        });
      } catch {
        // unreadable entry — skip
      }
    }
    entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    return NextResponse.json({ path: rel, entries });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    return NextResponse.json({ detail: (err as Error).message }, { status: 400 });
  }
}
