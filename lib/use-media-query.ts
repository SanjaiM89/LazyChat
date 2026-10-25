"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Tracks a CSS media query.
 *
 * The subscription only fires when the query starts or stops matching, so a
 * window resize that does not cross a breakpoint costs nothing.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  // The server has no window; the first client render corrects it.
  const getServerSnapshot = useCallback(() => false, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
