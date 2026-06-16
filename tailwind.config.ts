import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Geist"', '"Noto Sans SC"', "system-ui", "sans-serif"],
        display: ['"Newsreader"', '"Noto Serif SC"', '"Songti SC"', '"STSong"', "serif"],
        serif: ['"Newsreader"', '"Noto Serif SC"', '"Songti SC"', '"STSong"', "serif"],
        brush: ['"Ma Shan Zheng"', '"Newsreader"', '"Noto Serif SC"', "serif"],
        mono: ['"Geist Mono"', '"JetBrains Mono"', "monospace"],
      },
      colors: {
        ink: {
          DEFAULT: "#1a1a1a",
          soft: "#5e5b54",
          mute: "#8a857c",
        },
        paper: {
          DEFAULT: "#f7f5f0",
          elev: "#ffffff",
          warm: "#f0ece4",
        },
        line: {
          DEFAULT: "#e7e3da",
          soft: "#f0ece4",
        },
        rose: {
          DEFAULT: "#c4564a",
        },
        warm: {
          DEFAULT: "#c9892f",
        },
        sage: {
          DEFAULT: "#6b7a5a",
        },
      },
      maxWidth: {
        prose: "65ch",
        container: "1280px",
      },
      borderRadius: {
        DEFAULT: "6px",
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "24px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(26, 26, 26, 0.04), 0 8px 24px -12px rgba(26, 26, 26, 0.08)",
        ring: "0 0 0 1px var(--line)",
      },
      transitionTimingFunction: {
        soft: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [],
};

export default config;