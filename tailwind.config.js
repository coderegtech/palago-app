/**
 * PalaGo Tailwind / NativeWind configuration.
 *
 * The palette here is the single visual source of truth and is mirrored in
 * `src/constants/theme.ts` for the places that need raw values (native
 * StatusBar, react-navigation themes, SVG props, map styling).
 * If you change a colour, change it in both files.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#087443',
          dark: '#055C35',
          light: '#0F9459',
          soft: '#E6F2EC',
          deep: '#08512B',
        },
        secondary: {
          DEFAULT: '#F5B800',
          dark: '#C99600',
          soft: '#FFF6DB',
        },
        // Tropical accents from the brand illustration.
        aqua: { DEFAULT: '#1FBEB4', soft: '#E2F7F5' },
        sun: '#FFC820',
        background: { DEFAULT: '#F7FAF7', tint: '#EAF4EE' },
        surface: '#FFFFFF',
        content: {
          DEFAULT: '#12352A',
          muted: '#6B7F76',
          inverse: '#FFFFFF',
        },
        border: {
          DEFAULT: '#E2EAE5',
          strong: '#C9D6CF',
        },
        success: { DEFAULT: '#16A34A', soft: '#E7F6ED' },
        warning: { DEFAULT: '#F59E0B', soft: '#FEF3E2' },
        danger: { DEFAULT: '#DC2626', soft: '#FDECEC' },
        info: { DEFAULT: '#0284C7', soft: '#E4F2FB' },
      },
      borderRadius: {
        card: 16,
        sheet: 24,
      },
      fontSize: {
        // Minimums chosen for legibility on small Android devices.
        caption: ['12px', { lineHeight: '16px' }],
        body: ['15px', { lineHeight: '22px' }],
        title: ['20px', { lineHeight: '28px' }],
        display: ['28px', { lineHeight: '34px' }],
      },
    },
  },
  plugins: [],
};
