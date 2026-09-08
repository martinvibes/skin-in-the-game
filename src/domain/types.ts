/**
 * Domain model for Skin in the Game.
 *
 * The vocabulary here is deliberately narrow. An agent makes a `Call` (a
 * probabilistic claim about a market outcome). A `Call` that clears the edge
 * and budget gates becomes a `Stake` (real money on a real outcome token).
 * When the market resolves, the stake becomes a `SettledCall` — and settled
 * calls are the only thing the `Record` is computed from.
 *
 * The asymmetry is the whole point: opinions are free to produce, but only
 * settled money counts toward the agent's reputation.
 */

/** Which execution rail a piece of data came from. Surfaced in the UI so a
 *  reader can always tell what is Binance's word and what is ours. */
export type Rail = 'baw' | 'mcp' | 'local';

/** How the process is running. `live` touches real money; `demo` reads
 *  fixtures. Never rendered implicitly — always shown to the user. */
export type Mode = 'live' | 'demo';

/** The side of a binary prediction market the agent is taking. */
export type Side = 'YES' | 'NO';

/** Outcome of a resolved market, from the agent's point of view. */
export type Outcome = 'WON' | 'LOST';

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

/**
 * A prediction market as returned by `baw prediction market list|search`.
 *
 * Field names mirror the CLI's JSON rather than being prettified, so that the
 * mapping in `adapters/baw.ts` stays auditable against Binance's docs. Every
 * field is optional-by-parse: the adapter normalises, it does not assume.
 */
export interface Market {
  /** Topic id — the handle used for `market detail` and `trade quote`. */
  marketTopicId: string;
  /** Market id — the handle used for `order-book` and `last-trade-price`. */
  marketId: string;
  /** Human-readable question, e.g. "Will BTC close above $110,000 on Sep 8?" */
  title: string;
  /** L1 category: `crypto`, `sports`, ... */
  category: string;
  /** ISO-8601 resolution time, when the CLI provides one. */
  endDate?: string;
  /** The tradable outcome tokens for this market. */
  outcomes: OutcomeToken[];

  /**
   * Binance's own family for the market, e.g. `CRYPTO_UP_DOWN` or `DEFAULT`.
   * Worth carrying because it says which questions we can price without
   * having to infer it back out of the title.
   */
  variant?: string;
  /**
   * The spot symbol the market resolves against, when Binance names one
   * (`BTCUSDT`). Authoritative, unlike guessing the asset from the title.
   */
  symbol?: string;
  /**
   * The price the outcome is measured against. For an up/down market this is
   * the start price Chainlink or Binance recorded when the window opened, and
   * it is the strike the model needs — not spot at the time of the scan.
   */
  referencePrice?: number;
}

