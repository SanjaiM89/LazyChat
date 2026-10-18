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
        <div>
          <label className="eyebrow mb-1.5 flex items-center gap-1.5">
            <Type size={13} /> Font
          </label>
          <div className="grid max-h-56 grid-cols-1 gap-0.5 overflow-y-auto rounded-lg border border-border bg-bg-surface-100 p-1">
            {DISPLAY_FONTS.map((f) => {
              const active = display.font === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setDisplay({ font: f.id })}
                  className={`relative flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors duration-200 ${
                    active
                      ? "border-brand/40 bg-accent-soft text-accent"
                      : "border-transparent text-fg-secondary hover:bg-bg-hover hover:text-fg"
                  }`}
                >
                  <span className="font-mono text-[10.5px] uppercase tracking-wider opacity-80">
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

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="eyebrow">
              Font size
            </label>
            <span className="rounded-md border border-border bg-bg-surface-200 px-2 py-0.5 font-mono text-[11.5px] text-fg-secondary tabular-nums">
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
              className="flex-1 accent-[var(--brand)]"
              aria-label="Font size"
            />
            <span className="text-[16px] text-fg-muted">A</span>
          </div>
          <p
            className="mt-2 rounded-lg border border-border bg-bg-surface-100 px-3 py-2 text-fg-secondary"
            style={{
              fontFamily: fontStack(display.font),
              fontSize: display.fontSize,
            }}
          >
            Preview: the quick brown fox jumps over the lazy dog.
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="eyebrow">
              Text width
            </label>
            <span className="rounded-md border border-border bg-bg-surface-200 px-2 py-0.5 font-mono text-[11.5px] text-fg-secondary tabular-nums">
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
            className="w-full accent-[var(--brand)]"
            aria-label="Text width"
          />
          <div className="mt-2 flex justify-center">
            <div
              className="rounded-md border border-dashed border-brand/40 bg-accent-soft py-2 text-center font-mono text-[11px] text-accent transition-all duration-300"
              style={{ width: `${(display.contentWidth / MAX_WIDTH) * 100}%` }}
            >
              {display.contentWidth}px wide
            </div>
          </div>
        </div>

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
