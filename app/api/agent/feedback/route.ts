import { authed } from "@/lib/auth/context";
import {
  FEEDBACK_CATEGORIES,
  listFeedback,
  recordFeedback,
  type FeedbackCategory,
  type FeedbackRating,
} from "@/lib/agent/feedback";

export const GET = authed(async (request) => {
  const conversationId = new URL(request.url).searchParams.get("conversationId") ?? "";
  if (!conversationId) return Response.json({ error: "conversationId is required" }, { status: 400 });
  return Response.json({ feedback: listFeedback(conversationId) });
});

export const POST = authed(async (request) => {
  const body = (await request.json().catch(() => ({}))) as {
    conversationId?: string;
    messageId?: string;
    rating?: FeedbackRating;
    category?: FeedbackCategory;
    note?: string;
  };
  if (!body.conversationId || !body.messageId) {
    return Response.json({ error: "conversationId and messageId are required" }, { status: 400 });
  }
  if (body.rating !== "up" && body.rating !== "down") {
    return Response.json({ error: "rating must be up or down" }, { status: 400 });
  }
  if (body.category && !FEEDBACK_CATEGORIES.includes(body.category)) {
    return Response.json({ error: `unknown category: ${body.category}` }, { status: 400 });
  }
  const feedback = recordFeedback(body.conversationId, {
    message_id: body.messageId,
    rating: body.rating,
    category: body.category,
    note: body.note,
  });
  return Response.json({ feedback });
});
