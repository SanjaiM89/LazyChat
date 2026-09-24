import { NextRequest } from "next/server";
import { importArtifactFile } from "@/lib/artifacts";
import type { ArtifactType } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXT: Record<string, ArtifactType> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".xls": "xlsx",
  ".csv": "csv",
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".html": "html",
  ".htm": "html",
  ".svg": "svg",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".js": "code",
  ".ts": "code",
  ".tsx": "code",
  ".jsx": "code",
  ".py": "code",
  ".json": "code",
  ".css": "code",
  ".xml": "code",
  ".yaml": "code",
  ".yml": "code",
  ".sh": "code",
};

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll("files") as File[];
  const conversationId = (form.get("conversationId") as string) || undefined;

  if (!files.length) {
    return Response.json({ error: "no files" }, { status: 400 });
  }

  const created = [];
  for (const file of files) {
    const name = file.name;
    const ext = name.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() || "";
    const type = EXT[ext] || "text";
    const buf = Buffer.from(await file.arrayBuffer());
    const meta = await importArtifactFile({
      title: name,
      type,
      filename: name,
      data: buf,
      conversationId,
    });
    created.push(meta);
  }
  return Response.json({ artifacts: created });
}
