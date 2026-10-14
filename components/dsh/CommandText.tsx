"use client";

/**
 * Selectable command text, ported from DeepSeek Harness
 * (`packages/client/ui-primitives/src/CommandText.tsx`).
 *
 * A long command scrolls horizontally inside its prompt row instead of
 * pushing the output off screen. Keyboard focus is added only while the text
 * actually overflows, so a short command adds no Tab stop.
 */
import * as React from "react";

export function CommandText({
  text,
  label,
  className = "",
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = React.useState(false);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth);
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [text]);

  return (
    <span
      ref={ref}
      className={`block min-w-0 overflow-x-auto whitespace-pre [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2 ${className}`}
      tabIndex={overflow ? 0 : undefined}
      role={overflow ? "group" : undefined}
      aria-label={overflow ? label : undefined}
    >
      {text}
    </span>
  );
}