/**
 * Every token resolves to a CSS variable that each section redefines on itself,
 * so one set of class names renders correctly on the smoke-white sections and
 * on the black ones. The `<alpha-value>` placeholder keeps Tailwind's `/40`
 * opacity modifiers working through the indirection.
 */
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('--c-bg'),
        void: v('--c-bg'),
        panel: v('--c-panel'),
        raised: v('--c-raised'),
        line: v('--c-line'),
        'line-bright': v('--c-line'),
        ink: v('--c-ink'),
        cream: v('--c-ink'),
        muted: v('--c-muted'),
        faint: v('--c-faint'),
        ghost: v('--c-ghost'),
        accent: v('--c-accent'),
        money: v('--c-accent'),
        live: v('--c-live'),
        teal: v('--c-teal'),
        gain: v('--c-gain'),
        loss: v('--c-loss'),
      },
      fontFamily: {
        // Sofer's stack: Geist for everything, Geist Mono for the machine voice,
        // Instrument Serif italic for the one accented word in a headline.
        sans: ['Geist', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Geist', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '1.5' }],
      },
      borderRadius: {
        panel: '18px',
        card: '12px',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        'line-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        rise: 'rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        'line-in': 'line-in 0.32s ease-out both',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
