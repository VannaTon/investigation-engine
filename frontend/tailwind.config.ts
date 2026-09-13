import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F3F6F8",
        surface: "#FFFFFF",
        ink: "#17212B",
        slate: "#627181",
        steel: "#D5DEE5",
        incident: "#B4232D",
      },
      boxShadow: {
        panel: "0 1px 2px rgb(23 33 43 / 0.05), 0 8px 24px rgb(23 33 43 / 0.04)",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Consolas", "Liberation Mono", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
