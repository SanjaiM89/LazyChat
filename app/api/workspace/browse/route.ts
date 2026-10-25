import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { authed } from "@/lib/auth/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The server directory browser.
 *
 * A workspace is a folder on this machine, so the browser walks the real
 * filesystem, rooted at the user's home. It lists directories only, and
 * hidden entries are left out.
 */
export const GET = authed(async (request) => {
  const requested = new URL(request.url).searchParams.get("path") ?? "";
  const home = os.homedir();
  const target = requested ? path.resolve(requested) : home;

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
  const parent = path.dirname(target);
  return NextResponse.json({
    cwd: target,
    home,
    // The filesystem root has no parent to walk to.
    parent: parent === target ? null : parent,
    dirs: names.slice(0, 500),
  });
});

/** Create a sub-folder to use as a workspace. */
export const POST = authed(async (request) => {
  const body = (await request.json().catch(() => ({}))) as { path?: string; name?: string };
  const name = (body.name ?? "").trim().replace(/[^A-Za-z0-9 _.-]/g, "").slice(0, 60);
  if (!name) return NextResponse.json({ detail: "name required" }, { status: 400 });
  const parent = body.path ? path.resolve(body.path) : os.homedir();
  const dir = path.join(parent, name);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return NextResponse.json({ detail: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ cwd: fs.realpathSync(dir) }, { status: 201 });
});
