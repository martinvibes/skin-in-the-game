/**
 * The shape of the payload produced by `skin export`, plus formatting helpers.
 *
 * These types are a hand-maintained mirror of `src/domain/types.ts` rather than
 * an import: the dashboard is a separate build that must be publishable as a
 * static bundle, and coupling it to the CLI's module graph would drag Node
 * types into a browser build for no benefit. The mirror is small and the export
 * payload is versioned by `generatedAt`, so drift shows up immediately as a
 * missing field rather than silently.
 */

export type Outcome = 'WON' | 'LOST';
export type Side = 'YES' | 'NO';
export type Mode = 'live' | 'demo';

export interface SettledCall {
  tokenId: string;
  question: string;
  side: Side;
  outcome: Outcome;
  cost: number;
  payout: number;
  pnl: number;
  conviction: number | null;
  settledAt: string;
  claimed: boolean;
}

export interface OpenPosition {
  tokenId: string;
  question: string;
  side: Side;
  shares: number;
  cost: number;
  avgPrice: number;
  conviction: number | null;
  endDate?: string;
}

export interface UnclaimedWin {
  tokenId: string;
  question: string;
  payout: number;
  settledAt?: string;
}

export interface CalibrationBin {
  lower: number;
  upper: number;
  n: number;
  meanConviction: number;
  observedRate: number;
}

export interface EquityPoint {
  index: number;
  cumulativePnl: number;
  outcome: Outcome;
  question: string;
}

export interface TrackRecord {
  calls: number;
  wins: number;
  losses: number;
  hitRate: number | null;
  realizedPnl: number;
  totalStaked: number;
  roi: number | null;
  brier: number | null;
  scoredCalls: number;
  calibration: CalibrationBin[];
  equityCurve: EquityPoint[];
}

export interface JournalEntry {
  tokenId: string;
  conviction: number;
  marketPrice: number;
  stake: number;
  question: string;
  thesis: string;
  analyst: string;
  at: string;
}

export interface Payload {
  generatedAt: string;
  mode: Mode;
  record: TrackRecord;
  settled: SettledCall[];
  open: OpenPosition[];
  unclaimed: UnclaimedWin[];
  journal: JournalEntry[];
  wallet: { usdt: number | null; dailyRemaining: number | null; dailyLimit: number | null };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Money. `signed` renders an explicit + or a true minus sign (U+2212). */
export function usd(n: number, signed = false): string {
  const body = `$${Math.abs(n).toFixed(2)}`;
  if (!signed) return body;
  return n < 0 ? `−${body}` : `+${body}`;
}

/** Percentage, or an em dash when the value genuinely is not known. */
export function pct(n: number | null, dp = 1): string {
  return n === null ? '—' : `${(n * 100).toFixed(dp)}%`;
}

/** Tailwind text colour for a signed number, by the palette's one rule. */
export function moneyTone(n: number): string {
  return n > 0 ? 'text-jade' : n < 0 ? 'text-vermilion' : 'text-ink-faint';
}

/** Plain-English reading of a Brier score. Mirrors `engine/record.ts`. */
export function brierVerdict(brier: number | null, n: number): string {
  if (brier === null || n === 0) return 'no scored calls yet';
  if (n < 5) return `only ${n} scored call${n === 1 ? '' : 's'} — too few to judge`;
  if (brier < 0.15) return 'well calibrated';
  if (brier < 0.25) return 'better than uninformed';
  if (brier < 0.3) return 'about as useful as always saying 50%';
  return 'worse than a coin flip';
}

/** Relative time until a market resolves. */
export function until(endDate?: string): string {
  if (!endDate) return '—';
  const ms = Date.parse(endDate) - Date.now();
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return 'due';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = min / 60;
  return h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(0)}d`;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
