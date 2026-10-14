"use client";

/**
 * Run-state dot and loader, ported from DeepSeek Harness
 * (`packages/client/ui-primitives/src/StateDot.tsx`).
 *
 * The terminal card states its run state at the head of the prompt line so the
 * reader never has to infer "still going" from the presence of output. dsh
 * draws a quiet full ring behind a breathing arc while the glyph rotates; the
 * solid states paint one 6px core inside a 10px layout slot.
 */
import * as React from "react";

export type StateDotState = "done" | "warning" | "ongoing" | "error" | "idle";

const SOLID_TONE: Record<Exclude<StateDotState, "ongoing">, string> = {
  done: "text-success",
  warning: "text-warning",
  error: "text-danger",
  idle: "text-fg-muted",
};

export function StateDot({
  state,
  size,
  className = "",
}: {
  state: StateDotState;
  size?: number;
  className?: string;
}) {
  const edge = size ?? (state === "ongoing" ? 14 : 10);

  if (state === "ongoing") {
    return (
      <svg
        className={`shrink-0 text-fg-muted ${className}`}
        data-state="ongoing"
        width={edge}
        height={edge}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <g className="origin-center animate-[dsh-state-dot-spin_1.5s_linear_infinite] motion-reduce:animate-none">
          <circle
            className="fill-none stroke-current opacity-25"
            strokeWidth={2}
            strokeLinecap="round"
            cx="12"
            cy="12"
            r="9.5"
          />
          <circle
            className="fill-none stroke-current animate-[dsh-state-dot-dash_1.5s_ease-in-out_infinite] motion-reduce:animate-none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="12 150"
            cx="12"
            cy="12"
            r="9.5"
          />
        </g>
      </svg>
    );
  }

  return (
    <span
      className={`relative inline-block shrink-0 ${SOLID_TONE[state]} ${className}`}
      data-state={state}
      style={{ width: edge, height: edge }}
      aria-hidden="true"
    >
      <span className="absolute inset-[20%] rounded-full bg-current" />
    </span>
  );
}