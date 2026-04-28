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
    let cancelled = false;
    getHighlighter()
      .then((h) => {
        if (cancelled) return;
        const safeLang = isSupportedLang(lang) ? lang : "text";
        const theme = isDark ? "github-dark-default" : "github-light-default";
        try {
          const rendered = h.codeToHtml(code, { lang: safeLang, theme });
          setHtml(rendered);
        } catch {
          setHtml(null); // leave fallback visible
        }
      })
      .catch(() => {
        /* highlighter failed to boot; keep fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang, isDark]);

  if (!html) {
    return (
      <div className="not-prose">
        <pre className="bg-bg-muted border border-border rounded-md p-3 overflow-x-auto text-xs text-fg font-mono">
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  return (
    <div
      className="not-prose shiki-wrap [&>pre]:rounded-md [&>pre]:border [&>pre]:border-border [&>pre]:p-3 [&>pre]:overflow-x-auto [&>pre]:text-xs"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
