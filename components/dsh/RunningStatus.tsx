"use client";

/**
 * Live run clock, ported from DeepSeek Harness
 * (`packages/client/ui-chat/src/client/chat/RunningStatus.tsx`).
 *
 * dsh labels a running turn "Deep diving"; the wording here is Omnia's, but
 * everything else is the same surface: a hairline divider above the status, an
 * animated tail glyph, shimmering text with a tabular-nums clock that ticks
 * once a second, and a visually-hidden live region so screen readers hear the
 * run state without hearing every tick.
 *
 * The clock lives here rather than in the transcript's render path so a tick
 * repaints two spans instead of the whole message list.
 */
import * as React from "react";
import { TextShimmer } from "./TextShimmer";

/** How often the elapsed-time clock repaints. */
const CLOCK_INTERVAL_MS = 1000;

/**
 * Format elapsed milliseconds the way the label reads: seconds under a minute,
 * then minutes and seconds, then hours.
 */
export function formatRunDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${Math.max(1, total)}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}

/**
 * The static tail glyph: dsh masks an APNG when the browser supports it and
 * falls back to this stroked path otherwise. Only the path is ported — the
 * animated mask is a DeepSeek-branded asset, and Omnia has no equivalent, so
 * the glyph carries a small CSS breathe instead.
 */
const TAIL_PATH =
  "M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742";

function RunningTail() {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center overflow-hidden text-info"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        className="animate-[dsh-tail-breathe_1.8s_ease-in-out_infinite] motion-reduce:animate-none"
      >
        <path d={TAIL_PATH} stroke="currentColor" strokeWidth={1} />
      </svg>
    </span>
  );
}

export function RunningStatus({ startTime }: { startTime?: number }) {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    setNow(Date.now());
    if (startTime === undefined) return undefined;
    const timer = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [startTime]);

  const label =
    startTime === undefined
      ? "Working"
      : `Working for ${formatRunDuration(Math.max(1000, now - startTime))} ···`;

  return (
    <div className="flex flex-col items-start text-info" data-chat-running>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Working
      </span>
      <span aria-hidden className="my-2.5 h-px w-full bg-border/70" />
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <RunningTail />
        <TextShimmer active className="min-w-0 text-[12px] leading-[22px] [font-variant-numeric:tabular-nums]">
          {label}
        </TextShimmer>
      </span>
    </div>
  );
}