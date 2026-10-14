import { NextResponse } from "next/server";

import { getLiveRun, stopAgentRun } from "@/lib/dsh/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Live run status + output tail (poll from the execution panel). */
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const entry = getLiveRun(decodeURIComponent(id));
  if (!entry) return NextResponse.json({ detail: "unknown or finished run" }, { status: 404 });
  const full = entry.output.join("");
  return NextResponse.json({ run: entry.run, output: full.slice(-30000), truncated: full.length > 30000 });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const stopped = await stopAgentRun(decodeURIComponent(id));
  return NextResponse.json({ stopped });
}
