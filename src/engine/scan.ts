/**
 * One scan, as data rather than as terminal output.
 *
 * `cli/index.ts` prints a scan, the dashboard replays one step by step, and the
 * MCP server hands one to another agent. All three call this, so none of them
 * can drift from the tool: what the website shows is a real run's working, not
 * a second implementation of the model that happens to agree today.
 *
 * The step list is deliberately wide. Every intermediate the model touched —
 * the spot it read, the volatility it measured, how many candles that came
 * from, which rail served them — travels with the verdict, because a refusal
 * that cannot be audited is indistinguishable from a bug.
 */

import type { PredictionClient } from '../adapters/baw.js';
import type { MarketDataSource } from '../adapters/marketdata.js';
import type { Budget, Rail, Side, Sizing } from '../domain/types.js';
import { formOpinion, priceClause } from './analyst.js';
import { sizeStake } from './sizing.js';

/**
 * What happened to one market during a scan.
 *
 * Everything after `detail` is absent when the model never formed a view —
 * an unparseable question produces a step with a reason and nothing else,
 * which is itself worth showing.
 */
export interface ScanStep {
  question: string;
  marketTopicId: string;
  endDate?: string;
  /** `staked`, `no-model`, or one of the sizing rejections. */
  verdict: string;
  /** Why, in one sentence. Null on a stake — the sizing speaks for itself. */
  detail: string | null;

  symbol?: string;
  spot?: number;
  annualVol?: number;
  samples?: number;
  interval?: string;
  rail?: Rail;
  side?: Side;
  tokenId?: string;
  conviction?: number;
  marketPrice?: number;
  /** conviction - marketPrice. Positive means the agent is more bullish. */
  edge?: number;
  thesis?: string;
  analyst?: string;
  sizing?: Sizing;
}

export interface ScanTrace {
  bankroll: number;
  runCap: number;
  perCallCap: number;
  minimumOrder: number;
  kellyFraction: number;
  walletDailyRemaining: number | null;
  rail: Rail;
  totalStaked: number;
  steps: ScanStep[];
}

/**
 * How long is left on a market, when that is too little to act on.
 *
 * Returns the milliseconds remaining if the market resolves sooner than
 * `minMinutes`, and null when there is enough time. A five-minute market with
 * ninety seconds left cannot be priced, quoted, shown to a human and confirmed
 * before it settles — and a quote that expires mid-confirmation is a failed
 * order, not a bet. Declining early is honest; racing the clock is not.
 */
export function closingSoon(
  endDate: string | undefined,
  minMinutes: number,
  now = Date.now(),
): number | null {
  if (!endDate) return null;
  const left = Date.parse(endDate) - now;
  if (!Number.isFinite(left)) return null;
  return left < minMinutes * 60_000 ? left : null;
}

/** Round every number in a payload, leaving strings, nulls and shape intact. */
export function roundDeep<T>(value: T, places: number): T {
  const f = 10 ** places;
  if (typeof value === 'number') return (Math.round(value * f) / f) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => roundDeep(v, places)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as globalThis.Record<string, unknown>).map(([k, v]) => [
        k,
        roundDeep(v, places),
      ]),
    ) as T;
  }
  return value;
}

/**
 * Form a view on every market in reach and size the ones that clear.
 *
 * The passed `budget` is mutated as stakes accumulate, exactly as the real run
 * mutates it — so a later market can legitimately be refused for
 * `budget-exhausted`, and the trace shows that happening.
 */
/**
 * Confirm a call's price against a real quote before believing in it.
 *
 * A market's listed price is its last *traded* price. On a thin five-minute
 * book that print can be minutes old and wrong by tens of points: a BNB coin
 * flip listed at 3% quoted at 53% seconds later. An "edge" measured against
 * that number is not an edge, it is a stale print, and sizing on it is exactly
 * how a disciplined system talks itself into a random bet.
 *
 * So a call that survives the cheap gates is re-priced against a quote for the
 * size we actually mean to buy, and kept only if the edge survives the price we
 * would really pay. The quote is a read: it commits nothing and costs nothing.
 * If the venue cannot quote it, we say so rather than substituting a guess.
 */
