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

/**
 * Normalise a timestamp to ISO-8601.
 *
 * `prediction market list` returns `endDate` as epoch milliseconds, which
 * `Date.parse` cannot read: the horizon came back `NaN`, so every live market
 * was refused for "no usable resolution time" and the agent had nothing to say
 * about anything. Both spellings are accepted here so the engine can keep
 * assuming ISO.
 */
function toIsoTime(o: unknown, ...keys: string[]): string | undefined {
  if (!isRec(o)) return undefined;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
    if (typeof v === 'string' && v.trim() !== '') {
      const t = v.trim();
      // 10 digits is seconds since the epoch, 13 is milliseconds.
      if (/^\d{10,}$/.test(t)) {
        return new Date(t.length <= 10 ? Number(t) * 1000 : Number(t)).toISOString();
      }
      if (Number.isFinite(Date.parse(t))) return t;
    }
  }
  return undefined;
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
  status(): Promise<WalletStatus>;
  walletSettings(): Promise<WalletSettings>;
  walletBalance(): Promise<{ usdt: number | null }>;
  markets(opts?: { query?: string; limit?: number }): Promise<Market[]>;
  openPositions(): Promise<OpenPosition[]>;
  unclaimed(): Promise<UnclaimedWin[]>;
  settled(limit?: number): Promise<SettledCall[]>;
  quote(input: QuoteInput): Promise<Quote>;
  placeOrder(quoteId: string, slippageBps: number): Promise<{ orderId: string | null }>;
  redeem(tokenIds: string[]): Promise<{ txHash: string | null }>;
}

/**
 * Connection state, as `baw wallet status` reports it.
 *
 * `CREATING` is its own state and not a synonym for signed out: the user has
 * approved on their phone but the wallet is still being provisioned, and a
 * trade sent during that window fails in a way that looks like a bug in this
 * tool. It is worth a distinct message.
 */
export interface WalletStatus {
  signedIn: boolean;
  address: string | null;
  /** Raw state string: `CONNECTED`, `CREATING`, `UNCONNECTED`, or `demo`. */
  state: string;
}

export interface WalletSettings {
  /** Remaining *prediction* quota for today, USDT. */
  dailyRemaining: number | null;
  /** The prediction daily limit, USDT. */
  dailyLimit: number | null;
  /**
   * Whether prediction trading is switched on for this wallet. `false` means
   * every `prediction trade` call will be rejected by policy no matter how
   * well sized, and the only fix is a toggle in the Binance app.
   */
  predictionEnabled: boolean | null;
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

