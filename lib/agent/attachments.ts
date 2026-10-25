/**
 * Attachments.
 *
 * Every upload gets a durable identity: the bytes are stored once, under the
 * application's own data directory, and the session log records the identity
 * without the local path or the bytes themselves. A model reads an attachment
 * through the saved path, or through the content when it is text.
 *
 * Stored attachments are never removed automatically.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { DATA_DIR } from "@/lib/data-dir";

export interface AttachmentRecord {
  /** The durable identity of the attachment. */
  id: string;
  /** The name it was uploaded under. */
  name: string;
  /** The media type. */
  mime_type: string;
  /** How many bytes it holds. */
  bytes: number;
  /** When it was stored. */
  created_at: number;
  /** Whether the media type was checked against the bytes. */
  verified: boolean;
}

/** The image formats the harness accepts. */
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/**
 * The media type the bytes actually carry.
 */
export function detectMimeType(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (data.length >= 6 && data.subarray(0, 6).toString("ascii").startsWith("GIF8")) {
    return "image/gif";
  }
  if (data.length >= 2 && data[0] === 0x50 && data[1] === 0x4b) {
    return "application/zip";
  }
  if (data.length >= 4 && data.subarray(0, 4).toString("ascii") === "%PDF") {
    return "application/pdf";
  }
  return null;
}

/**
 * Store an attachment.
 *
 * Images are checked against their bytes: a file that claims to be a PNG but
 * is not is refused. Other files are stored byte for byte.
 */
export function storeAttachment(input: {
  name: string;
  mimeType?: string;
  data: Buffer;
}): AttachmentRecord {
  const detected = detectMimeType(input.data);
  const claimed = input.mimeType?.split(";")[0]?.trim() ?? "";
  if (IMAGE_MIME_TYPES.includes(claimed as (typeof IMAGE_MIME_TYPES)[number])) {
    if (!detected || detected !== claimed) {
      throw new Error(
        `The file "${input.name}" claims to be ${claimed} but its bytes say ${detected ?? "something else"}.`,
      );
    }
  }
  const id = `att_${crypto.randomBytes(8).toString("hex")}`;
  const record: AttachmentRecord = {
    id,
    name: path.basename(input.name) || "attachment",
    mime_type: claimed || detected || "application/octet-stream",
    bytes: input.data.length,
    created_at: Date.now(),
    verified: detected !== null,
  };
  const dir = path.join(DATA_DIR, "attachments", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, record.name), input.data);
  return record;
}

/** Where an attachment's bytes live. */
export function attachmentPath(record: AttachmentRecord): string {
  return path.join(DATA_DIR, "attachments", record.id, record.name);
}

/**
 * Read an attachment back.
 *
 * The read is verified: the file must still be there and must still hold the
 * bytes it was stored with.
 */
export function readAttachment(record: AttachmentRecord): {
  data: Buffer;
  path: string;
  verified: boolean;
} {
  const file = attachmentPath(record);
  const data = fs.readFileSync(file);
  return { data, path: file, verified: data.length === record.bytes };
}

/** Every stored attachment, newest first. */
export function listAttachments(): AttachmentRecord[] {
  const dir = path.join(DATA_DIR, "attachments");
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const records: AttachmentRecord[] = [];
  for (const id of entries) {
    const files = fs.readdirSync(path.join(dir, id));
    const name = files[0];
    if (!name) continue;
    const stat = fs.statSync(path.join(dir, id, name));
    records.push({
      id,
      name,
      mime_type: detectMimeType(fs.readFileSync(path.join(dir, id, name))) ?? "application/octet-stream",
      bytes: stat.size,
      created_at: stat.mtimeMs,
      verified: true,
    });
  }
  return records.sort((a, b) => b.created_at - a.created_at);
}
