import { NextRequest } from "next/server";
import {
  sandboxHealth,
  sandboxExec,
  sandboxWriteFile,
  sandboxReadFile,
  sandboxListFiles,
  sandboxScreenshot,
  sandboxDownload,
  killSandbox,
  startSandbox,
  listSandboxes,
  deleteSandbox,
} from "@/lib/sandbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const seg = req.nextUrl.pathname.split("/").filter(Boolean);
  if (!seg[2]) {
    return Response.json(await sandboxHealth());
  }
  if (seg[2] === "list") {
    return Response.json(await listSandboxes());
  }
  return handle(req);
}

const SANDBOX_URL = process.env.SANDBOX_URL || "http://127.0.0.1:8787";

async function handle(req: NextRequest) {
  const segments = req.nextUrl.pathname.split("/").filter(Boolean);
  const [, , id, op] = segments;
  const path = req.nextUrl.searchParams.get("path") || "/workspace";

  try {
    switch (op) {
      case "events": {
        const signal = req.signal;
        const up = await fetch(`${SANDBOX_URL}/containers/${id}/events`, {
          cache: "no-store",
          signal,
        });
        if (!up.ok || !up.body) {
          return Response.json({ error: `sandbox events ${up.status}` }, { status: up.status });
        }
        return new Response(up.body, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            "x-accel-buffering": "no",
          },
        });
      }
      case "read": {
        return Response.json({ content: await sandboxReadFile(id, path) });
      }
      case "list": {
        return Response.json({ files: await sandboxListFiles(id, path) });
      }
      case "screenshot": {
        const image = await sandboxScreenshot(id);
        return Response.json({ image });
      }
      case "download": {
        const buf = await sandboxDownload(id, path);
        return new Response(new Uint8Array(buf), {
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": `attachment; filename="${encodeURIComponent(path.split("/").pop() || "file")}"`,
          },
        });
      }
      default:
        return Response.json({ error: `unknown op ${op}` }, { status: 404 });
    }
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const segments = req.nextUrl.pathname.split("/").filter(Boolean);
  const [, , id, op] = segments;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
  }

  try {
    switch (op) {
      case "exec": {
        const res = await sandboxExec(id, body.command, {
          stream: body.stream,
          timeout: body.timeout,
        });
        return Response.json(res);
      }
      case "write": {
        await sandboxWriteFile(id, body.path, body.content ?? "");
        return Response.json({ ok: true });
      }
      case "kill": {
        await killSandbox(id);
        return Response.json({ ok: true });
      }
      case "start": {
        await startSandbox(id);
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ error: `unknown op ${op}` }, { status: 404 });
    }
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const segments = req.nextUrl.pathname.split("/").filter(Boolean);
  const [, , id] = segments;
  if (!id) return Response.json({ error: "sandbox id required" }, { status: 400 });
  try {
    await deleteSandbox(id);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
