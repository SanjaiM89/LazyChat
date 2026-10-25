"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "@/lib/app-store";
import { useMediaQuery } from "@/lib/use-media-query";

/** The width at which the sidebar is a column beside the chat rather than a drawer over it. */
export const SIDEBAR_WIDE = "(min-width: 1024px)";

/**
 * The sidebar has two lives.
 *
 * On a wide window it is a column beside the chat and the user decides
 * whether it is there. On a narrow one it is a drawer over the chat, and it
 * starts closed — otherwise it would cover the conversation it belongs to.
 * Shrinking the window hides the drawer; growing it back restores the column
 * the user chose.
 */
export function useSidebarLayout() {
  const isWide = useMediaQuery(SIDEBAR_WIDE);
  const open = useAppStore((s) => s.sidebarOpen);
  const setOpen = useAppStore((s) => s.setSidebarOpen);

  // The choice the user made for the column, kept across a narrow window.
  const wideChoice = useRef(true);

  useEffect(() => {
    setOpen(isWide ? wideChoice.current : false);
  }, [isWide, setOpen]);

  const toggle = useCallback(() => {
    if (isWide) {
      const next = !open;
      wideChoice.current = next;
      setOpen(next);
      return;
    }
    setOpen(!open);
  }, [isWide, open, setOpen]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  return { isWide, open, toggle, close };
}
