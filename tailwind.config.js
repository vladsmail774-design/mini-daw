/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          0: "#0b0d10",
          1: "#12161b",
          2: "#181e25",
          3: "#222a33",
        },
        accent: {
          DEFAULT: "#4ade80",
          600: "#22c55e",
        },
        track: {
          1: "#60a5fa",
          2: "#f472b6",
          3: "#fbbf24",
          4: "#34d399",
          5: "#c084fc",
          6: "#fb7185",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
