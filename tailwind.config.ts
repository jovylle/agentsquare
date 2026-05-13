import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f7f7fb",
          100: "#eceef6",
          200: "#d6dae9",
          300: "#aeb4cf",
          400: "#7a82a8",
          500: "#525a83",
          600: "#3b4267",
          700: "#2a2f4b",
          800: "#1b1f33",
          900: "#10131f",
        },
        accent: {
          DEFAULT: "#7c5cff",
          soft: "#a691ff",
        },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
