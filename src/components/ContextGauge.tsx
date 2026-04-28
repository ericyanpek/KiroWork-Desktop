/**
 * Tiny context usage gauge — mirrors kiro-cli's own context % indicator.
 * Green under 70%, amber 70–90%, red above 90%. Omitted entirely when
 * kiro hasn't sent a metadata frame yet (avoids 0% flicker on boot).
 */
export function ContextGauge({ percentage }: { percentage: number | null }) {
  if (percentage === null || Number.isNaN(percentage)) return null;
  const pct = Math.max(0, Math.min(100, percentage));
  const color =
    pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-500" : "bg-accent";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 rounded-full bg-bg-muted overflow-hidden">
        <div
          className={`h-full ${color} transition-[width] duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-fg-subtle tabular-nums">
        ctx {pct.toFixed(0)}%
      </span>
    </div>
  );
}
