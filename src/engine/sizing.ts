/**
 * Stake sizing.
 *
 * ## Why Kelly
 *
 * The agent needs a principled answer to "how much?" that is a function of how
 * strongly it disagrees with the market — not a flat bet, and not a number an
 * LLM picked. Flat betting throws away information: being 90% sure and 55% sure
 * should not cost the same. The Kelly criterion is the standard answer, it is
 * fully determined by two numbers we already have, and — crucially for this
 * project — it returns exactly zero when the agent agrees with the market.
 * "No edge, no bet" falls out of the arithmetic instead of being a rule bolted
 * on top.
 *
 * ## The formula
 *
 * A binary outcome token bought at price `c` pays $1 if it resolves true, so it
 * risks `c` to win `1 - c` net. Net decimal odds are therefore:
 *
 *     b = (1 - c) / c
 *
 * With `p` the agent's probability and `q = 1 - p`, full Kelly is:
 *
 *     f* = (b·p - q) / b  =  p - (1 - p)·c / (1 - c)
 *
 * Sanity checks that the tests pin down:
 *   - p = c        -> f* = 0      (agrees with the market: stake nothing)
 *   - p = 1        -> f* = 1      (certainty: the cap, not Kelly, protects you)
 *   - p < c        -> f* < 0      (the agent is bearish; take the other side)
 *
 * ## Why a fraction of Kelly
 *
 * Full Kelly maximises long-run growth only if `p` is exactly right, and `p` is
 * a model output — a volatility estimate pushed through a lognormal, which is
 * an approximation of an approximation. Kelly is famously punishing when its
 * input is overconfident: the drawdowns compound faster than the growth does. We apply a fraction (default one quarter), which
 * gives up a little growth for a large reduction in variance and in the damage
 * done by miscalibration. On top of that sit two hard caps that do not care
 * about the maths at all — a per-call cap and the wallet's own daily limit.
 */

import type { Budget, Sizing } from '../domain/types.js';

/** Conviction outside this band is rejected rather than clamped. */
export const CONVICTION_MIN = 0.02;
export const CONVICTION_MAX = 0.98;

/**
 * Minimum absolute edge before a bet is worth placing.
 *
 * Below this the "edge" is indistinguishable from noise in the agent's own
 * estimate and from the spread it will pay crossing it. Betting anyway would
 * manufacture activity for the demo at the user's expense.
 */
export const MIN_EDGE = 0.04;

/** Full-Kelly fraction of bankroll for a binary token bought at `price`. */
export function kellyFraction(p: number, price: number): number {
  if (price <= 0 || price >= 1) return 0;
  return p - ((1 - p) * price) / (1 - price);
}

/** Net decimal odds implied by a token price. */
export function impliedOdds(price: number): number {
  if (price <= 0 || price >= 1) return 0;
  return (1 - price) / price;
}

export type SizingResult =
  | { ok: true; sizing: Sizing }
  | { ok: false; reason: SizingRejection; detail: string };

export type SizingRejection =
  | 'conviction-bounds'
  | 'no-price'
  | 'no-edge'
  | 'below-minimum'
  | 'budget-exhausted';

/**
 * Size a stake, or explain precisely why not.
 *
 * @param p        agent's probability that the chosen side resolves true
 * @param price    price of that side's token, i.e. the market-implied probability
 * @param bankroll spendable USDT the agent is sizing against
 * @param budget   caps and venue constraints; the tightest one binds
 */
