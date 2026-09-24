import { NextRequest } from "next/server";
import {
  chromiumClick,
  chromiumNav,
  chromiumNavigate,
  chromiumPress,
  chromiumRead,
  chromiumScroll,
  chromiumSearch,
  chromiumShot,
  chromiumState,
  chromiumType,
  clearTimeline,
  ensureChromium,
  listSteps,
  recordStep,
  takeControl,
} from "@/lib/chromium";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  try {
    if (q.get("timeline") === "1") {
      const steps = await listSteps();
      const state = await chromiumState().catch(() => null);
      return Response.json({ control: state?.control ?? "model", steps });
    }
    if (q.get("shot") === "1") {
      await ensureChromium();
      return Response.json(await chromiumShot());
    }
    if (q.get("ensure") === "1") await ensureChromium();
    return Response.json(await chromiumState().catch(() => ({ url: "", title: "", control: "model", steps: 0 })));
  } catch (e: any) {
    return bad(e.message || "Chromium unavailable", 500);
  }
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const op = String(body.op || "");
  try {
    if (op === "take") {
      await ensureChromium();
      const doc = await takeControl("user");
      const shot = await chromiumShot().catch(() => null);
      return Response.json({ control: doc.control, ...(shot || {}) });
    }
    if (op === "release") return Response.json(await takeControl("model"));
    await ensureChromium();
    switch (op) {
      case "navigate": {
        const url = String(body.url || "");
        if (!/^https?:\/\//i.test(url)) return bad("An http(s) URL is required.");
        return Response.json(await chromiumNavigate("user", url));
      }
      case "search":
        return Response.json(
          await chromiumSearch("user", String(body.query || ""), Number(body.max) || 8),
        );
      case "click":
        return Response.json(
          await chromiumClick("user", Number(body.x), Number(body.y), body.label),
        );
      case "type":
        return Response.json(await chromiumType("user", String(body.text ?? ""), !!body.enter));
      case "press":
        return Response.json(await chromiumPress("user", String(body.key || "Enter")));
      case "scroll":
        return Response.json(
          await chromiumScroll("user", body.direction === "up" ? "up" : "down", Number(body.px) || 500),
        );
      case "back":
      case "forward":
      case "reload":
        return Response.json(await chromiumNav("user", op));
      case "read": {
        const r = await chromiumRead();
        await recordStep({
          actor: "user",
          action: "read",
          detail: (r.title || r.url || "page").slice(0, 120),
          url: r.url,
          title: r.title,
        });
        return Response.json(r);
      }
      default:
        return bad(`Unknown op: ${op || "(none)"}`);
    }
  } catch (e: any) {
    return bad(e.message || "Chromium action failed", 500);
  }
}

export async function DELETE() {
  await clearTimeline();
  return Response.json({ ok: true });
}
