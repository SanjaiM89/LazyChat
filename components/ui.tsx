"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}


export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";

export function Button({
  className,
  variant = "secondary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all select-none",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-45 disabled:pointer-events-none",
        size === "sm" && "text-[13px] px-2.5 h-8",
        size === "md" && "text-sm px-3.5 h-9",
        size === "lg" && "text-[15px] px-5 h-11",
        variant === "primary" &&
          "bg-accent text-white hover:bg-accent-strong shadow-sm",
        variant === "secondary" &&
          "bg-bg-elevated border border-border text-fg hover:bg-bg-hover shadow-sm",
        variant === "outline" && "border border-border-strong text-fg hover:bg-bg-hover",
        variant === "ghost" && "text-fg-secondary hover:bg-bg-hover hover:text-fg",
        variant === "danger" &&
          "bg-danger-soft text-danger hover:bg-danger/15 border border-danger/20",
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({
  className,
  active,
  title,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      title={title}
      className={cn(
        "inline-flex items-center justify-center h-8 w-8 rounded-lg text-fg-secondary hover:bg-bg-hover hover:text-fg transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        active && "bg-accent-soft text-accent",
        className,
      )}
      {...props}
    />
  );
}


export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "accent" | "success" | "danger" | "info" | "warning";
}) {
  const tones = {
    neutral: "bg-bg-hover text-fg-secondary",
    accent: "bg-accent-soft text-accent",
    success: "bg-success-soft text-success",
    danger: "bg-danger-soft text-danger",
    info: "bg-info-soft text-info",
    warning: "bg-warning-soft text-warning",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}


export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "inline-block rounded-full border-2 border-current border-t-transparent animate-spin",
        className,
      )}
    />
  );
}


export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-accent" : "bg-border-strong",
      )}
      aria-label={label}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}


export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 animate-fade-in">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative w-full bg-bg-elevated border border-border rounded-2xl shadow-pop animate-fade-in-up",
          "flex flex-col max-h-[86vh]",
          width,
        )}
      >
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-border">
          <div>
            {title && (
              <h2 className="text-[17px] font-semibold text-fg">{title}</h2>
            )}
            {subtitle && <p className="text-[13px] text-fg-muted mt-0.5">{subtitle}</p>}
          </div>
          <IconButton onClick={onClose} title="Close" className="-mr-1">
            <X size={16} />
          </IconButton>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}


export function Tooltip({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
}) {
  const [show, setShow] = React.useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-fg text-bg text-[11px] whitespace-nowrap shadow-pop pointer-events-none animate-fade-in">
          {text}
        </span>
      )}
    </span>
  );
}


export function Dropdown({
  trigger,
  children,
  align = "right",
  open,
  onOpenChange,
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  className?: string;
}) {
  const [internal, setInternal] = React.useState(false);
  const isOpen = open ?? internal;
  const setOpen = React.useCallback(
    (o: boolean) => {
      setInternal(o);
      onOpenChange?.(o);
    },
    [onOpenChange],
  );

  const anchorRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxHeight: number;
  } | null>(null);

  const place = React.useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const r = anchor.getBoundingClientRect();
    const M = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = panel.offsetWidth || 220;
    const ph = panel.offsetHeight || 240;

    const spaceBelow = vh - r.bottom - M;
    const spaceAbove = r.top - M;
    const openUp = spaceBelow < ph && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      140,
      Math.min(openUp ? spaceAbove : spaceBelow, 560),
    );

    let left: number;
    if (align === "right") left = r.right - pw;
    else left = r.left;
    left = Math.max(M, Math.min(left, vw - pw - M));

    setPos({
      top: openUp ? undefined : r.bottom + 6,
      bottom: openUp ? vh - r.top + 6 : undefined,
      left,
      maxHeight,
    });
  }, [align]);

  React.useEffect(() => {
    if (!isOpen) {
      setPos(null);
      return;
    }
    place();
  }, [isOpen, place]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onScroll = () => place();
    const onResize = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [isOpen, place]);

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [setOpen]);

  return (
    <>
      <div
        ref={anchorRef}
        className="relative inline-flex"
        onClick={() => setOpen(!isOpen)}
      >
        {trigger}
      </div>
      {isOpen &&
        createPortal(
          <div
            ref={panelRef}
            className={cn(
              "fixed z-[70] flex min-w-[220px] flex-col rounded-xl bg-bg-elevated border border-border shadow-pop p-1.5 animate-fade-in-up",
              className,
            )}
            style={{
              top: pos?.top,
              bottom: pos?.bottom,
              left: pos?.left,
              maxHeight: pos?.maxHeight,
              visibility: pos ? "visible" : "hidden",
            }}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuItem({
  className,
  active,
  icon,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-fg hover:bg-bg-hover transition-colors text-left",
        active && "bg-accent-soft text-accent",
        className,
      )}
      {...props}
    >
      {icon && <span className="text-fg-muted shrink-0">{icon}</span>}
      {children}
    </button>
  );
}
