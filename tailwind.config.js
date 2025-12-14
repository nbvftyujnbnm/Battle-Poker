/** @type {import('tailwindcss').Config} */
export default {
  // srcフォルダ以下の .js, .ts, .jsx, .tsx すべてを対象にする設定
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
