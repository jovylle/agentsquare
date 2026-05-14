import type { Config } from "tailwindcss";

/** RGB triplets; opacity modifiers use rgb(var(--tw-ink-*) / <alpha-value>). */
const ink = (step: 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900) =>
  `rgb(var(--tw-ink-${step}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: ink(50),
          100: ink(100),
          200: ink(200),
          300: ink(300),
          400: ink(400),
          500: ink(500),
          600: ink(600),
          700: ink(700),
          800: ink(800),
          900: ink(900),
        },
        accent: {
          DEFAULT: "#7c5cff",
          soft: "#a691ff",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-space-grotesk)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