export function sizeStake(
  p: number,
  price: number | null,
  bankroll: number,
  budget: Budget,
): SizingResult {
  if (price === null || !Number.isFinite(price) || price <= 0 || price >= 1) {
    return {
      ok: false,
      reason: 'no-price',
      detail: 'Market has no usable last-trade price, so there is nothing to measure an edge against.',
    };
  }
  if (!Number.isFinite(p) || p < CONVICTION_MIN || p > CONVICTION_MAX) {
    // Near-certainties are refused rather than clamped. Out past ~98% the
    // model's own error is larger than the edge it is claiming, so the stake
    // would be sized on a number the model cannot actually support — and Kelly
    // sizes those most aggressively, which is exactly the wrong direction.
    return {
      ok: false,
      reason: 'conviction-bounds',
      detail: `Model reads ${pct(p)}, outside the ${pct(CONVICTION_MIN)}–${pct(CONVICTION_MAX)} band it is trusted in. Past that point its own error exceeds the edge it claims.`,
    };
  }

  const edge = p - price;
  if (edge < MIN_EDGE) {
    return {
      ok: false,
      reason: 'no-edge',
      detail:
        edge <= 0
          ? `Agent's ${pct(p)} is at or below the market's ${pct(price)} — it does not disagree, so it does not bet.`
          : `Edge of ${pct(edge)} is below the ${pct(MIN_EDGE)} threshold; too thin to distinguish from noise.`,
    };
  }

  // Budget headroom: the tightest of the run cap, the per-call cap, and the
  // wallet's Binance-enforced daily remainder.
  const runHeadroom = budget.runCap - budget.spent;
  if (runHeadroom < budget.minimumOrder) {
    return {
      ok: false,
      reason: 'budget-exhausted',
      detail: `Run budget has ${usd(runHeadroom)} left, below the ${usd(budget.minimumOrder)} venue minimum.`,
    };
  }
  if (budget.walletDailyRemaining !== null && budget.walletDailyRemaining < budget.minimumOrder) {
    return {
      ok: false,
      reason: 'budget-exhausted',
      detail: `Wallet daily limit has ${usd(budget.walletDailyRemaining)} left, below the ${usd(budget.minimumOrder)} venue minimum. This limit is set in the Binance app and the agent cannot raise it.`,
    };
  }

  const kellyFull = kellyFraction(p, price);
  const kellyApplied = Math.max(0, kellyFull) * budget.kellyFraction;
  const kellyStake = bankroll * kellyApplied;

  // Apply every ceiling and remember which one actually bound, so the CLI and
  // the UI can explain the number rather than just print it.
  const ceilings: Array<{ value: number; name: Sizing['bindingConstraint'] }> = [
    { value: kellyStake, name: 'kelly' },
    { value: budget.perCallCap, name: 'per-call-cap' },
    { value: runHeadroom, name: 'budget-remaining' },
  ];
  if (budget.walletDailyRemaining !== null) {
    ceilings.push({ value: budget.walletDailyRemaining, name: 'wallet-daily-limit' });
  }

  let binding = ceilings[0]!;
  for (const c of ceilings) if (c.value < binding.value) binding = c;

  const stakeUsdt = round2(binding.value);

  if (stakeUsdt < budget.minimumOrder) {
    return {
      ok: false,
      reason: 'below-minimum',
      detail: `${kellyLabel(budget.kellyFraction)} on a ${pct(edge)} edge sizes to ${usd(stakeUsdt)}, below the ${usd(budget.minimumOrder)} venue minimum. Betting more than the maths justifies to clear the floor would be the opposite of the point.`,
    };
  }

  return {
    ok: true,
    sizing: {
      p,
      price,
      edge,
      odds: impliedOdds(price),
      kellyFull,
      kellyApplied,
      stakeUsdt,
      bindingConstraint: binding.name,
    },
  };
}

/** Round half-up to cents; venue amounts are USDT with 2dp in practice. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}


/** "Quarter-Kelly", "half-Kelly", or the bare fraction for anything unusual. */
function kellyLabel(fraction: number): string {
  if (fraction === 0.25) return 'Quarter-Kelly';
  if (fraction === 0.5) return 'Half-Kelly';
  if (fraction === 1) return 'Full Kelly';
  return `${(fraction * 100).toFixed(0)}% of Kelly`;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const usd = (n: number) => `$${n.toFixed(2)}`;