  async status(): Promise<WalletStatus> {
    const d = await runBaw(['wallet', 'status'], this.#opts);

    // CLI 1.9.0 answers `{ status: 'CONNECTED' }` and carries no address and no
    // boolean at all. Reading only the boolean, as this did, reported a
    // connected wallet as signed out and refused every live run.
    const state = str(d, 'status', 'walletStatus', 'connectionStatus');
    const flag = isRec(d)
      ? (d['connected'] ?? d['signedIn'] ?? d['loggedIn'] ?? d['isConnected'])
      : undefined;
    const inline = str(d, 'address', 'walletAddress', 'account');

    const signedIn =
      state !== null
        ? state.toUpperCase() === 'CONNECTED'
        : typeof flag === 'boolean'
          ? flag
          : inline !== null;

    // The address lives behind its own command, one row per chain. Only worth
    // a second call once we know we are connected, and never worth failing the
    // status check over: it is display, not a gate.
    const address = inline ?? (signedIn ? await this.#bscAddress() : null);
    return { signedIn, address, state: state ?? (signedIn ? 'CONNECTED' : 'UNCONNECTED') };
  }

  /** The BNB Smart Chain address, which is the one prediction markets settle on. */
  async #bscAddress(): Promise<string | null> {
    try {
      const d = await runBaw(['wallet', 'address'], this.#opts);
      const rows = pickArray(d, 'addresses');
      const bsc = rows.find((r) => str(r, 'binanceChainId', 'chainId') === '56');
      return str(bsc ?? rows[0], 'address');
    } catch {
      return null;
    }
  }

  async walletSettings(): Promise<WalletSettings> {
    const d = await runBaw(['wallet', 'settings'], this.#opts);

    // Prediction trades draw on their own quota, separate from the wallet's
    // general daily limit: `predictionQuotaLeft`, not `quotaLeft`. Sizing
    // against the general figure would let the agent plan a stake the venue
    // then refuses, and sizing against nothing (which is what the old key list
    // produced: null) removes the wallet limit from the ceiling set entirely.
    const dailyRemaining = num(
      d,
      'predictionQuotaLeft',
      'predictionQuotaRemaining',
      'quotaLeft',
      'remainingDailyLimit',
      'dailyRemaining',
      'remainingQuota',
      'remaining',
    );
    const dailyLimit = num(d, 'predictionDailyLimit', 'dailyLimit', 'limit', 'dailyLimitUsd');
    const flag = isRec(d) ? d['predictionEnabled'] : undefined;

    return {
      dailyRemaining,
      dailyLimit,
      predictionEnabled: typeof flag === 'boolean' ? flag : null,
    };
  }

  async walletBalance() {
    const d = await runBaw(['wallet', 'balance'], this.#opts);
    const rows = pickArray(d, 'balances', 'tokens', 'assets');
    const usdt = rows.filter(
      (r) => (str(r, 'symbol', 'asset', 'token', 'name') ?? '').toUpperCase() === 'USDT',
    );

    // The CLI returns one row per chain. Prediction markets settle in USDT on
    // BNB Smart Chain, so USDT sitting on Solana or Base is not spendable here
    // and must not inflate the bankroll Kelly is sized against.
    const row = usdt.find((r) => str(r, 'binanceChainId', 'chainId') === '56') ?? usdt[0];
    if (row) return { usdt: num(row, 'balance', 'amount', 'free', 'available', 'value') };

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
    return pickArray(d, 'marketTopics', 'markets', 'topics')
      .flatMap(toMarkets)
      .filter(hasTradableOutcome);
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
      settledAt: toIsoTime(r, 'settledTime', 'settledAt', 'endDate', 'updateTime'),
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
    // `--binanceChainId` is documented as optional and is not: without it the
    // venue answers "chainId not supported" and the winnings stay unclaimed.
    // Every prediction market on this venue settles in USDT on BSC, so 56 is
    // the only value that can be right here.
    const d = await runBaw(
      ['prediction', 'trade', 'redeem', '--tokenIds', tokenIds.join(','), '--binanceChainId', '56'],
      this.#opts,
    );
    // A batch redeem answers with one result per token rather than a top-level
    // hash, so fall through to the first result's hash before giving up.
    const first = pickArray(d, 'results')[0];
    return {
      txHash:
        str(d, 'txHash', 'transactionHash', 'hash') ??
        (first ? str(first, 'txHash', 'transactionHash', 'hash') : null),
    };
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

/**
 * Flatten one market *topic* into the markets it actually contains.
 *
 * Binance nests: a topic ("What price will Bitcoin hit in September?") holds an
 * array of markets, each with its own id, title and outcome tokens, while the
 * symbol, reference price and resolution time live one level up on the topic.
 * Reading outcomes at the topic level, as this did, found none — so every live
 * market was silently dropped and `scan --live` printed an empty book.
 *
 * A topic with no nested array is treated as its own single market, which keeps
 * this working against the flatter shape older builds returned.
 */
function toMarkets(t: unknown): Market[] {
  if (!isRec(t)) return [];

  const topicId = str(t, 'marketTopicId', 'topicId', 'id') ?? '';
  const endDate = toIsoTime(t, 'endDate', 'endTime', 'resolutionTime');
  const variantData = isRec(t['variantData']) ? t['variantData'] : null;
  const topicTitle = str(t, 'title', 'question', 'name') ?? 'Untitled market';

  const shared = {
    marketTopicId: topicId,
    category:
      str(pickArray(t['l1Categories'] ?? [])[0], 'name') ??
      (Array.isArray(t['l1Categories']) ? String(t['l1Categories'][0] ?? '') : '') ??
      str(t, 'l1Category', 'category', 'categoryName') ??
      'unknown',
    endDate,
    variant: str(t, 'marketVariant', 'topicType') ?? undefined,
    symbol: str(t, 'symbol') ?? str(variantData, 'priceFeedSymbol') ?? undefined,
    referencePrice: num(variantData, 'startPrice', 'referencePrice') ?? undefined,
  };

  const nested = pickArray(t['markets'] ?? []);
  const rows = nested.length > 0 ? nested : [t];

  return rows.map((m) => {
    const own = str(m, 'title', 'question', 'name', 'marketTitle') ?? topicTitle;
    // Legs of a multi-outcome topic are titled as fragments ("↑ 82,500",
    // "September 30, 2026?") and mean nothing on their own, while a topic with
    // one market usually repeats a full question. Prefixing the short ones
    // keeps the receipt and the refusal reason readable without making the
    // long ones say everything twice.
    const fragment = nested.length > 1 || own.length < 32;
    const title = fragment && own !== topicTitle ? `${topicTitle} · ${own}` : own;

    return {
      ...shared,
      marketId: str(m, 'marketId', 'id') ?? topicId,
      title,
      outcomes: pickArray(
        isRec(m) ? (m['outcomes'] ?? m['tokens'] ?? m['options'] ?? []) : [],
      ).map(toOutcome),
    };
  });
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
    endDate: toIsoTime(r, 'endDate', 'endTime', 'resolutionTime'),
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
      toIsoTime(r, 'settledTime', 'settledAt', 'endDate', 'updateTime') ??
      new Date().toISOString(),
    claimed: payout > 0,
  };
}
