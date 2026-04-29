export function ContextGauge({ percentage }: { percentage: number | null }) {
  if (percentage === null || Number.isNaN(percentage)) return null;
  const pct = Math.max(0, Math.min(100, percentage));
  const barColor =
    pct > 90 ? "bg-status-error" : pct > 70 ? "bg-status-warning" : "bg-accent";
  const textColor =
    pct > 90 ? "text-status-error" : pct > 70 ? "text-status-warning" : "text-fg-subtle";

  return (
    <div className="flex items-center gap-2" title={`Context usage: ${pct.toFixed(0)}%`}>
      {/* Track */}
      <div className="h-1 w-14 rounded-full bg-border/60 overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-[width] duration-500 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Label */}
      <span className={`text-[10px] tabular-nums font-medium select-none ${textColor}`}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}
