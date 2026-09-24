import "server-only";

import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ArtifactMeta, ArtifactType } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Artifact storage — files live under data/artifacts/<id>/           */
/* ------------------------------------------------------------------ */

export const ARTIFACTS_DIR = path.join(process.cwd(), "data", "artifacts");

function ensure() {
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

const INDEX = path.join(ARTIFACTS_DIR, "_index.json");

export const EXT: Record<ArtifactType, string> = {
  text: ".txt",
  code: ".txt",
  markdown: ".md",
  html: ".html",
  svg: ".svg",
  image: ".png",
  pdf: ".pdf",
  docx: ".docx",
  xlsx: ".xlsx",
  csv: ".csv",
  mermaid: ".mmd",
  table: ".csv",
  audio: ".wav",
};

const MIME: Record<ArtifactType, string> = {
  text: "text/plain",
  code: "text/plain",
  markdown: "text/markdown",
  html: "text/html",
  svg: "image/svg+xml",
  image: "image/png",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  mermaid: "text/plain",
  table: "text/csv",
  audio: "audio/wav",
};

function index(): ArtifactMeta[] {
  ensure();
  try {
    if (!fs.existsSync(INDEX)) return [];
    return JSON.parse(fs.readFileSync(INDEX, "utf8"));
  } catch {
    return [];
  }
}

/**
 * Keep the user's original filename for display + download URLs.
 *
 * The artifact directory is already unique per id (data/artifacts/<id>/),
 * so there is no collision risk in using the original name on disk. The old
 * behaviour stored `<id><ext>` (e.g. `pM1DkDNctgOP.pdf`), which is why
 * uploads showed up as random strings in chat.
 */
function sanitizeStoredFilename(inputFilename: string, type: ArtifactType): string {
  const fallbackExt = EXT[type] || ".bin";
  let base = path.basename((inputFilename || "").trim());
  // Strip control chars / path separators that survived basename.
  base = base.replace(/[\0-\x1f\x7f]+/g, "").replace(/[\/\\]+/g, "_").trim();
  if (!base || base === "." || base === "..") {
    return `file${fallbackExt}`;
  }
  // Cap length so URLs / filesystems stay happy (keep the extension).
  if (base.length > 180) {
    const ext = path.extname(base) || fallbackExt;
    base = `${base.slice(0, 180 - ext.length)}${ext}`;
  }
  // Ensure there is an extension so mime handling stays predictable.
  if (!path.extname(base)) {
    base = `${base}${fallbackExt}`;
  }
  return base;
}

function writeIdx(list: ArtifactMeta[]) {
  fs.writeFileSync(INDEX, JSON.stringify(list, null, 2));
}

/** Save a new text/code artifact. Returns its meta. */
export async function createArtifactFile(input: {
  title: string;
  type: ArtifactType;
  content: string;
  language?: string;
  conversationId?: string;
}): Promise<ArtifactMeta> {
  const id = nanoid(12);
  const ext = EXT[input.type] || ".txt";
  const filename = `${id}${ext}`;
  ensure();
  const dir = path.join(ARTIFACTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), input.content, "utf8");

  const meta: ArtifactMeta = {
    id,
    conversationId: input.conversationId,
    title: input.title,
    type: input.type,
    filename,
    mime: MIME[input.type] || "text/plain",
    language: input.language,
    content: input.content,
    size: Buffer.byteLength(input.content),
    createdAt: Date.now(),
  };

  const list = index();
  list.unshift(meta);
  writeIdx(list.slice(0, 500));
  return meta;
}

/** Import a binary file (e.g. pdf/xlsx generated in a sandbox) as an artifact. */
export async function importArtifactFile(input: {
  title: string;
  type: ArtifactType;
  filename: string;
  data: Buffer | Uint8Array;
  language?: string;
  conversationId?: string;
}): Promise<ArtifactMeta> {
  const id = nanoid(12);
  // Preserve the uploader's filename (sanitized) instead of `<id><ext>` so
  // chat shows "report.pdf" rather than a random string. The directory is
  // already unique per artifact, so no collision handling is needed.
  const storedName = sanitizeStoredFilename(input.filename || input.title, input.type);
  ensure();
  const dir = path.join(ARTIFACTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, storedName), input.data);

  const meta: ArtifactMeta = {
    id,
    conversationId: input.conversationId,
    title: input.title,
    type: input.type,
    filename: storedName,
    mime: MIME[input.type] || "application/octet-stream",
    language: input.language,
    size: input.data.byteLength,
    createdAt: Date.now(),
  };

  const list = index();
  list.unshift(meta);
  writeIdx(list.slice(0, 500));
  return meta;
}

export function listArtifacts(conversationId?: string): ArtifactMeta[] {
  const list = index();
  if (!conversationId) return list;
  return list.filter((a) => a.conversationId === conversationId);
}

export function getArtifact(id: string): ArtifactMeta | null {
  return index().find((a) => a.id === id) ?? null;
}

export function artifactFilePath(meta: ArtifactMeta): string {
  return path.join(ARTIFACTS_DIR, meta.id, meta.filename);
}

export function readArtifactBuffer(meta: ArtifactMeta): Buffer | null {
  try {
    return fs.readFileSync(artifactFilePath(meta));
  } catch {
    return null;
  }
}

export function deleteArtifact(id: string): void {
  const list = index().filter((a) => a.id !== id);
  writeIdx(list);
  try {
    fs.rmSync(path.join(ARTIFACTS_DIR, id), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
