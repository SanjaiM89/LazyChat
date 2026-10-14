import { NextResponse } from "next/server";

import { ensureReady } from "@/lib/brain/bootstrap";
import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { deleteShared, updateShared } from "@/lib/dsh/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  await ensureReady();
  const { id } = await params;
  let body: { text?: string; tags?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: "request body must be JSON" }, { status: 400 });
  }
  try {
    const client = await FalkorClient.get();
    const mem = await updateShared(client, decodeURIComponent(id), body);
    if (!mem) return NextResponse.json({ detail: "unknown memory" }, { status: 404 });
    return NextResponse.json({ memory: mem });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  await ensureReady();
  const { id } = await params;
  try {
    const client = await FalkorClient.get();
    const deleted = await deleteShared(client, decodeURIComponent(id));
    if (!deleted) return NextResponse.json({ detail: "unknown memory" }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof GraphError) return NextResponse.json({ detail: err.message }, { status: 503 });
    throw err;
  }
}
