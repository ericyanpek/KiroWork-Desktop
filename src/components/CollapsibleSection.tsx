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
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-subtle hover:text-fg hover:bg-bg-muted/50 transition-colors duration-150"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          className="flex-shrink-0 transition-transform duration-200"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          <path d="M2 1 L6 4 L2 7" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="flex-1">{title}</span>
        {typeof count === "number" && count > 0 && (
          <span className="badge badge-default ml-auto">{count}</span>
        )}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </section>
  );
}
