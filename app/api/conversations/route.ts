import {
  listConversations,
  saveConversation,
  clearConversations,
  type StoredConversation,
} from "@/lib/store";
import { authed } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, user) => {
  const conversations = await listConversations(user.uid);
  return Response.json(conversations);
});

export const POST = authed(async (req, user) => {
  const body = await req.json();
  if (!body.id || !body.messages) {
    return Response.json({ error: "id and messages required" }, { status: 400 });
  }
  const conv: StoredConversation = {
    id: body.id,
    title:
      body.title ||
      (body.messages.find((m: any) => m.role === "user")?.content?.[0]?.text ||
        body.messages.find((m: any) => m.role === "user")?.content ||
        "New chat").toString().slice(0, 80),
    createdAt: body.createdAt || Date.now(),
    updatedAt: Date.now(),
    provider: body.provider || "anthropic",
    model: body.model || "",
    messages: body.messages,
  };
  await saveConversation(conv, { uid: user.uid, orgId: user.orgId });
  return Response.json({ ok: true });
});

export const DELETE = authed(async (_req, user) => {
  await clearConversations(user.uid);
  return Response.json({ ok: true });
});
