import { useEffect, useState } from "react";
import { useIsDark } from "../hooks/useIsDark";
import { getHighlighter, isSupportedLang } from "../lib/shiki";

/**
 * Shiki-highlighted fenced code block. Renders a plain `<pre><code>` on the
 * first paint (no flash) and upgrades to colored HTML once the highlighter
 * promise resolves. Re-highlights on theme flip.
 *
 * Wrapped in `.not-prose` so @tailwindcss/typography doesn't fight shiki's
 * inline style declarations.
 */
export function CodeBlock({
  lang,
  code,
}: {
  lang?: string;
  code: string;
}) {
  const isDark = useIsDark();
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    // Clear stale highlight immediately so the plain fallback is shown while
    // we wait. This prevents the old highlighted overlay from staying visible
    // over new (different-length) content — the main cause of visual jitter.
    setHtml(null);

    // Debounce: if code changes rapidly (streaming), skip shiki until the
    // content has been stable for 200 ms. This means shiki fires once after
    // the stream ends rather than on every chunk.
    let cancelled = false;
    const tid = setTimeout(() => {
      getHighlighter()
        .then((h) => {
          if (cancelled) return;
          const safeLang = isSupportedLang(lang) ? lang : "text";
          const theme = isDark ? "github-dark-default" : "github-light-default";
          try {
            const rendered = h.codeToHtml(code, { lang: safeLang, theme });
            if (!cancelled) setHtml(rendered);
          } catch {
            /* leave plain fallback */
          }
        })
        .catch(() => { /* highlighter failed to boot */ });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(tid);
    };
  }, [code, lang, isDark]);

  // Always render the plain fallback underneath; overlay the shiki HTML once
  // ready. This prevents layout shift (jitter) because the block's height is
  // already established by the plain pre before shiki resolves.
  return (
    <div className="not-prose relative">
      {/* Plain fallback — always in DOM to anchor height */}
      <pre
        className={`bg-bg-muted border border-border rounded-md p-3 overflow-x-auto text-xs text-fg font-mono leading-5 ${html ? "invisible" : ""}`}
        aria-hidden={html ? true : undefined}
      >
        <code>{code}</code>
      </pre>
      {/* Shiki overlay — absolutely positioned over the fallback once ready */}
      {html && (
        <div
          className="absolute inset-0 shiki-wrap [&>pre]:rounded-md [&>pre]:border [&>pre]:border-border [&>pre]:p-3 [&>pre]:overflow-x-auto [&>pre]:text-xs [&>pre]:leading-5 [&>pre]:h-full"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
