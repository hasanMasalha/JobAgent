import type { Config } from "tailwindcss";

// Semantic colour tokens — values live in app/globals.css (light + .dark).
const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;
const tone = (name: string) => ({
  DEFAULT: token(name),
  soft: token(`${name}-soft`),
  text: token(`${name}-text`),
});

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",

        canvas: token("canvas"),
        surface: { DEFAULT: token("surface"), sunken: token("surface-sunken") },
        line: { DEFAULT: token("line"), strong: token("line-strong") },
        ink: { DEFAULT: token("ink"), muted: token("ink-muted"), subtle: token("ink-subtle") },
        brand: {
          DEFAULT: token("brand"),
          hover: token("brand-hover"),
          text: token("brand-text"),
          soft: token("brand-soft"),
          on: token("on-brand"),
        },
        ring: token("ring"),
        scrim: token("scrim"),
        accent: tone("accent"),
        info: tone("info"),
        progress: tone("progress"),
        success: tone("success"),
        waiting: tone("waiting"),
        attention: tone("attention"),
        danger: tone("danger"),
      },
      fontFamily: {
        // Public Sans for all interface text; Source Serif 4 only for the
        // "document voice" — page titles and headline numbers.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "ui-serif", "Georgia", "serif"],
      },
      fontSize: {
        // Role-named steps on top of Tailwind's default scale.
        // [size, { lineHeight, letterSpacing, fontWeight }]
        caption: ["0.75rem", { lineHeight: "1rem" }],                                   // 12/16
        "body-sm": ["0.8125rem", { lineHeight: "1.25rem" }],                            // 13/20
        body: ["0.9375rem", { lineHeight: "1.5rem" }],                                  // 15/24
        "title-card": ["1rem", { lineHeight: "1.375rem", fontWeight: "600" }],          // 16/22
        "title-section": ["1.125rem", { lineHeight: "1.625rem", fontWeight: "600" }],   // 18/26
        "title-page": ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.01em", fontWeight: "600" }], // 28/34
        "title-page-sm": ["1.5rem", { lineHeight: "1.875rem", letterSpacing: "-0.01em", fontWeight: "600" }], // 24/30
        figure: ["2.5rem", { lineHeight: "2.75rem", letterSpacing: "-0.02em", fontWeight: "600" }], // 40/44
      },
      spacing: {
        // Layout rhythm. Everything else stays on Tailwind's 4px grid.
        gutter: "1rem",        // page side padding, mobile
        "gutter-lg": "1.5rem", // page side padding, ≥sm
        section: "2rem",       // gap between page sections
      },
      borderRadius: {
        // Radius follows hierarchy: smaller for controls, larger for containers.
        control: "0.5rem",  // 8px — buttons, inputs
        card: "0.75rem",    // 12px — cards, panels
        overlay: "1rem",    // 16px — modals, sheets
      },
      boxShadow: {
        // Cards sit flat on a border; only floating layers get shadow.
        raised: "0 1px 2px rgb(var(--shadow-color) / 0.06), 0 1px 1px rgb(var(--shadow-color) / 0.04)",
        overlay: "0 12px 32px -8px rgb(var(--shadow-color) / 0.24), 0 2px 6px rgb(var(--shadow-color) / 0.08)",
      },
      keyframes: {
        // Toast.tsx already references animate-fade-in, which was never defined.
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
