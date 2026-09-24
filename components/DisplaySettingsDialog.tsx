"use client";

import * as React from "react";
import { RotateCcw, Type } from "lucide-react";
import { Modal, Button } from "@/components/ui";
import { useAppStore } from "@/lib/app-store";
import {
  DISPLAY_FONTS,
  DEFAULT_DISPLAY,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_WIDTH,
  MAX_WIDTH,
  fontStack,
} from "@/lib/display";

/* ------------------------------------------------------------------ */
/*  Display settings — font family, font size, text width + reset       */
/* ------------------------------------------------------------------ */

export function DisplaySettingsDialog() {
  const open = useAppStore((s) => s.displayOpen);
  const setOpen = useAppStore((s) => s.setDisplayOpen);
  const display = useAppStore((s) => s.display) ?? DEFAULT_DISPLAY;
  const setDisplay = useAppStore((s) => s.setDisplay);
  const resetDisplay = useAppStore((s) => s.resetDisplay);

  const isDefault =
    display.font === DEFAULT_DISPLAY.font &&
    display.fontSize === DEFAULT_DISPLAY.fontSize &&
    display.contentWidth === DEFAULT_DISPLAY.contentWidth;

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Display settings"
      subtitle="Font, text size and chat width. Saved on this device."
      width="max-w-md"
    >
      <div className="flex flex-col gap-5">
        {/* Font */}
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-fg-muted">
            <Type size={13} /> Font
          </label>
          <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-xl border border-border bg-bg-subtle/40 p-1.5">
            {DISPLAY_FONTS.map((f) => {
              const active = display.font === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setDisplay({ font: f.id })}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-left transition-colors ${
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-fg-secondary hover:bg-bg-hover hover:text-fg"
                  }`}
                >
                  <span className="text-[11px] font-medium uppercase tracking-wide opacity-70">
                    {f.name}
                  </span>
                  <span
                    className="truncate text-[15px] text-fg"
                    style={{ fontFamily: f.stack }}
                  >
                    Ag quick brown fox 123
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Font size */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[12px] font-semibold uppercase tracking-wide text-fg-muted">
              Font size
            </label>
            <span className="rounded-md bg-bg-inset px-2 py-0.5 font-mono text-[12px] text-fg-secondary">
              {display.fontSize}px
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-fg-muted">A</span>
            <input
              type="range"
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              step={1}
              value={display.fontSize}
              onChange={(e) => setDisplay({ fontSize: Number(e.target.value) })}
              className="flex-1 accent-[var(--accent)]"
              aria-label="Font size"
            />
            <span className="text-[16px] text-fg-muted">A</span>
          </div>
          <p
            className="mt-2 rounded-lg border border-border bg-bg-subtle/50 px-3 py-2 text-fg-secondary"
            style={{
              fontFamily: fontStack(display.font),
              fontSize: display.fontSize,
            }}
          >
            Preview: the quick brown fox jumps over the lazy dog.
          </p>
        </div>

        {/* Text width */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[12px] font-semibold uppercase tracking-wide text-fg-muted">
              Text width
            </label>
            <span className="rounded-md bg-bg-inset px-2 py-0.5 font-mono text-[12px] text-fg-secondary">
              {display.contentWidth}px
            </span>
          </div>
          <input
            type="range"
            min={MIN_WIDTH}
            max={MAX_WIDTH}
            step={10}
            value={display.contentWidth}
            onChange={(e) => setDisplay({ contentWidth: Number(e.target.value) })}
            className="w-full accent-[var(--accent)]"
            aria-label="Text width"
          />
          <div className="mt-2 flex justify-center">
            <div
              className="rounded-lg border border-dashed border-border-strong bg-bg-subtle/50 py-2 text-center text-[11px] text-fg-muted transition-all"
              style={{ width: `${(display.contentWidth / MAX_WIDTH) * 100}%` }}
            >
              {display.contentWidth}px wide
            </div>
          </div>
        </div>

        {/* Reset */}
        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-[12px] text-fg-muted">
            {isDefault ? "Using defaults" : "Customized — reset anytime"}
          </p>
          <Button
            variant="outline"
            onClick={resetDisplay}
            disabled={isDefault}
          >
            <RotateCcw size={14} /> Reset to default
          </Button>
        </div>
      </div>
    </Modal>
  );
}
