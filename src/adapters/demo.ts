/**
 * Demo client — synthetic data, clearly labelled everywhere it surfaces.
 *
 * ## Why this exists
 *
 * A reviewer should be able to `git clone`, run one command, and see the whole
 * loop without creating a Binance MPC wallet or spending money. Without that,
 * "it works" is something they have to take on faith.
 *
 * ## The rule this file obeys
 *
 * Demo data must never be mistakable for live data. `mode` is `'demo'` on this
 * client, the CLI prints a banner on every command, and the web UI carries a
 * persistent badge. Nothing here is ever shown without that context.
 *
 * The fixture below is deliberately **unflattering**. The agent finishes barely
 * above break-even, its single most confident call (88%) is its biggest loss,
 * and its Brier score lands at 0.26 — marginally worse than always saying
 * "50%". A demo tuned to show a winning streak would undercut the only thing
 * this project actually argues: that the record is whatever it is, and the
 * agent does not get a vote.
 */

import type {
  Market,
  OpenPosition,
  SettledCall,
  UnclaimedWin,
} from '../domain/types.js';
import type { PredictionClient, Quote, QuoteInput } from './baw.js';

const H = 3_600_000;
const now = () => Date.now();
const ago = (hours: number) => new Date(now() - hours * H).toISOString();
const ahead = (minutes: number) => new Date(now() + minutes * 60_000).toISOString();

/**
 * Twelve settled calls.
 *
 * Shaped to exercise every branch of the record: a high-conviction loss, a
 * low-conviction win, a near-coin-flip, and enough spread across confidence
 * buckets for the calibration curve to have more than one point.
 */
const SETTLED: SettledCall[] = [
  mk('d01', 'BTC above $108,000 — 15 min', 'YES', 'WON', 1.2, 2.05, 0.71, ago(46)),
  mk('d02', 'ETH above $4,150 — 15 min', 'NO', 'LOST', 1.0, 0, 0.66, ago(44)),
  mk('d03', 'BTC Up or Down — 5 min', 'NO', 'WON', 0.9, 1.72, 0.58, ago(41)),
  mk('d04', 'SOL above $210 — 1 h', 'YES', 'LOST', 1.5, 0, 0.88, ago(38)), // the expensive one
  mk('d05', 'BTC above $109,500 — 1 h', 'NO', 'WON', 1.1, 1.94, 0.74, ago(33)),
  mk('d06', 'BNB above $880 — 15 min', 'YES', 'WON', 0.8, 1.36, 0.62, ago(29)),
  mk('d07', 'ETH Up or Down — 5 min', 'YES', 'LOST', 1.0, 0, 0.55, ago(25)),
  mk('d08', 'BTC above $110,000 — 4 h', 'NO', 'WON', 1.4, 2.51, 0.79, ago(20)),
  mk('d09', 'XRP above $2.90 — 1 h', 'YES', 'LOST', 0.9, 0, 0.61, ago(16)),
  mk('d10', 'BTC Up or Down — 5 min', 'YES', 'WON', 1.0, 1.81, 0.57, ago(11)),
  mk('d11', 'ETH above $4,050 — 15 min', 'NO', 'LOST', 1.3, 0, 0.69, ago(7)),
  mk('d12', 'BTC above $107,500 — 15 min', 'YES', 'WON', 1.1, 1.88, 0.73, ago(3)),
];

/** Two winning positions whose payout is sitting unredeemed on-chain. */
const UNCLAIMED: UnclaimedWin[] = [
  { tokenId: 'd10', question: 'BTC Up or Down — 5 min', payout: 1.81, settledAt: ago(11) },
  { tokenId: 'd12', question: 'BTC above $107,500 — 15 min', payout: 1.88, settledAt: ago(3) },
];

const OPEN: OpenPosition[] = [
  {
    tokenId: 'd13',
    marketTopicId: 'm-1041',
    question: 'BTC above $111,000 — 1 h',
    side: 'NO',
    shares: 2.31,
    cost: 1.15,
    avgPrice: 0.498,
    conviction: 0.68,
    endDate: ahead(37),
  },
  {
    tokenId: 'd14',
    marketTopicId: 'm-1042',
    question: 'ETH Up or Down — 15 min',
    side: 'YES',
    shares: 1.94,
    cost: 0.95,
    avgPrice: 0.49,
    conviction: 0.59,
    endDate: ahead(9),
  },
];

