/**
 * The analyst: where conviction comes from.
 *
 * ## Why a model and not a vibe
 *
 * The obvious build is to hand a market title to an LLM and ask "how likely is
 * this, 0 to 100?". That produces a number, but not an *accountable* one: LLM
 * confidence is famously miscalibrated, unstable across reruns, and impossible
 * to audit after the fact. Since this project's entire claim is that the
 * agent's stated probabilities get scored against reality, the probabilities
 * have to come from something a reviewer can check.
 *
 * So conviction comes from a standard diffusion model. For a market asking
 * whether an asset will be above a strike `K` at time `T`, price is modelled as
 * geometric Brownian motion and the answer is the closed-form probability:
 *
 *     P(S_T > K) = Φ(d₂),   d₂ = [ ln(S/K) + (μ - σ²/2)·T ] / (σ·√T)
 *
 * with `σ` the realized volatility measured from recent Binance candles.
 *
 * ## Why drift is zero
 *
 * `μ = 0` is set deliberately rather than fitted. Estimating drift from a few
 * hundred candles produces an artefact of the recent window, not a forecast —
 * a rally in the sample becomes "BTC goes up forever" and the model starts
 * buying tops with real money. Zero drift is the martingale assumption: the
 * best guess for tomorrow's price is today's. It makes the model honest about
 * the one thing it genuinely cannot know, and it means every edge the agent
 * finds comes from *volatility being mispriced*, which is a claim short-horizon
 * data can actually support.
 *
 * A consequence worth noticing: at `K = S` the model returns slightly *under*
 * 50%, because a lognormal's median sits below its mean. That is correct, and
 * it is the kind of small structural edge these markets misprice.
 *
 * ## On untrusted input
 *
 * Market titles are attacker-controllable strings from a public venue. They are
 * parsed here by regular expression and never interpolated into a prompt, a
 * shell command, or an eval. A title that fails to parse yields `null` and the
 * agent declines to bet — the failure mode is a missed opportunity, never a
 * fabricated probability or an injected instruction.
 */

import type { Market, Side } from '../domain/types.js';
import type { MarketDataSource, Observation } from '../adapters/marketdata.js';

// ---------------------------------------------------------------------------
// Normal distribution
// ---------------------------------------------------------------------------

/**
 * Error function, Abramowitz & Stegun 7.1.26.
 *
 * Maximum absolute error 1.5e-7 — far tighter than the uncertainty in a
 * volatility estimate, so it is not the limiting factor in the model.
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF, Φ(x). */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * P(S_T > K) under zero-drift geometric Brownian motion.
 *
 * @param spot      current price S
 * @param strike    threshold K
 * @param sigma     annualised volatility
 * @param years     horizon T, in years
 */
export function probabilityAbove(
  spot: number,
  strike: number,
  sigma: number,
  years: number,
): number | null {
  if (!(spot > 0 && strike > 0 && sigma > 0 && years > 0)) return null;
  const denom = sigma * Math.sqrt(years);
  if (denom <= 0) return null;
  const d2 = (Math.log(spot / strike) - (sigma * sigma * years) / 2) / denom;
  const p = normalCdf(d2);
  return Number.isFinite(p) ? p : null;
}

// ---------------------------------------------------------------------------
// Market title parsing
// ---------------------------------------------------------------------------

/** Assets the parser recognises, mapped to their Binance spot symbol. */
const ASSETS: Array<{ re: RegExp; symbol: string; name: string }> = [
  { re: /\b(btc|bitcoin|xbt)\b/i, symbol: 'BTCUSDT', name: 'BTC' },
  { re: /\b(eth|ethereum|ether)\b/i, symbol: 'ETHUSDT', name: 'ETH' },
  { re: /\b(bnb|binance coin)\b/i, symbol: 'BNBUSDT', name: 'BNB' },
  { re: /\b(sol|solana)\b/i, symbol: 'SOLUSDT', name: 'SOL' },
  { re: /\b(xrp|ripple)\b/i, symbol: 'XRPUSDT', name: 'XRP' },
  { re: /\b(doge|dogecoin)\b/i, symbol: 'DOGEUSDT', name: 'DOGE' },
];

/** A market title reduced to something the model can price. */
export interface ParsedClaim {
  symbol: string;
  asset: string;
  /** Threshold in quote currency. Null means "relative to spot at call time". */
  strike: number | null;
  /** Direction the YES/Up token is betting on. */
  direction: 'above' | 'below';
}

