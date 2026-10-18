import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { authed } from "@/lib/auth/context";
import { insideRoot, workspaceRoot } from "@/lib/dsh/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server directory browser for folder attach. Confined to the user's home
 * workspace area — anything outside is rejected, and only directories are listed.
 */
export const GET = authed(async (request, user) => {
  const home = workspaceRoot(user.uid);
  const rel = new URL(request.url).searchParams.get("path") ?? "";
  const target = path.resolve(home, rel.startsWith("/") ? path.relative(home, rel) : rel);
  if (!insideRoot(home, target)) {
    return NextResponse.json({ detail: "outside your workspace area" }, { status: 400 });
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return NextResponse.json({ detail: "no such directory" }, { status: 404 });
  }
  if (!stat.isDirectory()) {
    return NextResponse.json({ detail: "not a directory" }, { status: 400 });
  }
  let names: string[] = [];
  try {
    names = fs.readdirSync(target).filter((n) => {
      if (n.startsWith(".")) return false;
      try {
        return fs.statSync(path.join(target, n)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return NextResponse.json({ detail: "unreadable directory" }, { status: 400 });
  }
  names.sort((a, b) => a.localeCompare(b));
  return NextResponse.json({
    cwd: target,
    parent: target === home ? null : path.dirname(target),
    dirs: names.slice(0, 500),
  });
});

/** Create a sub-folder (inside the user's workspace area) to use as a workspace. */
export const POST = authed(async (request, user) => {
  const root = workspaceRoot(user.uid);
  const body = (await request.json().catch(() => ({}))) as { path?: string; name?: string };
  const name = (body.name ?? "").trim().replace(/[^A-Za-z0-9 _.-]/g, "").slice(0, 60);
  if (!name) return NextResponse.json({ detail: "name required" }, { status: 400 });
  const parent = path.resolve(root, body.path ?? "");
  if (!insideRoot(root, parent)) return NextResponse.json({ detail: "outside your workspace area" }, { status: 400 });
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  return NextResponse.json({ cwd: dir }, { status: 201 });
});
