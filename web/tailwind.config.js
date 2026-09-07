/**
 * Design tokens for "Ledger Noir".
 *
 * The visual argument of this product is *bookkeeping*: a claim, a price, money
 * committed, and a result that cannot be edited afterwards. So the surface is
 * built from betting slips and ruled ledger paper rather than the usual
 * glass-and-neon trading dashboard.
 *
 * Palette rules, enforced by only defining these colours:
 *   ink      — bone, never pure white. Pure white on near-black vibrates and
 *              reads as a terminal; bone reads as paper and is easier to hold.
 *   ground   — warm near-black (a red-shifted 8/9/11), not blue-black. Warmth is
 *              what keeps a dark UI from looking like every other crypto site.
 *   amber    — reserved exclusively for money *at risk*. Never decoration.
 *   jade     — money gained. vermilion — money lost. Never used for anything else.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: {
          DEFAULT: '#0B0A09',
          raised: '#131110',
          sunken: '#070605',
        },
        ink: {
          DEFAULT: '#EFE8DA',
          muted: '#A29A8C',
          faint: '#6B655C',
          ghost: '#3A3631',
        },
        amber: {
          DEFAULT: '#F5B23D',
          dim: '#8A6524',
        },
        jade: '#5FD693',
        vermilion: '#E5594F',
        rule: '#241F1B',
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      letterSpacing: {
        wider: '0.08em',
        widest: '0.18em',
      },
      maxWidth: {
        page: '68rem',
      },
      keyframes: {
        'stamp-in': {
          '0%': { opacity: '0', transform: 'rotate(-14deg) scale(1.6)' },
          '60%': { opacity: '1', transform: 'rotate(-7deg) scale(0.96)' },
          '100%': { opacity: '1', transform: 'rotate(-7deg) scale(1)' },
        },
        'draw': {
          from: { strokeDashoffset: '1' },
          to: { strokeDashoffset: '0' },
        },
        'rise': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'stamp-in': 'stamp-in 420ms cubic-bezier(0.2, 1.2, 0.4, 1) both',
        rise: 'rise 520ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};
