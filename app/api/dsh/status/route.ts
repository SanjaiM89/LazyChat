import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { FalkorClient } from "@/lib/brain/graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Sandbox/resource status: dsh CLI, FalkorDB, workspace roots. */
export async function GET() {
  const bin = path.resolve(process.cwd(), "harness/deepseek-harness/apps/cli/lib/bin.js");
  const dshBuilt = fs.existsSync(bin);
  let dshVersion: string | null = null;
  if (dshBuilt) {
    try {
      dshVersion = await new Promise((resolve) => {
        execFile(process.execPath, [bin, "--version"], { timeout: 15000 }, (err, stdout) => {
          resolve(err ? null : stdout.trim().slice(0, 40));
        });
      });
    } catch {
      dshVersion = null;
    }
  }
  let falkordb: { reachable: boolean; error?: string } = { reachable: false };
  try {
    const client = await FalkorClient.get();
    falkordb = { reachable: await client.ping() };
  } catch (err) {
    falkordb = { reachable: false, error: (err as Error).message };
  }
  return NextResponse.json({
    dsh: { built: dshBuilt, version: dshVersion, bin: dshBuilt ? bin : null },
    falkordb,
    node: process.version,
  });
}