/** One ERC-1155 outcome token within a market. */
export interface OutcomeToken {
  tokenId: string;
  /** Label as Binance returns it, e.g. "Yes" / "No" / "Up" / "Down". */
  label: string;
  /**
   * Last traded price in USDT, range (0, 1). On a binary market that resolves
   * to $1, this doubles as the market's implied probability — which is exactly
   * what the agent measures its own conviction against.
   *
   * Nullable on purpose: `last-trade-price` is a historical fill and can be
   * absent on a market with no trades yet. A market with no price has no
   * measurable edge, so the engine skips it rather than guessing.
   */
  price: number | null;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * A probabilistic claim, before any money is committed.
 *
 * `conviction` is the agent's own probability that the chosen side resolves
 * true. It is NOT a confidence-in-the-analysis score and it is NOT a 1-5 star
 * rating: it is a number that will later be scored against reality by
 * `engine/record.ts`. Saying 0.9 and being wrong is expensive twice — once in
 * money, once in Brier score.
 */
export interface Call {
  marketTopicId: string;
  marketId: string;
  /** Question text, carried for display and for the receipt. */
  question: string;
  /** Which outcome token the agent is claiming will resolve true. */
  tokenId: string;
  side: Side;
  /** Agent's probability that this side wins. Range (0, 1). */
  conviction: number;
  /** Market-implied probability at the time of the call — the token's price. */
  marketPrice: number;
  /** One-line justification. Shown on the receipt; never used for arithmetic. */
  thesis: string;
  /** The thesis without its price clause, so execution can restate it at the price paid. */
  thesisHead: string;
  /** When the agent formed this view. */
  createdAt: string;
}

/**
 * The result of running a `Call` through the edge and budget gates.
 *
 * A rejected verdict is a first-class, expected outcome — an analyst that
 * declines to bet when it has no edge is behaving correctly, and the CLI
 * renders that just as prominently as a placed bet.
 */
export type StakeVerdict =
  | { kind: 'staked'; call: Call; sizing: Sizing }
  | { kind: 'declined'; call: Call; reason: DeclineReason; detail: string };

export type DeclineReason =
  | 'no-edge'          // agent agrees with the market; nothing to prove
  | 'below-minimum'    // Kelly size rounds below the venue minimum
  | 'budget-exhausted' // per-run or wallet daily limit reached
  | 'no-price'         // market has no last-trade price to measure against
  | 'conviction-bounds' // conviction outside the engine's admissible range
  | 'stale-price';     // the listed price was a stale print; the real quote kills the edge

/** Stake sizing output — every intermediate is kept so the UI can show its work. */
export interface Sizing {
  /** Agent probability. */
  p: number;
  /** Market-implied probability (the price paid per $1 of payout). */
  price: number;
  /** Signed edge, `p - price`. Positive means the agent is more bullish. */
  edge: number;
  /** Net decimal odds implied by the price: (1 - price) / price. */
  odds: number;
  /** Full-Kelly fraction of bankroll. Can exceed the cap; that is why we scale. */
  kellyFull: number;
  /** The fraction actually used, after the Kelly multiplier and caps. */
  kellyApplied: number;
  /** Final stake in USDT, rounded to the venue's precision. */
  stakeUsdt: number;
  /**
   * Which of the four ceilings actually bound. The wallet's daily limit is
   * kept distinct from the run budget because they mean different things to
   * the operator: one is a flag they passed, the other is a limit they set in
   * the Binance app and that the agent has no way to raise.
   */
  bindingConstraint: 'kelly' | 'per-call-cap' | 'budget-remaining' | 'wallet-daily-limit';
}

// ---------------------------------------------------------------------------
// Positions and settlement
// ---------------------------------------------------------------------------

/** An open position: money is committed, the market has not resolved. */
export interface OpenPosition {
  tokenId: string;
  marketTopicId: string;
  question: string;
  side: Side;
  /** Shares held (outcome tokens). Each pays $1 if it resolves true. */
  shares: number;
  /** USDT actually spent, including fees. */
  cost: number;
  /** Average fill price per share. */
  avgPrice: number;
  /** The conviction that justified this stake, recovered from the journal. */
  conviction: number | null;
  endDate?: string;
}

/** A resolved position. This is the unit the record is built from. */
export interface SettledCall {
  tokenId: string;
  question: string;
  side: Side;
  outcome: Outcome;
  /** USDT spent. */
  cost: number;
  /** USDT returned on redemption. Zero for a loss. */
  payout: number;
  /** payout - cost. */
  pnl: number;
  /** The conviction stated before the outcome was known. Null if unjournalled. */
  conviction: number | null;
  settledAt: string;
  /** Whether the winnings have actually been redeemed on-chain yet. */
  claimed: boolean;
}

/** A winning position whose payout is still sitting unclaimed on-chain. */
export interface UnclaimedWin {
  tokenId: string;
  question: string;
  /** Redeemable value in USDT. */
  payout: number;
  settledAt?: string;
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/**
 * The agent's reputation, derived entirely from settled money.
 *
 * Nothing in here can be authored by the agent. Every field is a pure function
 * of `SettledCall[]`, which in turn comes from Binance's settled history. That
 * is the property the whole project exists to demonstrate.
 */
export interface Record {
  calls: number;
  wins: number;
  losses: number;
  /** wins / calls. Null when there are no settled calls yet. */
  hitRate: number | null;
  /** Sum of `pnl` across settled calls, in USDT. */
  realizedPnl: number;
  /** Total USDT staked across settled calls. */
  totalStaked: number;
  /** realizedPnl / totalStaked. Null when nothing has settled. */
  roi: number | null;
  /**
   * Brier score over calls that carry a conviction: mean of (conviction - actual)^2
   * where actual is 1 for a win and 0 for a loss. Range [0, 1], lower is better.
   * 0.25 is the score of a coin-flipper who always says 50%.
   */
  brier: number | null;
  /** How many settled calls had a journalled conviction to score. */
  scoredCalls: number;
  /** Reliability curve: stated confidence vs. observed frequency. */
  calibration: CalibrationBin[];
  /** Cumulative PnL after each settled call, oldest first. Drives the chart. */
  equityCurve: EquityPoint[];
}

export interface CalibrationBin {
  /** Inclusive lower bound of the confidence bucket, e.g. 0.6. */
  lower: number;
  /** Exclusive upper bound, e.g. 0.7. */
  upper: number;
  /** Number of settled calls that fell in this bucket. */
  n: number;
  /** Mean stated conviction within the bucket. */
  meanConviction: number;
  /** Observed win frequency within the bucket. */
  observedRate: number;
}

export interface EquityPoint {
  /** 1-indexed call number. */
  index: number;
  /** Cumulative realized PnL in USDT after this call. */
  cumulativePnl: number;
  outcome: Outcome;
  question: string;
}

// ---------------------------------------------------------------------------
// Budget policy
// ---------------------------------------------------------------------------

/**
 * The spending envelope for a run.
 *
 * `walletDailyRemaining` is read from `baw wallet settings` and is enforced by
 * Binance in the user's app — the agent can read it and cannot raise it. The
 * other fields are this tool's own, stricter, local limits. Both apply; the
 * tighter one wins.
 */
export interface Budget {
  /** Local ceiling for a single call, USDT. */
  perCallCap: number;
  /** Local ceiling for the whole run, USDT. */
  runCap: number;
  /** Already committed during this run, USDT. */
  spent: number;
  /** Venue minimum order size, USDT. */
  minimumOrder: number;
  /** Remaining daily quota reported by the wallet, USDT. Null if unreadable. */
  walletDailyRemaining: number | null;
  /** Fraction of full Kelly to apply. 0.25 = quarter-Kelly. */
  kellyFraction: number;
}
