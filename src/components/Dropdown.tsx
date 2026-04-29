import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Minimal headless dropdown. Native CSS, no Radix — this is the only
 * menu the app needs. Click-away + Escape close; focus-trap is overkill
 * for Phase 2.
 */
export function Dropdown({
  label,
  children,
  align = "left",
  className = "",
  triggerClassName,
}: {
  label: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName ?? "inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-bg-muted/40 px-3 py-1 text-xs font-medium text-fg-muted hover:text-fg hover:border-accent/40 hover:bg-bg-muted/70 transition-colors duration-150"}
      >
        {label}
        <svg
          width="9" height="9" viewBox="0 0 10 10"
          className={`opacity-50 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 4 L5 7 L8 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className={`absolute z-20 mt-1.5 min-w-[220px] max-h-[70vh] overflow-y-auto rounded-xl border border-border/80 bg-bg-elevated shadow-xl shadow-black/20 py-1.5 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-xs transition-colors duration-100 ${
        active
          ? "bg-accent/12 text-accent-strong font-medium"
          : "text-fg-muted hover:bg-bg-muted/80 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
