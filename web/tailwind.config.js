/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /* ── Colors ── */
      colors: {
        space: {
          950: '#020408',
          900: '#050a14',
          850: '#07101e',
          800: '#0a1628',
          750: '#0c1b32',
          700: '#0f2040',
          600: '#152b54',
        },
      },

      /* ── Font family ── */
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },

      /* ── Custom animations ── */
      animation: {
        'glow':        'pulse-glow 2.4s ease-in-out infinite',
        'shimmer':     'shimmer 1.8s ease-in-out infinite',
        'float':       'float 4s ease-in-out infinite',
        'pulse-soft':  'pulse-soft 3s ease-in-out infinite',
        'scan-line':   'scan-line 8s linear infinite',
      },

      /* ── Keyframes (mirrors globals.css for JIT usage) ── */
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.55' },
        },
        shimmer: {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.7' },
          '50%':      { opacity: '1' },
        },
        'scan-line': {
          '0%':   { transform: 'translateY(-100%)', opacity: '0' },
          '10%':  { opacity: '0.06' },
          '90%':  { opacity: '0.06' },
          '100%': { transform: 'translateY(100vh)', opacity: '0' },
        },
      },

      /* ── Box shadows — glow variants ── */
      boxShadow: {
        'glow-sm':     '0 0 8px rgba(59, 130, 246, 0.35)',
        'glow-md':     '0 0 16px rgba(59, 130, 246, 0.4), 0 0 4px rgba(59, 130, 246, 0.2)',
        'glow-lg':     '0 0 32px rgba(59, 130, 246, 0.45), 0 0 8px rgba(59, 130, 246, 0.25)',
        'glow-blue':   '0 0 20px rgba(59, 130, 246, 0.5), 0 0 40px rgba(59, 130, 246, 0.2)',
        'glow-yellow': '0 0 20px rgba(245, 158, 11, 0.5), 0 0 40px rgba(245, 158, 11, 0.2)',
        'glow-purple': '0 0 20px rgba(139, 92, 246, 0.5), 0 0 40px rgba(139, 92, 246, 0.2)',
        'glow-green':  '0 0 20px rgba(34, 197, 94, 0.45), 0 0 40px rgba(34, 197, 94, 0.2)',
        'inner-glow':  'inset 0 0 16px rgba(59, 130, 246, 0.08)',
      },

      /* ── Backdrop blur (ensures lg/xl available) ── */
      backdropBlur: {
        xs: '2px',
      },

      /* ── Border radius extras ── */
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
};
