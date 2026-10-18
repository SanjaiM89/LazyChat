import { authed } from "@/lib/auth/context";
import { getConversation } from "@/lib/store";

import { compactConversation } from "@/lib/compact";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Manual compact (`/compact` equivalent) + auto-compact target. */
export const POST = authed<{ id: string }>(async (req, user, { params }) => {
  const { id } = await params;
  if (!(await getConversation(id, user.uid))) return Response.json({ error: "not found" }, { status: 404 });
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
});
