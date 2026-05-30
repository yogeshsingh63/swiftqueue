/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'Courier New', 'monospace'],
      },
      colors: {
        darkBg: '#0b0f19',
        cardBg: 'rgba(17, 24, 39, 0.7)',
        neonBlue: '#38bdf8',
        neonPurple: '#a855f7',
        neonGreen: '#34d399',
        neonRed: '#f87171',
      },
      boxShadow: {
        neonBlue: '0 0 15px rgba(56, 189, 248, 0.4)',
        neonPurple: '0 0 15px rgba(168, 85, 247, 0.4)',
        neonGreen: '0 0 15px rgba(52, 211, 153, 0.4)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
    },
  },
  plugins: [],
}
