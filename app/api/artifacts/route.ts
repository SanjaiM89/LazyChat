import { NextRequest } from "next/server";
import { listArtifacts, getArtifact, deleteArtifact } from "@/lib/artifacts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // ?id= → resolve a single artifact by id (used to keep an artifact open even
  // when it isn't in the currently-loaded, conversation-scoped list yet).
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const a = getArtifact(id);
    return a
      ? Response.json(a)
      : Response.json({ error: "artifact not found" }, { status: 404 });
  }
  const conversationId = req.nextUrl.searchParams.get("conversationId") || undefined;
  return Response.json(listArtifacts(conversationId));
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  deleteArtifact(id);
  return Response.json({ ok: true });
}
