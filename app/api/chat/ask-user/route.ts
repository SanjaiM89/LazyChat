/**
 * Answer a pending ask-user question.
 *
 * The model asked mid-turn; the browser already shows the question card, and
 * POSTs the user's picks here. Resolving releases the tool call, the model
 * continues with the answer, and the transcript renders the answered card.
 */
import { NextResponse } from "next/server";
import { answerUser, getQuestion, type AskAnswer } from "@/lib/ask-user";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("toolCallId") ?? "";
  const record = getQuestion(id);
  if (!record) return NextResponse.json({ status: "unknown" }, { status: 404 });
  return NextResponse.json(record);
}

export async function POST(request: Request) {
  let body: { toolCallId?: string; answers?: AskAnswer[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "invalid JSON" }, { status: 400 });
  }
  const toolCallId = typeof body.toolCallId === "string" ? body.toolCallId : "";
  if (!toolCallId) {
    return NextResponse.json({ detail: "toolCallId is required" }, { status: 400 });
  }

  // Validate at the wire boundary: this payload crosses the network and lands
  // straight in the model context.
  const answers: AskAnswer[] = [];
  for (const raw of Array.isArray(body.answers) ? body.answers : []) {
    const a = raw as Partial<AskAnswer>;
    if (typeof a?.id !== "string" || !a.id) continue;
    answers.push({
      id: a.id,
      selected: Array.isArray(a.selected)
        ? a.selected.filter((s): s is string => typeof s === "string")
        : [],
      ...(typeof a.custom === "string" && a.custom.trim() !== ""
        ? { custom: a.custom.slice(0, 2000) }
        : {}),
    });
  }

  const record = answerUser(toolCallId, answers);
  if (!record) {
    // Already answered, cancelled, expired, or an id this server never issued.
    const existing = getQuestion(toolCallId);
    return NextResponse.json(
      {
        detail: "question is no longer awaiting an answer",
        status: existing?.status ?? "unknown",
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, status: record.status });
}