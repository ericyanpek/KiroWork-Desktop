import { useState, type ReactNode } from "react";

/** Minimal collapsible section header with a count badge. Shared by
 *  Sessions (Phase 2a) and Skills/MCP/Steering (Phase 2b). */
export function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-border/60">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            className={`transition-transform ${open ? "rotate-90" : ""}`}
          >
            <path d="M2 1 L6 4 L2 7" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {title}
          {typeof count === "number" && (
            <span className="text-[10px] text-fg-subtle font-normal">({count})</span>
          )}
        </span>
      </button>
      {open && <div className="pb-1">{children}</div>}
    </section>
  );
}
