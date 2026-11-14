import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pitch: { 900: "#07120c", 800: "#0c1d14", 700: "#12301f", 600: "#1b4a30" },
        lime: { glow: "#b6ff3c" },
      },
    },
  },
  plugins: [],
};
export default config;
