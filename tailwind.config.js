/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: 'hsl(var(--surface) / <alpha-value>)',
        raised: 'hsl(var(--raised) / <alpha-value>)',
        sunken: 'hsl(var(--sunken) / <alpha-value>)',
        ink: 'hsl(var(--ink) / <alpha-value>)',
        'ink-soft': 'hsl(var(--ink-soft) / <alpha-value>)',
        'ink-muted': 'hsl(var(--ink-muted) / <alpha-value>)',
        line: 'hsl(var(--line) / <alpha-value>)',
        'line-strong': 'hsl(var(--line-strong) / <alpha-value>)',
        brand: {
          50: '#eef8f3',
          100: '#d6efe3',
          200: '#aee0c9',
          300: '#7bc9a9',
          400: '#4aae89',
          500: '#2b9470',
          600: '#1d7a5b',
          700: '#186249',
          800: '#164e3c',
          900: '#123f31',
        },
        gold: {
          300: '#f2cd7d',
          400: '#e5b453',
          500: '#d29a34',
          600: '#b47c22',
        },
      },
      fontFamily: {
        sans: ['"Aptos"', '"Segoe UI Variable Text"', '"Segoe UI"', 'Inter', '"Noto Sans Devanagari"', 'system-ui', 'sans-serif'],
        display: ['"Bahnschrift"', '"Aptos Display"', '"Segoe UI Variable Display"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Cascadia Code"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.04), 0 10px 26px -22px rgba(15,23,42,0.22)',
        lift: '0 2px 4px rgba(15,23,42,0.04), 0 20px 40px -22px rgba(15,23,42,0.28)',
        pop: '0 28px 60px -24px rgba(15,23,42,0.4)',
      },
      borderRadius: {
        xl2: '16px',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        fadeUp: 'fadeUp 180ms ease-out both',
      },
    },
  },
  plugins: [],
};
