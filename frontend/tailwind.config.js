/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: {
          50: '#f8fafc',
          100: '#1e2328',
          200: '#181c20',
          300: '#131722',
          400: '#0f1117',
          500: '#0a0d12',
        },
        accent: {
          green: '#26a69a',
          red: '#ef5350',
          blue: '#2196f3',
          yellow: '#f59e0b',
          purple: '#7c3aed',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      }
    }
  },
  plugins: []
}
