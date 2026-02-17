/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dashboard: {
          900: "#040a15",
          800: "#0a1324",
          700: "#13203a",
        },
      },
      boxShadow: {
        panel: "0 18px 42px rgba(0, 0, 0, 0.35)",
      },
    },
  },
  plugins: [],
};
