/**
 * The mark.
 *
 * A square divided where the market has priced it: solid on the left, empty on
 * the right. A prediction-market token at 62¢ *is* a 62% probability, so the
 * division is not a decoration of the idea, it is the idea. Two shapes and no
 * detail, which is why it still reads at 16px.
 *
 * The divider is a parameter rather than a constant, so the same geometry is
 * both the logo and the loader: the split slides out to the price while the
 * money counts up.
 */

import { useId } from 'react';

/** Binance yellow. The mark does not change colour with the section. */
export const MARK_COLOR = '#F0B90B';

/** Where the mark sits at rest. The demo agent's own conviction, rounded. */
const REST_SPLIT = 0.62;

const X = 4;
const W = 24;

export function Mark({
  size = 32,
  split = REST_SPLIT,
  className = '',
}: {
  size?: number;
  /** Where the square is divided, 0–1 from the left edge. */
  split?: number;
  className?: string;
}) {
  // One clip per instance: the nav, the footer and the loader can all be on
  // screen at once, and a shared id would let whichever mounted last win.
  const clip = useId();
  const s = Math.max(0, Math.min(1, split));

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={className}
    >
      <defs>
        <clipPath id={clip}>
          <rect x="0" y="0" width={X + W * s} height="32" />
        </clipPath>
      </defs>
      <rect
        x={X}
        y={X}
        width={W}
        height={W}
        rx="7"
        fill={MARK_COLOR}
        clipPath={`url(#${clip})`}
      />
      <rect x={X} y={X} width={W} height={W} rx="7" stroke={MARK_COLOR} strokeWidth={2.3} />
    </svg>
  );
}

/**
 * The wordmark.
 *
 * Geist at 600 with the tracking pulled in hard. It stays ink rather than
 * yellow: the mark is the brand colour, and a whole lockup in one accent reads
 * as a sticker instead of a logotype.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-display text-[19px] font-semibold leading-none tracking-[-0.045em] ${className}`}
    >
      Skin
    </span>
  );
}

export function Logo({
  size = 30,
  onClick,
  className = '',
}: {
  size?: number;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-2.5 text-ink ${className}`}
      aria-label="Skin home"
    >
      {/* Half a turn on hover puts the fill on the other side: the same square,
          the opposite call. */}
      <span className="relative block" style={{ width: size, height: size }}>
        <Mark
          size={size}
          className="absolute inset-0 transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:rotate-180"
        />
      </span>
      <Wordmark />
    </button>
  );
}
