"use client";

import * as React from "react";
import { PdfViewer } from "@/components/viewers/PdfViewer";
import { DocxViewer } from "@/components/viewers/DocxViewer";
import { XlsxViewer } from "@/components/viewers/XlsxViewer";
import {
  MarkdownViewer,
  CodeViewer,
  HtmlViewer,
  ImageViewer,
  CsvViewer,
} from "@/components/viewers/TextViewer";
import type { ArtifactMeta, ArtifactType } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Dispatches an artifact to the right viewer by type.                */
/* ------------------------------------------------------------------ */

export function artifactUrl(a: ArtifactMeta): string {
  return `/api/files/${a.id}/${a.filename}`;
}

export function ArtifactViewer({ artifact }: { artifact: ArtifactMeta }) {
  const url = artifactUrl(artifact);
  switch (artifact.type as ArtifactType) {
    case "pdf":
      return <PdfViewer url={url} />;
    case "docx":
      return <DocxViewer url={url} />;
    case "xlsx":
      return <XlsxViewer url={url} />;
    case "csv":
      return <CsvViewer url={url} />;
    case "table":
      return <CsvViewer url={url} />;
    case "markdown":
      return <MarkdownViewer url={url} />;
    case "html":
      return <HtmlViewer url={url} />;
    case "svg":
    case "image":
      return <ImageViewer url={url} label={artifact.title} />;
    case "mermaid":
      return <CodeViewer url={url} language="mermaid" />;
    case "text":
      return <CodeViewer url={url} />;
    case "code":
      return <CodeViewer url={url} language={artifact.language} />;
    default:
      return <CodeViewer url={url} />;
  }
}
