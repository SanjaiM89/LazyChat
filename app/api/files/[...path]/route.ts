import { NextRequest } from "next/server";
import { getArtifact, readArtifactBuffer } from "@/lib/artifacts";

export const dynamic = "force-dynamic";

/** Serve artifact files: /api/files/<artifactId>/<filename> */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (!path || path.length < 2) {
    return Response.json({ error: "bad path" }, { status: 400 });
  }
  const [id, ...rest] = path;
  const meta = getArtifact(id);
  if (!meta) return Response.json({ error: "artifact not found" }, { status: 404 });

  const buf = readArtifactBuffer(meta);
  if (!buf) return Response.json({ error: "missing file" }, { status: 404 });

  // Only serve the exact file the artifact metadata points at.
  // Next.js already URL-decodes path params, but decode defensively so
  // filenames with spaces / unicode / % encodings still match.
  const requested = rest
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join("/");
  if (requested !== meta.filename) {
    return Response.json({ error: "filename mismatch" }, { status: 404 });
  }

  const isText = /text|markdown|json|svg|xml|javascript|css|html|plain/.test(meta.mime);
  const downloadName = meta.filename || "file";
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": meta.mime || "application/octet-stream",
      "content-disposition": `inline; filename="${downloadName.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      "cache-control": "public, max-age=3600",
      ...(isText ? { "x-content-type-options": "nosniff" } : {}),
    },
  });
}