/**
 * Five live markets, priced coherently against the fixed observations in
 * `makeDataSource` (BTC 109,420 @ 52% vol; ETH 4,118 @ 61%; SOL 203.4 @ 78%;
 * BNB 871.2 @ 44%).
 *
 * Coherence matters: strikes and prices are chosen so the model reaches each
 * of its five verdicts on a market where that verdict is genuinely correct —
 * two stakes (one bound by Kelly, one by the per-call cap), one skipped for
 * sizing below the venue minimum, and two skipped for having no real edge.
 * Fixtures that contradicted the observations would make a working model look
 * broken, which is a worse demo than showing fewer bets.
 */
const MARKETS: Market[] = [
  // ~50/50 and priced there: the model agrees, so it declines. `no-edge`.
  market('m-2001', 'BTC Up or Down — 5 min', ahead(5), 0.502, 0.498),
  // Model ~27% vs 52% asked: a wide edge on NO. Bound by Kelly.
  market('m-2002', 'BTC above $109,800 — 1 h', ahead(58), 0.52, 0.48),
  // Model ~5% vs 30% asked: wider still, so the per-call cap binds instead.
  market('m-2003', 'ETH above $4,140 — 15 min', ahead(14), 0.30, 0.70),
  // Real but thin edge; quarter-Kelly sizes under $1. `below-minimum`.
  market('m-2004', 'SOL above $204 — 1 h', ahead(51), 0.42, 0.58),
  // Edge inside the noise threshold. `no-edge`.
  market('m-2005', 'BNB above $872 — 4 h', ahead(233), 0.48, 0.52),
];

export class DemoClient implements PredictionClient {
  readonly mode = 'demo' as const;
  #redeemed = new Set<string>();

  async status() {
    return { signedIn: true, address: '0xDEMO000000000000000000000000000000000000' };
  }
  async walletSettings() {
    return { dailyRemaining: 12.4, dailyLimit: 20 };
  }
  async walletBalance() {
    return { usdt: 9.83 };
  }
  async markets() {
    return MARKETS;
  }
  async openPositions() {
    return OPEN;
  }
  async unclaimed() {
    return UNCLAIMED.filter((u) => !this.#redeemed.has(u.tokenId));
  }
  async settled() {
    return SETTLED;
  }

  async quote(input: QuoteInput): Promise<Quote> {
    const price = 0.49;
    return {
      quoteId: `demo-quote-${input.tokenId}`,
      amountOut: round(input.amount / price),
      averagePrice: price,
      feeAmount: round(input.amount * 0.004),
      minReceive: round((input.amount / price) * 0.9),
      slippageBps: input.slippageBps ?? 1000,
      expireAt: new Date(now() + 30_000).toISOString(),
      marketTitle: MARKETS.find((m) => m.outcomes.some((o) => o.tokenId === input.tokenId))?.title ?? null,
    };
  }

  async placeOrder(quoteId: string) {
    return { orderId: `demo-order-${quoteId.slice(-6)}` };
  }

  async redeem(tokenIds: string[]) {
    for (const t of tokenIds) this.#redeemed.add(t);
    return { txHash: `0xDEMO${'0'.repeat(56)}` };
  }
}

// ---------------------------------------------------------------------------

function mk(
  tokenId: string,
  question: string,
  side: 'YES' | 'NO',
  outcome: 'WON' | 'LOST',
  cost: number,
  payout: number,
  conviction: number,
  settledAt: string,
): SettledCall {
  return {
    tokenId,
    question,
    side,
    outcome,
    cost,
    payout,
    pnl: round(payout - cost),
    conviction,
    settledAt,
    claimed: outcome === 'WON' && !['d10', 'd12'].includes(tokenId),
  };
}

function market(id: string, title: string, endDate: string, yes: number, no: number): Market {
  return {
    marketTopicId: id,
    marketId: id,
    title,
    category: 'crypto',
    endDate,
    outcomes: [
      { tokenId: `${id}-Y`, label: 'Yes', price: yes },
      { tokenId: `${id}-N`, label: 'No', price: no },
    ],
  };
}

// Function declaration, not a const arrow: the fixture arrays above are built
// at module-initialisation time and would hit the temporal dead zone otherwise.
function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