export async function probePrice(
  client: PredictionClient,
  call: { tokenId: string; marketTopicId: string },
  amount: number,
  listed: number,
): Promise<{ price: number; quoted: boolean }> {
  try {
    const q = await client.quote({
      tokenId: call.tokenId,
      marketTopicId: call.marketTopicId,
      amount,
    });
    const p = q.averagePrice;
    return Number.isFinite(p) && p > 0 && p < 1
      ? { price: p, quoted: true }
      : { price: listed, quoted: false };
  } catch {
    return { price: listed, quoted: false };
  }
}

export async function scanMarkets(
  client: PredictionClient,
  source: MarketDataSource,
  opts: { limit: number; minHorizonMinutes?: number },
  budget: Budget,
  bankroll: number,
): Promise<ScanTrace> {
  const markets = await client.markets({ limit: opts.limit });
  const steps: ScanStep[] = [];
  let staked = 0;

  for (const m of markets) {
    const base = { question: m.title, marketTopicId: m.marketTopicId, endDate: m.endDate };

    const soon = closingSoon(m.endDate, opts.minHorizonMinutes ?? 0);
    if (soon !== null) {
      steps.push({
        ...base,
        verdict: 'closing-soon',
        detail: `Resolves in ${Math.max(0, Math.round(soon / 1000))}s, too soon to quote and confirm.`,
      });
      continue;
    }

    const opinion = await formOpinion(m, source);
    if (!opinion.ok) {
      steps.push({ ...base, verdict: 'no-model', detail: opinion.reason });
      continue;
    }

    const o = opinion.opinion;
    const obs = o.observation;
    const view = {
      ...base,
      symbol: obs.symbol,
      spot: obs.spot,
      annualVol: obs.annualVol,
      samples: obs.samples,
      interval: obs.interval,
      rail: obs.rail,
      side: o.side,
      tokenId: o.tokenId,
      conviction: o.conviction,
      marketPrice: o.marketPrice,
      edge: o.conviction - o.marketPrice,
      thesis: o.thesis,
      analyst: o.analyst,
    };

    const sized = sizeStake(o.conviction, o.marketPrice, bankroll, budget);
    if (!sized.ok) {
      steps.push({ ...view, verdict: sized.reason, detail: sized.detail });
      continue;
    }

    // The cheap gates passed on the listed price. Now find out what the price
    // actually is, and make the call answer for that one instead.
    const probe = await probePrice(
      client,
      { tokenId: o.tokenId, marketTopicId: m.marketTopicId },
      sized.sizing.stakeUsdt,
      o.marketPrice,
    );
    const priced = probe.quoted
      ? sizeStake(o.conviction, probe.price, bankroll, budget)
      : sized;
    const repriced = {
      ...view,
      marketPrice: probe.price,
      edge: o.conviction - probe.price,
      thesis: priceClause(o.thesisHead, o.side, probe.price, probe.quoted),
    };
    if (!priced.ok) {
      steps.push({
        ...repriced,
        verdict: 'stale-price',
        detail:
          `Listed at ${(o.marketPrice * 100).toFixed(0)}%, quotes at ` +
          `${(probe.price * 100).toFixed(0)}%. ${priced.detail}`,
      });
      continue;
    }

    budget.spent += priced.sizing.stakeUsdt;
    staked += priced.sizing.stakeUsdt;
    steps.push({ ...repriced, verdict: 'staked', detail: null, sizing: priced.sizing });
  }

  return {
    bankroll,
    runCap: budget.runCap,
    perCallCap: budget.perCallCap,
    minimumOrder: budget.minimumOrder,
    kellyFraction: budget.kellyFraction,
    walletDailyRemaining: budget.walletDailyRemaining,
    rail: source.rail,
    totalStaked: Math.round(staked * 100) / 100,
    // The horizon is measured from `Date.now()`, so two exports taken a
    // millisecond apart disagree in the eleventh decimal. That drift is far
    // below anything the dashboard renders, but it would make the committed
    // payload un-reproducible — and a payload nobody can regenerate is a
    // payload nobody can check. Four decimals is three more than the UI shows
    // and hundreds of times coarser than the jitter.
    steps: roundDeep(steps, 4),
  };
}
