import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{vue,ts}"],
  theme: {
    extend: {
      colors: {
        ink: "#1f2933",
        paper: "#f7f8f5",
        line: "#d7ddd6",
        moss: "#3d6652",
        mint: "#d8eadf",
        clay: "#b45b43",
        sky: "#d9e7f2",
      },
      boxShadow: {
        soft: "0 10px 30px rgba(31, 41, 51, 0.08)",
      },
    },
  },
  plugins: [],
} satisfies Config;
