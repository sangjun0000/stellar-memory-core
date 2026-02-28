/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        space: {
          950: '#020408',
          900: '#050a14',
          800: '#0a1628',
          700: '#0f2040',
        },
      },
    },
  },
  plugins: [],
};
