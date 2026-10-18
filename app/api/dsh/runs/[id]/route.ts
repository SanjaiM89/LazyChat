import { NextResponse } from "next/server";
import { authed } from "@/lib/auth/context";
import { ownedWorkspace } from "@/lib/dsh/access";
import { FalkorClient } from "@/lib/brain/graph";

import { getLiveRun, stopAgentRun } from "@/lib/dsh/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Live run status + output tail (poll from the execution panel). */
export const GET = authed<{ id: string }>(async (_request, user, { params }) => {
  const { id } = await params;
  const entry = getLiveRun(decodeURIComponent(id));
  if (!entry || !(await ownedWorkspace(await FalkorClient.get(), entry.run.workspace_id, user))) return NextResponse.json({ detail: "unknown or finished run" }, { status: 404 });
  const full = entry.output.join("");
  return NextResponse.json({ run: entry.run, output: full.slice(-30000), truncated: full.length > 30000 });
});

export const DELETE = authed<{ id: string }>(async (_request, user, { params }) => {
  const { id } = await params;
  const entry = getLiveRun(decodeURIComponent(id));
  if (!entry || !(await ownedWorkspace(await FalkorClient.get(), entry.run.workspace_id, user))) {
    return NextResponse.json({ stopped: false });
  }
  const stopped = await stopAgentRun(decodeURIComponent(id));
  return NextResponse.json({ stopped });
});