/**
 * Extract a priceable claim from a market title.
 *
 * Returns null when the title is not a directional price question — sports,
 * politics, and anything else this model has no business pricing. Declining is
 * the correct behaviour: the agent should have opinions only where it has a
 * method.
 */
export function parseClaim(title: string): ParsedClaim | null {
  const asset = ASSETS.find((a) => a.re.test(title));
  if (!asset) return null;

  // Both directions are tested independently, because a two-sided title
  // ("BTC Up or Down — 5 min") names them both. In that case the market's
  // YES/Up token is by convention the "above" side, so `above` wins the tie.
  // Checking `below` first — the obvious ordering — silently inverts every
  // short-duration up/down market, which is most of the tradable universe.
  const saysAbove = /\b(above|over|greater than|higher|up|exceed|reach|hit|rise)\b/i.test(title);
  const saysBelow = /\b(below|under|less than|lower|down|dip|fall|drop)\b/i.test(title);
  const direction: 'above' | 'below' | null = saysAbove
    ? 'above'
    : saysBelow
      ? 'below'
      : null;
  if (direction === null) return null;

  return { symbol: asset.symbol, asset: asset.name, strike: parseStrike(title), direction };
}

/**
 * Build a priceable claim for a market, preferring Binance's own metadata.
 *
 * `CRYPTO_UP_DOWN` topics carry `symbol` and `variantData.startPrice`
 * explicitly, which is strictly better than recovering them from prose: the
 * symbol is unambiguous, and the start price is the level the market actually
 * settles against rather than our guess of it. Title parsing remains the
 * fallback for every other shape.
 */
export function claimFor(market: Market): ParsedClaim | null {
  const symbol = market.symbol?.trim().toUpperCase();
  if (symbol && /^[A-Z]{2,10}USDT$/.test(symbol)) {
    const asset = symbol.replace(/USDT$/, '');
    return {
      symbol,
      asset,
      // An up/down market is "above the price it opened at", so the reference
      // price is the strike. Absent one, fall back to spot at call time.
      strike: market.referencePrice ?? null,
      direction: 'above',
    };
  }
  return parseClaim(market.title);
}

/**
 * Pull a dollar threshold out of a title.
 *
 * Handles `$110,000`, `110k`, `$110K`, `110000`. Returns null when there is no
 * threshold, which is the normal case for the short-duration "up or down from
 * here" markets — those price against spot instead.
 */
