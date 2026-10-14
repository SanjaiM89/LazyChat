"use client";

/**
 * Text activity animation, ported from DeepSeek Harness
 * (`packages/client/ui-primitives/src/TextShimmer.tsx`).
 *
 * A running tool row needs to read as alive without claiming the model's
 * attention. dsh keeps the real, selectable text at full opacity and sweeps a
 * masked highlight across an inert decorative copy; this is the same treatment
 * in Tailwind, with the nested-instance context dropped (Omnia rows have one
 * level of text).
 */
import * as React from "react";

export function TextShimmer({
  children,
  active = false,
  className = "",
}: {
  children: React.ReactNode;
  active?: boolean;
  className?: string;
}) {
  return (
    <span className={`relative inline-grid max-w-full min-w-0 align-top ${className}`}>
      <span className="flex min-w-0 items-center">{children}</span>
      {active && (
        <span className="pointer-events-none absolute inset-0 select-none overflow-clip" aria-hidden="true">
          <span className="absolute inset-0 overflow-hidden text-fg-muted [mask-image:linear-gradient(105deg,transparent_0%,black_40%_60%,transparent_100%)] motion-reduce:animate-none">
            <span className="absolute inset-0 animate-[dsh-row-shimmer-sweep_1.6s_ease-in-out_infinite]">
              <span className="[&_*]:!text-inherit">{children}</span>
            </span>
          </span>
        </span>
      )}
    </span>
  );
}