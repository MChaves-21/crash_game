/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        neon: {
          green:  '#00ff88',
          amber:  '#ffb800',
          red:    '#ff3366',
          blue:   '#00aaff',
        },
        bg: {
          void:  '#050508',
          dark:  '#0a0a0f',
          panel: '#0f0f18',
          card:  '#13131e',
          hover: '#1a1a28',
        },
        border: {
          DEFAULT: '#1e1e30',
          bright:  '#2a2a42',
        },
      },
      fontFamily: {
        display: ['Barlow Condensed', 'sans-serif'],
        mono:    ['Space Mono', 'monospace'],
        ui:      ['Inter', 'sans-serif'],
      },
      animation: {
        'pulse-amber': 'pulse-amber 2s ease infinite',
        'fade-in-up':  'fade-in-up 0.4s ease',
        'glow-pulse':  'glow-pulse 1.5s ease infinite',
      },
    },
  },
  plugins: [],
};
