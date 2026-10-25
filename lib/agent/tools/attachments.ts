import { tool } from "ai";
import { z } from "zod";

import { listAttachments, readAttachment, type AttachmentRecord } from "@/lib/agent/attachments";

/**
 * The tools that let a model read an attachment.
 *
 * An attachment is addressed by its durable identity; the model never sees a
 * browser path or a provider URL.
 */
export function buildAttachmentTools() {
  return {
    attachment_list: tool({
      description:
        "List the attachments that were uploaded to this conversation, newest first. Each entry carries a durable id, the file name, its media type and its size.",
      inputSchema: z.object({}),
      execute: async () => ({
        attachments: listAttachments().map((a) => ({
          id: a.id,
          name: a.name,
          mime_type: a.mime_type,
          bytes: a.bytes,
        })),
      }),
    }),

    attachment_read: tool({
      description:
        "Read an attachment by its id. Text files come back as text; anything else comes back as its metadata and the path it was stored at.",
      inputSchema: z.object({
        id: z.string().describe("The attachment id."),
        max_chars: z
          .number()
          .int()
          .min(1)
          .max(200_000)
          .optional()
          .describe("How many characters of a text file to return. Defaults to all of it."),
      }),
      execute: async ({ id, max_chars }: { id: string; max_chars?: number }) => {
        const record = listAttachments().find((a) => a.id === id);
        if (!record) return { error: `There is no attachment with the id "${id}".` };
        const read = readAttachment(record);
        if (!read.verified) {
          return { error: `The attachment "${record.name}" no longer matches what was stored.` };
        }
        if (record.mime_type.startsWith("text/") || isTextLike(record)) {
          const text = read.data.toString("utf8");
          const limit = max_chars ?? text.length;
          return {
            id: record.id,
            name: record.name,
            mime_type: record.mime_type,
            bytes: record.bytes,
            text: text.slice(0, limit),
            truncated: text.length > limit,
          };
        }
        return {
          id: record.id,
          name: record.name,
          mime_type: record.mime_type,
          bytes: record.bytes,
          path: read.path,
          note: "This file is not text. Read it with the file tools if the path is inside the workspace.",
        };
      },
    }),
  };
}

function isTextLike(record: AttachmentRecord): boolean {
  return /\b(json|javascript|typescript|xml|yaml|csv|markdown|html|css)\b/.test(record.mime_type);
}
