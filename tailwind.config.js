/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          0: "rgb(var(--md-bg-0-rgb) / <alpha-value>)",
          1: "rgb(var(--md-bg-1-rgb) / <alpha-value>)",
          2: "rgb(var(--md-bg-2-rgb) / <alpha-value>)",
          3: "rgb(var(--md-bg-3-rgb) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--md-accent-rgb) / <alpha-value>)",
          600: "rgb(var(--md-accent-600-rgb) / <alpha-value>)",
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
