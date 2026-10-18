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

/** Supabase-style button: compact, 6px radius, brand green primary with a hover sheen. */
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
        "relative inline-flex items-center justify-center gap-1.5 rounded-md border font-medium select-none whitespace-nowrap",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-200 active:scale-[0.98]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-1 focus-visible:ring-offset-bg",
        "disabled:opacity-45 disabled:pointer-events-none",
        size === "sm" && "text-[12px] px-2.5 h-7",
        size === "md" && "text-[13px] px-3 h-8",
        size === "lg" && "text-[14px] px-4 h-10",
        variant === "primary" &&
          "btn-sheen border-[color:var(--brand-button-border)] bg-[color:var(--brand-button)] text-[color:var(--brand-button-text)] hover:brightness-110 hover:shadow-[0_0_0_3px_var(--accent-soft)]",
        variant === "secondary" &&
          "border-border-strong bg-bg-control text-fg hover:border-border-stronger hover:bg-bg-surface-300 shadow-[0_1px_0_rgba(0,0,0,0.03)]",
        variant === "outline" && "border-border-strong bg-transparent text-fg hover:border-border-stronger hover:bg-bg-hover",
        variant === "ghost" && "border-transparent text-fg-secondary hover:bg-bg-hover hover:text-fg",
        variant === "danger" &&
          "border-danger/30 bg-danger-soft text-danger hover:border-danger/50 hover:bg-danger/15",
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
        "relative inline-flex items-center justify-center h-8 w-8 rounded-md border border-transparent text-fg-muted",
        "transition-[background-color,border-color,color,transform] duration-200 hover:bg-bg-hover hover:text-fg active:scale-95",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
        active && "border-border bg-bg-surface-200 text-accent shadow-[inset_0_-1px_0_var(--brand)]",
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
    neutral: "border-border-strong bg-bg-surface-200 text-fg-secondary",
    accent: "border-brand/30 bg-accent-soft text-accent",
    success: "border-brand/30 bg-success-soft text-success",
    danger: "border-danger/30 bg-danger-soft text-danger",
    info: "border-info/30 bg-info-soft text-info",
    warning: "border-warning/30 bg-warning-soft text-warning",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 h-5 rounded-full border text-[10.5px] font-medium tracking-wide",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}


export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn("inline-block animate-spin", className)}
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
      <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
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
        "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors duration-300 disabled:opacity-40",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
        checked ? "border-brand/60 bg-brand" : "border-border-stronger bg-bg-surface-300",
      )}
      aria-label={label}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-300 [transition-timing-function:var(--ease-spring)]",
          checked ? "translate-x-[15px]" : "translate-x-[1px]",
        )}
      />
    </button>
  );
}


/** Text input in the Supabase control style. */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-md border border-border-strong bg-bg-control px-2.5 text-[13px] text-fg placeholder:text-fg-faint",
        "transition-[border-color,box-shadow] duration-200 hover:border-border-stronger",
        "focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]",
        className,
      )}
      {...props}
    />
  );
});


export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("kbd", className)}>{children}</kbd>;
}


/** A card whose border lights up in brand green under the cursor. */
export function SpotlightCard({
  className,
  children,
  as: Tag = "div",
  ...props
}: React.HTMLAttributes<HTMLElement> & { as?: "div" | "button" | "a" } & Record<string, unknown>) {
  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
    (props.onMouseMove as ((e: React.MouseEvent<HTMLElement>) => void) | undefined)?.(e);
  };
  const Comp = Tag as React.ElementType;
  return (
    <Comp {...props} onMouseMove={onMove} className={cn("spotlight", className)}>
      {children}
    </Comp>
  );
}


/**
 * Segmented control whose selection pill glides between options.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode }[];
  className?: string;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      className={cn("relative grid rounded-md border border-border bg-bg-surface-100 p-0.5", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="tablist"
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 rounded-[5px] border border-border-strong bg-bg-surface-300 shadow-sm transition-transform duration-300 [transition-timing-function:var(--ease-out)]"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${idx * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] px-2 py-1 text-[12.5px] font-medium transition-colors duration-200",
            o.value === value ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
          )}
        >
          {o.icon && <span className={cn("transition-colors", o.value === value && "text-accent")}>{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
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
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 [animation:overlay-in_0.3s_ease_both] backdrop-blur-[6px]"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-lg border border-border-strong bg-bg-overlay shadow-pop animate-scale-in",
          "flex flex-col max-h-[86vh]",
          width,
        )}
      >
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/60 to-transparent" />
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[15px] font-medium tracking-tight text-fg">{title}</h2>
            )}
            {subtitle && <p className="mt-0.5 text-[12.5px] text-fg-muted">{subtitle}</p>}
          </div>
          <IconButton onClick={onClose} title="Close" className="-mr-1.5 -mt-0.5 h-7 w-7">
            <X size={15} />
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
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => {
        timer.current = setTimeout(() => setShow(true), 250);
      }}
      onMouseLeave={() => {
        if (timer.current) clearTimeout(timer.current);
        setShow(false);
      }}
    >
      {children}
      {show && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border-strong bg-bg-overlay px-2 py-1 text-[11.5px] text-fg shadow-pop animate-scale-in">
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
              "fixed z-[70] flex min-w-[220px] flex-col overflow-y-auto rounded-lg border border-border-strong bg-bg-overlay p-1 shadow-pop animate-scale-in",
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
        "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-fg-secondary hover:bg-bg-hover hover:text-fg transition-colors text-left",
        active && "bg-bg-surface-300 text-fg",
        className,
      )}
      {...props}
    >
      {icon && <span className="text-fg-muted shrink-0">{icon}</span>}
      {children}
    </button>
  );
}
