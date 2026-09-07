/**
 * The two charts that carry the argument.
 *
 * Both are hand-drawn SVG rather than a charting library. That is a deliberate
 * trade: these are two very specific pictures, each with a reference line that
 * a generic library fights you to draw (zero for equity, the identity diagonal
 * for calibration), and a dependency-free build keeps the deployed bundle small
 * enough to load instantly on a reviewer's phone.
 *
 * Both use a viewBox with `preserveAspectRatio="none"` avoided — stretching a
 * calibration plot would distort the diagonal it is measured against, which is
 * the one line that has to stay at 45°.
 */

import { useId } from 'react';
import type { CalibrationBin, EquityPoint } from '../lib/data';
import { usd, pct } from '../lib/data';

// ---------------------------------------------------------------------------
// Equity curve
// ---------------------------------------------------------------------------

/**
 * Cumulative realized PnL, one step per settled call.
 *
 * The zero line is drawn emphatically and the area is filled green above it
 * and red below, because the single question a reader asks of this chart
 * is "is it above or below the line?" — and that should be answerable from
 * across a room, before any axis is read.
 */
export function EquityCurve({ points }: { points: EquityPoint[] }) {
  const gid = useId();
  const W = 800;
  const H = 260;
  const PAD = { top: 20, right: 16, bottom: 26, left: 48 };

  if (points.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-faint">
        No settled calls yet. Nothing to plot.
      </div>
    );
  }

  const values = points.map((p) => p.cumulativePnl);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  // Pad the range so the line never runs along the frame, and guard the
  // degenerate all-zero case where the span would be 0 and every y is NaN.
  const pad = (rawMax - rawMin) * 0.15 || 1;
  const min = rawMin - pad;
  const max = rawMax + pad;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min)) * innerH;

  const zeroY = y(0);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.cumulativePnl)}`).join(' ');
  // One closed path, drawn twice under two clip rects. Closing it back along the
  // zero line rather than the axis is what lets the same geometry serve both
  // fills: whichever side of zero is clipped away simply contributes nothing.
  const area = `${line} L ${x(points.length - 1)} ${zeroY} L ${x(0)} ${zeroY} Z`;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Cumulative realized profit and loss across ${points.length} settled calls, ending at ${usd(values[values.length - 1] ?? 0, true)}`}
      >
        <defs>
          {/* Split the area fill at the zero line: gain above, loss below. */}
          <clipPath id={`${gid}-above`}>
            <rect x={0} y={0} width={W} height={zeroY} />
          </clipPath>
          <clipPath id={`${gid}-below`}>
            <rect x={0} y={zeroY} width={W} height={H - zeroY} />
          </clipPath>
          <linearGradient id={`${gid}-up`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--c-gain))" stopOpacity="0.22" />
            <stop offset="100%" stopColor="rgb(var(--c-gain))" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${gid}-down`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="rgb(var(--c-loss))" stopOpacity="0.22" />
            <stop offset="100%" stopColor="rgb(var(--c-loss))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* y grid */}
        {[max, (max + min) / 2, min].map((v, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke="rgb(var(--c-line) / 0.20)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 10}
              y={y(v) + 4}
              textAnchor="end"
              className="fill-ghost font-mono"
              fontSize="11"
            >
              {usd(v, true)}
            </text>
          </g>
        ))}

        <path d={area} fill={`url(#${gid}-up)`} clipPath={`url(#${gid}-above)`} />
        <path d={area} fill={`url(#${gid}-down)`} clipPath={`url(#${gid}-below)`} />

        {/* Zero: the only line that matters. */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={zeroY}
          y2={zeroY}
          stroke="rgb(var(--c-faint))"
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        <path
          d={line}
          fill="none"
          stroke="rgb(var(--c-ink))"
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          className="draw-path"
        />

        {points.map((p, i) => (
          <circle
            key={p.index}
            cx={x(i)}
            cy={y(p.cumulativePnl)}
            r={3}
            fill={p.outcome === 'WON' ? 'rgb(var(--c-gain))' : 'rgb(var(--c-loss))'}
            stroke="rgb(var(--c-panel))"
            strokeWidth="1.5"
          >
            <title>{`#${p.index} ${p.outcome} · ${usd(p.cumulativePnl, true)} · ${p.question}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="mt-2 flex justify-between font-mono text-2xs text-ghost">
        <span>call 1</span>
        <span>call {points.length}</span>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

/**
 * Reliability diagram: stated confidence on x, observed frequency on y.
 *
 * A perfectly honest forecaster's points sit on the diagonal. Above it means
 * the agent was more right than it claimed (underclaiming); below means it
 * talked bigger than it delivered. Bubble area is proportional to the number of
 * calls in that bucket, so a lone outlier cannot be mistaken for a trend.
 *
 * This is the picture that a pure hit-rate number cannot give you, and it is
 * the reason the journal exists.
 */
export function CalibrationPlot({ bins }: { bins: CalibrationBin[] }) {
  const S = 320;
  const PAD = 40;
  const inner = S - PAD * 2;

  const x = (v: number) => PAD + v * inner;
  const y = (v: number) => PAD + inner - v * inner;
  const maxN = Math.max(1, ...bins.map((b) => b.n));

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${S} ${S}`}
        className="mx-auto w-full max-w-[320px]"
        role="img"
        aria-label="Reliability diagram: stated confidence against observed win frequency"
      >
        {/* frame */}
        <rect x={PAD} y={PAD} width={inner} height={inner} fill="none" stroke="rgb(var(--c-line) / 0.20)" />

        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={PAD} y2={PAD + inner} stroke="rgb(var(--c-line) / 0.10)" />
            <line x1={PAD} x2={PAD + inner} y1={y(t)} y2={y(t)} stroke="rgb(var(--c-line) / 0.10)" />
          </g>
        ))}

        {/* the honesty line */}
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(1)}
          y2={y(1)}
          stroke="rgb(var(--c-accent))"
          strokeWidth="1.25"
          strokeDasharray="4 4"
          opacity={0.7}
        />
        <text x={x(0.62)} y={y(0.55)} className="fill-money font-mono" fontSize="9">
          perfect honesty
        </text>

        {bins.map((b, i) => {
          const r = 4 + (b.n / maxN) * 9;
          const over = b.observedRate < b.meanConviction;
          return (
            <g key={i}>
              {/* Drop line to the diagonal makes the size of the miss legible. */}
              <line
                x1={x(b.meanConviction)}
                y1={y(b.observedRate)}
                x2={x(b.meanConviction)}
                y2={y(b.meanConviction)}
                stroke={over ? 'rgb(var(--c-loss))' : 'rgb(var(--c-gain))'}
                strokeWidth="1"
                opacity={0.45}
              />
              <circle
                cx={x(b.meanConviction)}
                cy={y(b.observedRate)}
                r={r}
                fill={over ? 'rgba(251,113,133,0.20)' : 'rgba(74,222,128,0.20)'}
                stroke={over ? 'rgb(var(--c-loss))' : 'rgb(var(--c-gain))'}
                strokeWidth="1.5"
              >
                <title>
                  {`Said ${pct(b.meanConviction, 0)}, delivered ${pct(b.observedRate, 0)} across ${b.n} call${b.n === 1 ? '' : 's'}`}
                </title>
              </circle>
            </g>
          );
        })}

        {/* axes */}
        <text
          x={PAD + inner / 2}
          y={S - 10}
          textAnchor="middle"
          className="fill-faint font-mono"
          fontSize="10"
        >
          said
        </text>
        <text
          x={12}
          y={PAD + inner / 2}
          textAnchor="middle"
          transform={`rotate(-90 12 ${PAD + inner / 2})`}
          className="fill-faint font-mono"
          fontSize="10"
        >
          actual
        </text>
        {[0, 1].map((t) => (
          <g key={t}>
            <text x={x(t)} y={S - 24} textAnchor="middle" className="fill-ghost font-mono" fontSize="9">
              {t * 100}%
            </text>
            <text x={PAD - 8} y={y(t) + 3} textAnchor="end" className="fill-ghost font-mono" fontSize="9">
              {t * 100}%
            </text>
          </g>
        ))}
      </svg>

      {bins.length === 0 ? (
        <p className="mt-3 text-center text-sm text-faint">
          No journalled convictions yet. Nothing to calibrate.
        </p>
      ) : (
        // Two rows rather than three inline items: the plot is capped at 320px
        // wide, and a single row wraps the last label into a ragged three-line
        // stack at every viewport.
        <figcaption className="mt-3 space-y-1.5 text-center font-mono text-2xs text-faint">
          <div className="flex items-center justify-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full border border-gain" /> underclaimed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full border border-loss" /> overclaimed
            </span>
          </div>
          <div className="text-ghost">bubble size = calls in bucket</div>
        </figcaption>
      )}
    </figure>
  );
}
