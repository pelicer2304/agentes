/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#050505',
        card: '#111111',
        border: '#242424',
        foreground: '#F5F7F6',
        muted: '#A7B0AA',
        accent: '#25D366',
        'accent-dark': '#0B1A12',
      },
      borderRadius: {
        sm: '8px',
        DEFAULT: '10px',
        md: '10px',
        lg: '12px',
        card: '10px',
      },
      fontSize: {
        body: ['14px', { lineHeight: '1.5' }],
        sm: ['14px', { lineHeight: '1.5' }],
        base: ['16px', { lineHeight: '1.5' }],
        lg: ['18px', { lineHeight: '1.6' }],
        xl: ['20px', { lineHeight: '1.4' }],
        '2xl': ['24px', { lineHeight: '1.3' }],
      },
      screens: {
        tablet: '768px',
        desktop: '1024px',
        wide: '1920px',
      },
      spacing: {
        18: '4.5rem',
        88: '22rem',
      },
    },
  },
  plugins: [],
};
