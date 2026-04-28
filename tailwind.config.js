import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Kiro brand palette — HSL values mirror kiro.dev's CSS vars.
        // Use as bg-prey-900, text-purple-300, etc.
        prey: {
          100: "hsl(260 12% 95%)",
          200: "hsl(264 7% 86%)",
          300: "hsl(263 7% 76%)",
          400: "hsl(260 6% 58%)",
          500: "hsl(0 0% 36%)",
          600: "hsl(267 6% 29%)",
          700: "hsl(266 13% 21%)",
          750: "hsl(264 12% 16%)",
          800: "hsl(270 12% 13%)",
          900: "hsl(266 14% 10%)",
        },
        purple: {
          300: "hsl(264 100% 81%)",
          400: "hsl(263 100% 69%)",
          500: "hsl(264 100% 64%)",
          600: "hsl(270 79% 53%)",
          700: "hsl(274 87% 43%)",
          900: "hsl(264 64% 32%)",
        },
        // Semantic tokens backed by CSS vars — switch with .dark class
        bg: {
          DEFAULT: "hsl(var(--bg))",
          elevated: "hsl(var(--bg-elevated))",
          muted: "hsl(var(--bg-muted))",
        },
        fg: {
          DEFAULT: "hsl(var(--fg))",
          muted: "hsl(var(--fg-muted))",
          subtle: "hsl(var(--fg-subtle))",
        },
        border: {
          DEFAULT: "hsl(var(--border))",
          strong: "hsl(var(--border-strong))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          strong: "hsl(var(--accent-strong))",
          foreground: "hsl(var(--accent-fg))",
        },
      },
      fontFamily: {
        mono: [
          '"Fragment Mono"',
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
    },
  },
  plugins: [typography],
};
