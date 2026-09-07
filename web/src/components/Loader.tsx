/**
 * The opening.
 *
 * The mark's wedge is a position filling: it sweeps from nothing to a third of
 * the ring while a counter runs up to the money actually at risk, then the
 * whole thing lifts away. It is the product's one sentence — a claim is not
 * worth anything until something has been staked against it — played once,
 * before you read a word of the page.
 *
 * It holds for a minimum beat even when `record.json` arrives instantly, since
 * a loader that flashes is worse than no loader; and it is skipped outright
 * under reduced motion, where an animated splash is an obstacle rather than an
 * introduction.
 */
import { useEffect, useRef, useState } from 'react';
import { Mark } from './Logo';

const SWEEP_MS = 1150;
const HOLD_MS = 240;
const FADE_MS = 620;

export function Loader({ target, onDone }: { target: number; onDone: () => void }) {
  const [turn, setTurn] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const started = useRef(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDone();
      return;
    }

    let frame = 0;
    started.current = performance.now();

    const tick = (now: number) => {
      const p = Math.min(1, (now - started.current) / SWEEP_MS);
      // Same easing as the reveals, so the splash and the page share a hand.
      const eased = 1 - Math.pow(1 - p, 3);
      setTurn(eased * 0.3);
      if (p < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      window.setTimeout(() => setLeaving(true), HOLD_MS);
      window.setTimeout(onDone, HOLD_MS + FADE_MS);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = target * (turn / 0.3);

  return (
    <div
      className="sect-light fixed inset-0 z-[100] grid place-items-center"
      style={{
        background: 'rgb(var(--c-bg))',
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'scale(1.04)' : 'none',
        transition: `opacity ${FADE_MS}ms cubic-bezier(0.4,0,0.2,1), transform ${FADE_MS}ms cubic-bezier(0.4,0,0.2,1)`,
      }}
    >
      <div className="flex flex-col items-center">
        <Mark size={56} turn={turn} className="text-ink" />
        <p
          data-numeric
          className="mt-7 font-mono text-[22px] tracking-tight text-ink"
          style={{ opacity: 0.25 + (turn / 0.3) * 0.75 }}
        >
          ${shown.toFixed(2)}
        </p>
        <p className="mt-2.5 font-mono text-2xs uppercase tracking-[0.2em] text-faint">
          at risk
        </p>
      </div>
    </div>
  );
}
