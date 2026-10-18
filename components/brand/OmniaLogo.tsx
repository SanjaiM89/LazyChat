"use client";

import * as React from "react";
import { cn } from "@/components/ui";

/** The Omnia mark (the green ribbon) on its own. `animated` adds the slow breathing glow used on hero surfaces. */
export function OmniaMark({ size = 28, className, animated }: { size?: number; className?: string; animated?: boolean }) {
  return (
    <span className={cn("relative inline-flex shrink-0", animated && "omnia-mark-animated", className)} style={{ width: size, height: size }}>
      {animated && <span aria-hidden className="omnia-mark-halo" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/omnia-mark.png" alt="Omnia" width={size} height={size} className="relative h-full w-full select-none object-contain" draggable={false} />
    </span>
  );
}

/** Full lockup: mark + wordmark. The wordmark swaps to a light version on the dark theme. */
export function OmniaLogo({ height = 24, className }: { height?: number; className?: string }) {
  const width = Math.round(height * 3.19);
  return (
    <span className={cn("relative inline-flex shrink-0 select-none", className)} style={{ height, width }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/omnia-logo-light.png" alt="Omnia" className="logo-light h-full w-full object-contain" draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/omnia-logo-dark.png" alt="" aria-hidden className="logo-dark h-full w-full object-contain" draggable={false} />
    </span>
  );
}
