import { NextRequest } from "next/server";

import { compactConversation } from "@/lib/compact";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Manual compact (`/compact` equivalent) + auto-compact target. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let force = false;
  try {
    const body = await req.json();
    force = body?.force === true;
  } catch {
    // no body — threshold-gated
  }
  try {
    const result = await compactConversation(id, { force });
    return Response.json(result);
  } catch (e: unknown) {
    return Response.json(
      { compacted: false, reason: e instanceof Error ? e.message : "compaction failed" },
      { status: 500 },
    );
  }
}
