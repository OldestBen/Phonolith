import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        stone: {
          bg: '#0c0c0e',
          surface: '#18181b',
          border: '#27272a',
          accent: '#7c3aed',
        },
      },
      backgroundColor: {
        app: '#0c0c0e',
        surface: '#18181b',
      },
      borderColor: {
        DEFAULT: '#27272a',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
