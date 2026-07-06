/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'monospace'],
        pixel: ['"Press Start 2P"', 'monospace'],
        'pixel-body': ['VT323', 'monospace'],
        typewriter: ['"Special Elite"', '"Courier New"', 'monospace'],
        serif: ['"IBM Plex Serif"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
