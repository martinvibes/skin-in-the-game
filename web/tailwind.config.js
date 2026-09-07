/**
 * Design tokens for Skin.
 *
 * Cool near-black rather than warm: the reference language this follows
 * (NoirPerp, BlindPay, Sofer) is neutral-dark with a cream primary and one
 * saturated accent, and warm blacks read as "document" where these read as
 * "instrument". Corners are large and buttons are pills throughout.
 *
 * The colour rules are semantic and never decorative:
 *   cream  — the primary voice, and the primary button
 *   teal   — interactive: something you can press or that is happening now
 *   money  — money at risk, and nothing else
 *   gain   — realized profit and a call that came in
 *   loss   — realized loss and a call that did not
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#08090A',
        panel: '#0E1012',
        raised: '#14171A',
        line: '#1D2125',
        'line-bright': '#2A3037',
        cream: '#F4F1EA',
        muted: '#98A0A8',
        faint: '#626A71',
        ghost: '#3E464D',
        teal: '#5EE9D5',
        'teal-dim': '#2A9D8F',
        gain: '#4ADE80',
        loss: '#FB7185',
        money: '#FBBF24',
        'money-dim': '#8A6520',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        panel: '20px',
        card: '14px',
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 24px 60px -24px rgba(0,0,0,0.9)',
        lift: '0 20px 50px -20px rgba(0,0,0,0.85)',
      },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'line-in': { from: { opacity: '0', transform: 'translateX(-6px)' }, to: { opacity: '1', transform: 'none' } },
        draw: { from: { strokeDashoffset: '1' }, to: { strokeDashoffset: '0' } },
        'pulse-soft': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
      },
      animation: {
        rise: 'rise 0.5s cubic-bezier(0.16,1,0.3,1) both',
        'line-in': 'line-in 0.28s cubic-bezier(0.16,1,0.3,1) both',
        'pulse-soft': 'pulse-soft 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
