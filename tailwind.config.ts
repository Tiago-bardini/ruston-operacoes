import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#e11d2a",
          dark: "#0b0b0f",
          panel: "#15151d",
          muted: "#8b8b9a",
        },
      },
    },
  },
  plugins: [],
};

export default config;
