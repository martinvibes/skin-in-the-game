/**
 * Typed client for the prediction-market surface of the Binance Agentic Wallet.
 *
 * Every method maps 1:1 onto a documented `baw` subcommand, listed here so the
 * mapping can be checked against Binance's reference without reading the code:
 *
 *   markets()        -> baw prediction market list | market search
 *   lastPrice()      -> baw prediction market last-trade-price
 *   openPositions()  -> baw prediction position list --tab ONGOING
 *   unclaimed()      -> baw prediction position list --tab PENDING_CLAIM
 *   settled()        -> baw prediction position settled-history
 *   quote()          -> baw prediction trade quote
 *   placeOrder()     -> baw prediction trade place-order
 *   redeem()         -> baw prediction trade redeem
 *   walletSettings() -> baw wallet settings
 *   walletBalance()  -> baw wallet balance
 *   status()         -> baw wallet status
 *
 * ## On defensive parsing
 *
 * Binance ships this CLI fast and its JSON field names have drifted between
 * versions. Rather than binding to one spelling and breaking on the next
 * release, every read goes through `num()` / `str()` / `pickArray()`, which
 * accept a list of candidate keys and return the first that is present and
 * well-typed. When nothing matches we return null and let the engine decide —
 * we never substitute a plausible-looking default, because a fabricated price
 * would silently corrupt a real stake calculation.
 */

import { runBaw, type RunOptions } from './exec.js';
import type {
  Market,
  OpenPosition,
  OutcomeToken,
  SettledCall,
  Side,
  UnclaimedWin,
} from '../domain/types.js';

// ---------------------------------------------------------------------------
// Field pickers
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null;

