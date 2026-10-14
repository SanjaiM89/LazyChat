import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server directory browser for folder attach. Confined to the user's home
 * directory — anything outside is rejected, and only directories are listed.
 */
export async function GET(request: Request) {
  const home = path.resolve(os.homedir());
  const rel = new URL(request.url).searchParams.get("path") ?? "";
  const target = path.resolve(home, rel.startsWith("/") ? path.relative(home, rel) : rel);
  if (target !== home && !target.startsWith(home + path.sep)) {
    return NextResponse.json({ detail: "outside the home directory" }, { status: 400 });
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
}
