import { tool } from "ai";
import { z } from "zod";
import { currentUser } from "@/lib/auth/context";
import { getArtifact, importArtifactFile, readArtifactBuffer } from "@/lib/artifacts";
import { buildDocx, type ImageResolver } from "./docx";
import { imageInfo } from "./image";
import { buildPdf } from "./pdf";
import { buildXlsx } from "./xlsx";
import { sheetsDocSchema, textDocSchema, type Block } from "./spec";

function artifactImages(): ImageResolver {
  const uid = currentUser()?.uid;
  return (id) => {
    const meta = getArtifact(id, uid);
    const buf = meta ? readArtifactBuffer(meta) : null;
    return buf ? imageInfo(buf) : null;
  };
}

const safeName = (title: string, ext: string) =>
  `${title.replace(/[^\w\- .()]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "document"}.${ext}`;

export function buildDocumentTools(conversationId?: string) {
  return {
    generate_document: tool({
      description:
        "Create a real downloadable Word (.docx), PDF (.pdf) or Excel (.xlsx) file from structured content and attach it to the chat. " +
        "Use for reports, proposals, letters, summaries, invoices (docx/pdf) and data tables, budgets, trackers with formulas (xlsx). " +
        "Write the full content yourself in `spec`; no sandbox needed. For non-Latin scripts prefer docx (PDF uses Latin fonts).",
      inputSchema: z.object({
        kind: z.enum(["docx", "pdf", "xlsx"]),
        title: z.string().max(160).describe("Document title (also used for the file name)"),
        spec: z
          .record(z.string(), z.unknown())
          .describe(
            'docx/pdf: {"blocks":[{"type":"heading","level":1,"text":"..."},{"type":"paragraph","text":"**bold** text"},{"type":"list","items":["a","b"],"ordered":false},{"type":"table","header":["A","B"],"rows":[["1","2"]]},{"type":"pagebreak"}]}. ' +
              'xlsx: {"sheets":[{"name":"Budget","header":["Item","Cost"],"rows":[["Rent",1200],["Total",{"formula":"SUM(B2:B2)"}]],"numberFormats":{"B":"#,##0.00"}}]}',
          ),
      }),
      execute: async ({ kind, title, spec }) => {
        let data: Buffer;
        let detail: Record<string, unknown> = {};
        if (kind === "xlsx") {
          const parsed = sheetsDocSchema.safeParse(spec);
          if (!parsed.success) return { ok: false as const, error: `Invalid xlsx spec: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
          data = buildXlsx(parsed.data);
          detail = { sheets: parsed.data.sheets.length };
        } else {
          const parsed = textDocSchema.safeParse(spec);
          if (!parsed.success) return { ok: false as const, error: `Invalid ${kind} spec: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
          const blocks = parsed.data.blocks as Block[];
          const images = artifactImages();
          data = kind === "docx" ? await buildDocx(title, blocks, images) : await buildPdf(title, blocks, images);
          detail = { sections: blocks.length };
        }
        const meta = await importArtifactFile({ title, type: kind, filename: safeName(title, kind), data, conversationId });
        return {
          ok: true as const,
          artifactId: meta.id,
          title: meta.title,
          type: meta.type,
          filename: meta.filename,
          size: meta.size,
          url: `/api/files/${meta.id}/${encodeURIComponent(meta.filename)}`,
          ...detail,
          message: `Created ${meta.filename} (${Math.max(1, Math.round((meta.size ?? 0) / 1024))} KB). The user can open it in the side panel or download it from the chat.`,
        };
      },
    }),
  };
}
