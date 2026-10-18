import { authed } from "@/lib/auth/context";
import { listArtifacts, getArtifact, deleteArtifact } from "@/lib/artifacts";

export const dynamic = "force-dynamic";

export const GET = authed(async (req, user) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const a = getArtifact(id, user.uid);
    return a
      ? Response.json(a)
      : Response.json({ error: "artifact not found" }, { status: 404 });
  }
  const conversationId = url.searchParams.get("conversationId") || undefined;
  return Response.json(listArtifacts(conversationId, user.uid));
});

export const DELETE = authed(async (req, user) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  deleteArtifact(id, user.uid);
  return Response.json({ ok: true });
});
