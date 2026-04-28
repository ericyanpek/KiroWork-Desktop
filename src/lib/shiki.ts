import type { HighlighterGeneric } from "@shikijs/types";

/**
 * Fine-grained shiki highlighter. We use shiki/core + the JavaScript RegExp
 * engine (no WASM at all) + explicit lang imports — default shiki imports
 * pull every grammar in the bundle, inflating the Vite output by ~3-5 MB of
 * extra chunks (cpp, wolfram, emacs-lisp, etc.) that chat output never uses.
 *
 * This setup costs ~300 kB gzipped for the 14 langs we actually care about.
 *
 * Unknown langs fall back to "text" in CodeBlock.
 */

type Lang = string;
type Theme = "github-dark-default" | "github-light-default";

const SUPPORTED_LANGS = new Set<string>([
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "rust",
  "shellscript",
  "bash",
  "json",
  "yaml",
  "markdown",
  "html",
  "css",
  "sql",
  "diff",
]);

export const SHIKI_THEMES = [
  "github-dark-default",
  "github-light-default",
] as const;

type WebHighlighter = HighlighterGeneric<Lang, Theme>;
let promise: Promise<WebHighlighter> | null = null;

export function getHighlighter(): Promise<WebHighlighter> {
  if (!promise) {
    promise = (async () => {
      // Explicit lang imports so Rollup tree-shakes unused grammars. Each
      // import is a function returning the grammar json — shiki.loadLanguage
      // accepts them as lazy loaders.
      const [
        core,
        engineJs,
        ts,
        tsx,
        js,
        jsx,
        python,
        rust,
        shell,
        bash,
        json,
        yaml,
        md,
        html,
        css,
        sql,
        diff,
        themeDark,
        themeLight,
      ] = await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
        import("@shikijs/langs/typescript"),
        import("@shikijs/langs/tsx"),
        import("@shikijs/langs/javascript"),
        import("@shikijs/langs/jsx"),
        import("@shikijs/langs/python"),
        import("@shikijs/langs/rust"),
        import("@shikijs/langs/shellscript"),
        import("@shikijs/langs/bash"),
        import("@shikijs/langs/json"),
        import("@shikijs/langs/yaml"),
        import("@shikijs/langs/markdown"),
        import("@shikijs/langs/html"),
        import("@shikijs/langs/css"),
        import("@shikijs/langs/sql"),
        import("@shikijs/langs/diff"),
        import("@shikijs/themes/github-dark-default"),
        import("@shikijs/themes/github-light-default"),
      ]);

      return core.createHighlighterCore({
        engine: engineJs.createJavaScriptRegexEngine(),
        themes: [themeDark.default, themeLight.default],
        langs: [
          ts.default,
          tsx.default,
          js.default,
          jsx.default,
          python.default,
          rust.default,
          shell.default,
          bash.default,
          json.default,
          yaml.default,
          md.default,
          html.default,
          css.default,
          sql.default,
          diff.default,
        ],
      }) as Promise<WebHighlighter>;
    })();
  }
  return promise;
}

export function isSupportedLang(lang: string | undefined): lang is Lang {
  return !!lang && SUPPORTED_LANGS.has(lang);
}
