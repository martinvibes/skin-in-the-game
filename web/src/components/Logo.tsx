/**
 * The mark.
 *
 * A ring with one solid wedge inside it: the market, and the part of it you
 * actually own. That is the whole product in one glyph — an opinion is the
 * empty ring, a position is the wedge, and the name is what you have to put in
 * to draw one. It survives at 16px because it is two shapes and no detail, and
 * the wedge doubles as a progress dial, which is what the loader spins.
 */

const R = 13;
const CX = 16;
const CY = 16;

/** Wedge path from 12 o'clock, clockwise, covering `turn` of the circle. */
function wedge(turn: number): string {
  const t = Math.max(0, Math.min(1, turn));
  if (t <= 0) return '';
  if (t >= 1) {
    // A full sweep cannot be drawn as one arc; two halves close it cleanly.
    return `M ${CX} ${CY} m 0 ${-R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} Z`;
  }
  const a = t * Math.PI * 2 - Math.PI / 2;
  const x = CX + R * Math.cos(a);
  const y = CY + R * Math.sin(a);
  return `M ${CX} ${CY} L ${CX} ${CY - R} A ${R} ${R} 0 ${t > 0.5 ? 1 : 0} 1 ${x} ${y} Z`;
}

export function Mark({
  size = 32,
  turn = 0.3,
  className = '',
}: {
  size?: number;
  /** How much of the ring is filled, 0–1. */
  turn?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={className}
    >
      <circle cx={CX} cy={CY} r={R} stroke="currentColor" strokeWidth={2.5} opacity={0.28} />
      <path d={wedge(turn)} fill="currentColor" />
    </svg>
  );
}

/**
 * The wordmark.
 *
 * Geist at 600 with the tracking pulled in hard, and the `i` dot replaced by
 * the same wedge geometry as the mark, so the logotype carries the idea even
 * when the mark is not next to it.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`relative font-display text-[19px] font-semibold leading-none tracking-[-0.045em] ${className}`}
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
      <span className="relative block" style={{ width: size, height: size }}>
        <Mark
          size={size}
          turn={0.3}
          className="absolute inset-0 transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:rotate-[216deg]"
        />
      </span>
      <Wordmark />
    </button>
  );
}
