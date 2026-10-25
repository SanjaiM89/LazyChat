import { authed } from "@/lib/auth/context";
import { listConversations } from "@/lib/store";
import { currentUser } from "@/lib/auth/context";
import { listEvents } from "@/lib/agent/session";
import {
  archiveSession,
  pinSession,
  readSessionState,
  unarchiveSession,
  unpinSession,
} from "@/lib/agent/session-state";

export const dynamic = "force-dynamic";

/** The conversations, with how much history each one holds. */
export const GET = authed(async () => {
  const uid = currentUser()?.uid;
  const conversations = await listConversations(uid);
  const state = await readSessionState();
  const rows = conversations.map((conversation) => {
    const events = listEvents(conversation.id, { limit: 500 });
    const last = events[events.length - 1];
    return {
      id: conversation.id,
      title: conversation.title,
      updated_at: conversation.updatedAt ?? 0,
      events: events.length,
      last_event: last ? { type: last.type, at: last.created_at } : null,
    };
  });
  rows.sort((a, b) => (b.last_event?.at ?? b.updated_at) - (a.last_event?.at ?? a.updated_at));
  return Response.json({
    count: rows.length,
    conversations: rows,
    pinned: state.pinned,
    archived: state.archived,
  });
});

/**
 * Pin, unpin, archive or unarchive a session.
 *
 * Pinning and archival are mutually exclusive: archiving a session drops its
 * pin, and pinning one restores it from the archive.
 */
export const POST = authed(async (request) => {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    conversationId?: string;
  };
  const id = body.conversationId;
  if (!id) return Response.json({ error: "conversationId is required" }, { status: 400 });

  switch (body.action) {
    case "pin":
      return Response.json(await pinSession(id));
    case "unpin":
      return Response.json(await unpinSession(id));
    case "archive":
      return Response.json(await archiveSession(id));
    case "unarchive":
      return Response.json(await unarchiveSession(id));
    default:
      return Response.json(
        { error: 'action must be one of "pin", "unpin", "archive", "unarchive"' },
        { status: 400 },
      );
  }
});
