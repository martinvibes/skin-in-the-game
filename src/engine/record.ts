/**
 * The record: reputation computed from settled money.
 *
 * Every function here is pure and total. Given the same `SettledCall[]` it
 * returns the same `Record`, and it never reads the network, the clock, or the
 * agent's own prose. That is deliberate — the entire claim of this project is
 * that the agent cannot author its own track record, and the cheapest way to
 * make that claim inspectable is to keep the computation in one small file with
 * no I/O in it.
 *
 * ## What hit rate cannot tell you
 *
 * A forecaster who only ever bets on 95%-likely outcomes will show a superb hit
 * rate and make no money. One who finds genuine 40% shots priced at 20% will
 * look wrong most of the time and get rich. Hit rate alone rewards cowardice,
 * so the record carries two further measures:
 *
 * - **Realized PnL / ROI** — did the calls actually pay?
 * - **Brier score** — were the stated probabilities *honest*?
 *
 * ## Brier score
 *
 *     BS = (1/N) · Σ (conviction_i - actual_i)²        actual ∈ {0, 1}
 *
 * It is the mean squared error of probabilistic forecasts, so lower is better
 * and the scale is fixed and interpretable:
 *
 *   | Score | Meaning                                                     |
 *   |-------|-------------------------------------------------------------|
 *   | 0.00  | perfect: said 100% and was right, every time                 |
 *   | 0.25  | the score of always saying "50%" — i.e. no information       |
 *   | 0.33+ | worse than a coin flip: confidently, repeatedly wrong        |
 *
 * The property that matters here is that Brier is a *strictly proper* scoring
 * rule: it is minimised only by reporting your true belief. An agent cannot
 * game it by inflating confidence to look decisive — overclaiming is punished
 * quadratically. Combined with the money, that closes both escape routes: it
 * cannot be vague to stay safe, and it cannot be loud to look good.
 */

import type {
  CalibrationBin,
  EquityPoint,
  Record as TrackRecord,
  SettledCall,
} from '../domain/types.js';

/** Default calibration buckets: deciles from 0 to 1. */
const DEFAULT_BINS = 10;

/** Compute the full record from settled calls, oldest first. */
export function buildRecord(settled: SettledCall[]): TrackRecord {
  const ordered = [...settled].sort(
    (a, b) => Date.parse(a.settledAt || '') - Date.parse(b.settledAt || ''),
  );

  const wins = ordered.filter((s) => s.outcome === 'WON').length;
  const losses = ordered.length - wins;
  const realizedPnl = sum(ordered.map((s) => s.pnl));
  const totalStaked = sum(ordered.map((s) => s.cost));

  return {
    calls: ordered.length,
    wins,
    losses,
    hitRate: ordered.length > 0 ? wins / ordered.length : null,
    realizedPnl: round2(realizedPnl),
    totalStaked: round2(totalStaked),
    roi: totalStaked > 0 ? realizedPnl / totalStaked : null,
    brier: brierScore(ordered),
    scoredCalls: ordered.filter((s) => s.conviction !== null).length,
    calibration: calibrate(ordered),
    equityCurve: equityCurve(ordered),
  };
}

/**
 * Mean squared error of the stated convictions.
 *
 * Only calls that carry a journalled conviction are scored. Returns null rather
 * than 0 when nothing is scorable — a missing score and a perfect score must
 * never render the same way.
 */
export function brierScore(settled: SettledCall[]): number | null {
  const scored = settled.filter(
    (s): s is SettledCall & { conviction: number } => s.conviction !== null,
  );
  if (scored.length === 0) return null;
  const total = sum(
    scored.map((s) => {
      const actual = s.outcome === 'WON' ? 1 : 0;
      return (s.conviction - actual) ** 2;
    }),
  );
  return total / scored.length;
}

/**
 * Reliability curve: for each confidence bucket, stated vs. observed.
 *
 * A well-calibrated forecaster's points sit on the diagonal — of the calls it
 * made at ~70%, about 70% came in. Empty buckets are dropped rather than
 * plotted at zero, because "never made a call at this confidence" and "made
 * calls at this confidence and got them all wrong" are opposite facts.
 */
export function calibrate(settled: SettledCall[], bins = DEFAULT_BINS): CalibrationBin[] {
  const scored = settled.filter(
    (s): s is SettledCall & { conviction: number } => s.conviction !== null,
  );
  const out: CalibrationBin[] = [];

  for (let i = 0; i < bins; i++) {
    const lower = i / bins;
    const upper = (i + 1) / bins;
    // Top bucket is closed so that a conviction of exactly 1.0 lands somewhere.
    const inBin = scored.filter((s) =>
      i === bins - 1
        ? s.conviction >= lower && s.conviction <= upper
        : s.conviction >= lower && s.conviction < upper,
    );
    if (inBin.length === 0) continue;
    out.push({
      lower,
      upper,
      n: inBin.length,
      meanConviction: sum(inBin.map((s) => s.conviction)) / inBin.length,
      observedRate: inBin.filter((s) => s.outcome === 'WON').length / inBin.length,
    });
  }
  return out;
}

/** Cumulative realized PnL after each settled call, oldest first. */
export function equityCurve(settled: SettledCall[]): EquityPoint[] {
  let cum = 0;
  return settled.map((s, i) => {
    cum += s.pnl;
    return {
      index: i + 1,
      cumulativePnl: round2(cum),
      outcome: s.outcome,
      question: s.question,
    };
  });
}

/**
 * Plain-English verdict on a Brier score.
 *
 * Used by the CLI and the UI so the number is never shown bare to someone who
 * has not met it before. Returns null when there is nothing to judge.
 */
export function brierVerdict(brier: number | null, n: number): string | null {
  if (brier === null || n === 0) return null;
  if (n < 5) return `too few settled calls (${n}) to judge calibration yet`;
  if (brier < 0.15) return 'well calibrated — stated confidence tracks reality closely';
  if (brier < 0.25) return 'better than uninformed, but not sharp';
  if (brier < 0.3) return 'roughly as useful as always saying 50%';
  return 'worse than a coin flip — confidently wrong';
}

/**
 * Join convictions from the local journal onto settled rows from Binance.
 *
 * Binance knows what the position did; only we know what the agent claimed
 * beforehand. Rows with no journal entry keep `conviction: null` and are
 * excluded from Brier and calibration — silently substituting a default would
 * fabricate the exact evidence this project exists to make unfakeable.
 */
export function joinConvictions<T extends { tokenId: string; conviction: number | null }>(
  rows: T[],
  journal: Map<string, number>,
): T[] {
  return rows.map((r) =>
    r.conviction === null && journal.has(r.tokenId)
      ? { ...r, conviction: journal.get(r.tokenId)! }
      : r,
  );
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