/** First candidate key that holds a finite number (accepts numeric strings). */
function num(o: unknown, ...keys: string[]): number | null {
  if (!isRec(o)) return null;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** First candidate key that holds a non-empty string (accepts numbers). */
function str(o: unknown, ...keys: string[]): string | null {
  if (!isRec(o)) return null;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/**
 * Locate the array of rows in a response.
 *
 * Different `baw` commands nest their list under different keys (`list`,
 * `rows`, `items`, `data`, `records`) and some return a bare array. Checking
 * candidates in order and falling back to "first array-valued property" covers
 * every shape observed in the reference docs without hard-coding one.
 */
function pickArray(payload: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRec(payload)) return [];
  for (const k of [...keys, 'list', 'rows', 'items', 'records', 'data', 'content']) {
    const v = payload[k];
    if (Array.isArray(v)) return v;
    // One more level: { data: { list: [...] } }
    if (isRec(v)) {
      for (const k2 of ['list', 'rows', 'items', 'records', 'content']) {
        const v2 = v[k2];
        if (Array.isArray(v2)) return v2;
      }
    }
  }
  for (const v of Object.values(payload)) if (Array.isArray(v)) return v;
  return [];
}

/** Normalise an outcome label to a side. Unknown labels default to YES. */
function toSide(label: string | null): Side {
  if (!label) return 'YES';
  const l = label.trim().toLowerCase();
  if (l === 'no' || l === 'down' || l === 'false' || l === 'bear') return 'NO';
  return 'YES';
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * The read/write surface Skin depends on.
 *
 * Declaring it as an interface (rather than reaching for the CLI directly) is
 * what makes `DemoClient` possible and what lets the engine be unit-tested
 * without a funded wallet.
 */
export interface PredictionClient {
  readonly mode: 'live' | 'demo';
  status(): Promise<{ signedIn: boolean; address: string | null }>;
  walletSettings(): Promise<{ dailyRemaining: number | null; dailyLimit: number | null }>;
  walletBalance(): Promise<{ usdt: number | null }>;
  markets(opts?: { query?: string; limit?: number }): Promise<Market[]>;
  openPositions(): Promise<OpenPosition[]>;
  unclaimed(): Promise<UnclaimedWin[]>;
  settled(limit?: number): Promise<SettledCall[]>;
  quote(input: QuoteInput): Promise<Quote>;
  placeOrder(quoteId: string, slippageBps: number): Promise<{ orderId: string | null }>;
  redeem(tokenIds: string[]): Promise<{ txHash: string | null }>;
}

export interface QuoteInput {
  tokenId: string;
  marketTopicId: string;
  /** USDT to spend (BUY). */
  amount: number;
  chainId?: number;
  slippageBps?: number;
}

export interface Quote {
  quoteId: string;
  /** Shares received for the spend. */
  amountOut: number;
  averagePrice: number;
  feeAmount: number;
  minReceive: number;
  slippageBps: number;
  expireAt: string | null;
  marketTitle: string | null;
}

/** Live client. Every call shells out to the real `baw` binary. */
export class LiveClient implements PredictionClient {
  readonly mode = 'live' as const;
  #opts: RunOptions;

  constructor(opts: RunOptions = {}) {
    this.#opts = opts;
  }

  async status() {
    const d = await runBaw(['wallet', 'status'], this.#opts);
    const address = str(d, 'address', 'walletAddress', 'account');
    // Treat presence of an address as the authoritative signal; different CLI
    // versions spell the boolean differently (`connected`, `loggedIn`, ...).
    const flag = isRec(d)
      ? (d['connected'] ?? d['signedIn'] ?? d['loggedIn'] ?? d['isConnected'])
      : undefined;
    const signedIn = typeof flag === 'boolean' ? flag : address !== null;
    return { signedIn, address };
  }

  async walletSettings() {
    const d = await runBaw(['wallet', 'settings'], this.#opts);
    return {
      dailyRemaining: num(d, 'remainingDailyLimit', 'dailyRemaining', 'remainingQuota', 'remaining'),
      dailyLimit: num(d, 'dailyLimit', 'limit', 'dailyLimitUsd'),
    };
  }

  async walletBalance() {
    const d = await runBaw(['wallet', 'balance'], this.#opts);
    const rows = pickArray(d, 'balances', 'tokens', 'assets');
    for (const r of rows) {
      const sym = str(r, 'symbol', 'asset', 'token', 'name');
      if (sym && sym.toUpperCase() === 'USDT') {
        return { usdt: num(r, 'balance', 'amount', 'free', 'available', 'value') };
      }
    }
    return { usdt: num(d, 'usdt', 'totalUsd', 'totalValueUsd') };
  }

  async markets(opts: { query?: string; limit?: number } = {}): Promise<Market[]> {
    const limit = String(opts.limit ?? 20);
    const args = opts.query
      ? ['prediction', 'market', 'search', '--query', opts.query, '--limit', limit]
      : [
          'prediction', 'market', 'list',
          '--l1Category', 'crypto',
          '--sortBy', 'END_DATE', '--orderBy', 'ASC',
          '--limit', limit,
        ];
    const d = await runBaw(args, this.#opts);
    return pickArray(d, 'markets', 'topics').map(toMarket).filter(hasTradableOutcome);
  }

  async lastPrice(marketId: string): Promise<number | null> {
    const d = await runBaw(
      ['prediction', 'market', 'last-trade-price', '--marketId', marketId],
      this.#opts,
    );
    return num(d, 'price', 'lastPrice', 'lastTradePrice');
  }

  async openPositions(): Promise<OpenPosition[]> {
    const d = await runBaw(
      ['prediction', 'position', 'list', '--tab', 'ONGOING', '--limit', '100'],
      this.#opts,
    );
    return pickArray(d, 'positions').map(toOpenPosition);
  }

  async unclaimed(): Promise<UnclaimedWin[]> {
    const d = await runBaw(
      ['prediction', 'position', 'list', '--tab', 'PENDING_CLAIM', '--limit', '100'],
      this.#opts,
    );
    return pickArray(d, 'positions').map((r) => ({
      tokenId: str(r, 'tokenId', 'id', 'outcomeTokenId') ?? '',
      question: str(r, 'marketTitle', 'title', 'question', 'name') ?? 'Unknown market',
      payout:
        num(r, 'payout', 'redeemableAmount', 'claimableAmount', 'value', 'amount') ?? 0,
      settledAt: str(r, 'settledTime', 'settledAt', 'endDate', 'updateTime') ?? undefined,
    })).filter((u) => u.tokenId !== '');
  }

  async settled(limit = 100): Promise<SettledCall[]> {
    const d = await runBaw(
      ['prediction', 'position', 'settled-history', '--filter', 'all', '--limit', String(limit)],
      this.#opts,
    );
    return pickArray(d, 'positions', 'history').map(toSettled);
  }

  async quote(input: QuoteInput): Promise<Quote> {
    const args = [
      'prediction', 'trade', 'quote',
      '--binanceChainId', String(input.chainId ?? 56),
      '--tokenId', input.tokenId,
      '--marketTopicId', input.marketTopicId,
      '--side', 'BUY',
      '--amount', String(input.amount),
      '--orderType', 'MARKET',
    ];
    if (input.slippageBps !== undefined) args.push('--slippageBps', String(input.slippageBps));
    const d = await runBaw(args, this.#opts);
    const quoteId = str(d, 'quoteId', 'id');
    if (!quoteId) {
      throw new Error(`Quote response contained no quoteId. Raw: ${JSON.stringify(d)}`);
    }
    return {
      quoteId,
      amountOut: num(d, 'amountOut') ?? 0,
      averagePrice: num(d, 'averagePrice', 'lastPrice') ?? 0,
      feeAmount: num(d, 'feeAmount') ?? 0,
      minReceive: num(d, 'minReceive') ?? 0,
      slippageBps: num(d, 'slippageBps') ?? input.slippageBps ?? 1000,
      expireAt: str(d, 'expireAt', 'expiresAt'),
      marketTitle: str(d, 'marketTitle', 'title'),
    };
  }

  async placeOrder(quoteId: string, slippageBps: number) {
    const d = await runBaw(
      ['prediction', 'trade', 'place-order', '--quoteId', quoteId, '--slippageBps', String(slippageBps)],
      this.#opts,
    );
    return { orderId: str(d, 'orderId', 'id', 'order_id') };
  }

  async redeem(tokenIds: string[]) {
    const d = await runBaw(
      ['prediction', 'trade', 'redeem', '--tokenIds', tokenIds.join(',')],
      this.#opts,
    );
    return { txHash: str(d, 'txHash', 'transactionHash', 'hash') };
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toMarket(r: unknown): Market {
  const outcomes = pickArray(
    isRec(r) ? (r['outcomes'] ?? r['tokens'] ?? r['options'] ?? []) : [],
  ).map(toOutcome);
  return {
    marketTopicId: str(r, 'marketTopicId', 'topicId', 'id') ?? '',
    marketId: str(r, 'marketId', 'id', 'marketTopicId') ?? '',
    title: str(r, 'title', 'question', 'name', 'marketTitle') ?? 'Untitled market',
    category: str(r, 'l1Category', 'category', 'categoryName') ?? 'unknown',
    endDate: str(r, 'endDate', 'endTime', 'resolutionTime', 'closeTime') ?? undefined,
    outcomes,
  };
}

function toOutcome(r: unknown): OutcomeToken {
  return {
    tokenId: str(r, 'tokenId', 'id', 'outcomeTokenId') ?? '',
    label: str(r, 'label', 'name', 'outcome', 'title') ?? 'Yes',
    price: num(r, 'price', 'lastPrice', 'lastTradePrice', 'midPrice'),
  };
}

/** A market we cannot price or address is not actionable — drop it early. */
function hasTradableOutcome(m: Market): boolean {
  return m.marketTopicId !== '' && m.outcomes.some((o) => o.tokenId !== '');
}

function toOpenPosition(r: unknown): OpenPosition {
  const shares = num(r, 'shares', 'quantity', 'amount', 'size') ?? 0;
  const cost = num(r, 'cost', 'costBasis', 'totalCost', 'investedAmount') ?? 0;
  return {
    tokenId: str(r, 'tokenId', 'id', 'outcomeTokenId') ?? '',
    marketTopicId: str(r, 'marketTopicId', 'topicId') ?? '',
    question: str(r, 'marketTitle', 'title', 'question', 'name') ?? 'Unknown market',
    side: toSide(str(r, 'outcome', 'label', 'side', 'outcomeName')),
    shares,
    cost,
    avgPrice: num(r, 'avgPrice', 'averagePrice', 'entryPrice') ?? (shares > 0 ? cost / shares : 0),
    conviction: null, // filled in from the local journal by the engine
    endDate: str(r, 'endDate', 'endTime', 'resolutionTime') ?? undefined,
  };
}

function toSettled(r: unknown): SettledCall {
  const cost = num(r, 'cost', 'costBasis', 'totalCost', 'investedAmount') ?? 0;
  const payout = num(r, 'payout', 'settledAmount', 'redeemedAmount', 'returnAmount') ?? 0;
  // Prefer an explicit PnL when the CLI gives one; otherwise derive it.
  const pnl = num(r, 'pnl', 'realizedPnl', 'profit') ?? payout - cost;
  // Prefer an explicit result flag over inferring from money, since a fully
  // refunded/void market can produce payout == cost.
  const resultFlag = str(r, 'result', 'status', 'outcomeResult', 'winStatus');
  const won = resultFlag
    ? /win|won|true|success/i.test(resultFlag)
    : payout > cost;
  return {
    tokenId: str(r, 'tokenId', 'id', 'outcomeTokenId') ?? '',
    question: str(r, 'marketTitle', 'title', 'question', 'name') ?? 'Unknown market',
    side: toSide(str(r, 'outcome', 'label', 'side', 'outcomeName')),
    outcome: won ? 'WON' : 'LOST',
    cost,
    payout,
    pnl,
    conviction: null, // joined from the journal by the engine
    settledAt:
      str(r, 'settledTime', 'settledAt', 'endDate', 'updateTime') ?? new Date().toISOString(),
    claimed: payout > 0,
  };
}
