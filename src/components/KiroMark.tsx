import mascotUrl from "../assets/kiro-mascot.svg";

/**
 * Kiro brand lockup: original mascot SVG + official wordmark PNG.
 * The wordmark has white fill on transparent bg, so it only renders
 * correctly over a dark surface or when masked. On light theme we
 * invert it with a CSS filter.
 */
export function KiroMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? 28 : size === "lg" ? 64 : 40;
  return (
    <div className="flex items-center gap-3">
      <img
        src={mascotUrl}
        alt="Kiro"
        width={dim}
        height={dim}
        className="drop-shadow-[0_0_12px_hsl(var(--accent)/0.45)]"
      />
      {/* Wordmark PNG has white glyphs on transparent bg. Invert on light
          theme so it reads black; keep as-is on dark. */}
      <img
        src="/brand/kiro-wordmark.png"
        alt="Kiro"
        className="h-5 w-auto opacity-90 invert dark:invert-0"
      />
    </div>
  );
}

export function KiroMascot({ size = 120 }: { size?: number }) {
  return (
    <img
      src={mascotUrl}
      alt="Kiro mascot"
      width={size}
      height={size}
      className="drop-shadow-[0_0_24px_hsl(var(--accent)/0.55)]"
    />
  );
}