export function parseStrike(title: string): number | null {
  const withSuffix = /\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*([kKmM])\b/.exec(title);
  if (withSuffix) {
    const base = Number(withSuffix[1]!.replace(/,/g, ''));
    const mult = /[kK]/.test(withSuffix[2]!) ? 1_000 : 1_000_000;
    if (Number.isFinite(base)) return base * mult;
  }
  const plain = /\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(title);
  if (plain) {
    const n = Number(plain[1]!.replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
  }
  // A bare number is only treated as a strike when it is large enough to be a
  // price rather than a duration ("5 min", "3 hours") or a year.
  const bare = /\b([0-9][0-9,]{3,})(?:\.[0-9]+)?\b/.exec(title);
  if (bare) {
    const n = Number(bare[1]!.replace(/,/g, ''));
    if (Number.isFinite(n) && n > 100) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The analyst
// ---------------------------------------------------------------------------

export interface Opinion {
  /** Probability that `side` resolves true. */
  conviction: number;
  side: Side;
  /** Token id the agent would buy to express this view. */
  tokenId: string;
  /** Market-implied probability for that same token. */
  marketPrice: number;
  /** Human-readable reasoning. Display only — never parsed. */
  thesis: string;
  /** Identifier written to the journal, e.g. `quant/lognormal`. */
  analyst: string;
  /** The observation the opinion was built from, for the UI's "show your work". */
  observation: Observation;
}

export type OpinionResult =
  | { ok: true; opinion: Opinion }
  | { ok: false; reason: string };

/** Horizon in years from now until the market resolves. */
export function horizonYears(endDate: string | undefined, now = Date.now()): number | null {
  if (!endDate) return null;
  const end = Date.parse(endDate);
  if (!Number.isFinite(end)) return null;
  const ms = end - now;
  if (ms <= 0) return null;
  return ms / (365 * 24 * 3_600_000);
}

/**
 * Form an opinion on one market, or explain why the agent has none.
 *
 * The returned `side` is whichever outcome token the model thinks is
 * underpriced — the agent is not biased toward YES. If the model says 30% and
 * the YES token trades at 55%, the expressed view is to buy NO at 45%.
 */
export async function formOpinion(
  market: Market,
  source: MarketDataSource,
  now = Date.now(),
): Promise<OpinionResult> {
  // "Will X hit $K by T" resolves true if the price *touches* K at any point
  // before expiry, not just if it finishes there. For a driftless walk the
  // first-passage probability is close to twice the terminal one (reflection
  // principle), so pricing these with P(S_T > K) would understate them by
  // roughly half and hand the agent a large fake edge on every one. The model
  // is terminal, so it declines; the arrow-prefixed legs Binance uses for
  // these ("↑ 82,500") are the same question in shorter form.
  if (/\bhit\b|\btouch\b|\bfirst\b|[↑↓]/u.test(market.title)) {
    return {
      ok: false,
      reason:
        'Barrier question (resolves on touching the level, not on closing there). ' +
        'This model prices terminal probability only.',
    };
  }

  const claim = claimFor(market);
  if (!claim) {
    return {
      ok: false,
      reason: 'Not a directional crypto price question — this model has no method for it.',
    };
  }

  const years = horizonYears(market.endDate, now);
  if (years === null) {
    return { ok: false, reason: 'Market has no usable resolution time, so the horizon is unknown.' };
  }

  const obs = await source.observe(claim.symbol);
  if (!obs) {
    return { ok: false, reason: `No market data available for ${claim.symbol}.` };
  }

  // A market with no explicit threshold is an "up or down from here" market:
  // the strike is spot at the moment the call is made. When Binance gives us
  // the window's own start price we use that instead — an up/down market is
  // measured against where it opened, not against where spot happens to be
  // when the scan runs, and by mid-window those differ enough to matter.
  const strike = claim.strike ?? obs.spot;

  const pAbove = probabilityAbove(obs.spot, strike, obs.annualVol, years);
  if (pAbove === null) {
    return { ok: false, reason: 'Model inputs were degenerate (zero volatility or horizon).' };
  }

  // Probability that the market's YES/Up token resolves true.
  const pYes = claim.direction === 'above' ? pAbove : 1 - pAbove;

  const yes = pickOutcome(market, 'YES');
  const no = pickOutcome(market, 'NO');
  if (!yes || yes.price === null) {
    return { ok: false, reason: 'No priced YES/Up outcome token on this market.' };
  }

  // Express the view through whichever token the model thinks is cheap. When
  // the NO token is missing we can still take the YES side; we just cannot take
  // the other one.
  const yesEdge = pYes - yes.price;
  const noEdge = no && no.price !== null ? 1 - pYes - no.price : -Infinity;

  const takeNo = noEdge > yesEdge && no !== null && no.price !== null;
  const side: Side = takeNo ? 'NO' : 'YES';
  const token = takeNo ? no! : yes;
  const conviction = takeNo ? 1 - pYes : pYes;

  const horizonLabel = describeHorizon(years);
  const thesis =
    `${claim.asset} spot ${fmtPrice(obs.spot)}, realized vol ${(obs.annualVol * 100).toFixed(0)}% ` +
    `(${obs.samples} × ${obs.interval} candles). Zero-drift lognormal over ${horizonLabel} puts ` +
    `P(${claim.asset} ${claim.direction} ${fmtPrice(strike)}) at ${(pAbove * 100).toFixed(1)}%; ` +
    `market prices the ${side} token at ${(token.price! * 100).toFixed(1)}%.`;

  return {
    ok: true,
    opinion: {
      conviction,
      side,
      tokenId: token.tokenId,
      marketPrice: token.price!,
      thesis,
      analyst: 'quant/lognormal',
      observation: obs,
    },
  };
}

/** Find the outcome token matching a side, tolerating Yes/No and Up/Down naming. */
function pickOutcome(market: Market, side: Side) {
  const yesRe = /^(yes|up|above|over|true|higher)$/i;
  const noRe = /^(no|down|below|under|false|lower)$/i;
  const re = side === 'YES' ? yesRe : noRe;
  const exact = market.outcomes.find((o) => re.test(o.label.trim()));
  if (exact) return exact;
  // Binary markets are conventionally ordered [YES, NO]; fall back to position
  // only when there are exactly two outcomes and neither label matched.
  if (market.outcomes.length === 2) {
    return side === 'YES' ? market.outcomes[0]! : market.outcomes[1]!;
  }
  return null;
}

function describeHorizon(years: number): string {
  const minutes = years * 365 * 24 * 60;
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

function fmtPrice(n: number): string {
  return n >= 1000
    ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${n.toFixed(2)}`;
}
