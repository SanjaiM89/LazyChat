"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Eye, Square } from "lucide-react";
import { Spinner, cn } from "@/components/ui";
import { modelLabel, providerGlyph } from "@/lib/app-store";
import { BrandIcon, modelIconKey } from "@/components/brand/BrandIcon";
import type { ChatRunSummary } from "@/lib/types";
import type { ChatController } from "@/lib/use-chat";


function elapsed(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function BackgroundRunBar({
  run,
  chat,
}: {
  run: ChatRunSummary;
  chat: ChatController;
}) {
  return null;
}
