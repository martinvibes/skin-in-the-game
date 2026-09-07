/**
 * Spot price and realized volatility, the two inputs the analyst needs.
 *
 * ## Two sources, one interface
 *
 * `McpSource` is the primary path for the hackathon: the Binance MCP Server is
 * an OAuth-protected endpoint that an MCP-capable agent (Claude Code, Codex,
 * ChatGPT) is already authenticated against, so the agent fetches klines with
 * its own session and hands them to this CLI as a JSON file. That keeps the
 * OAuth 2.1 + PKCE browser flow where it belongs — in the agent host — instead
 * of reimplementing a token dance inside a CLI.
 *
 * `RestSource` is the standalone fallback: Binance's public market-data REST
 * endpoint needs no authentication at all. It exists so the tool is runnable
 * and reviewable without an MCP session, and so the numbers in the tests come
 * from somewhere reproducible.
 *
 * Both produce the same `Observation`, so the analyst never learns which one
 * it got — but the `rail` field is carried through to the UI, because a reader
 * should always be able to see where a number came from.
 */

import { readFile } from 'node:fs/promises';
import type { Rail } from '../domain/types.js';

export interface Observation {
  symbol: string;
  /** Latest trade price in quote currency (USDT). */
  spot: number;
  /**
   * Annualised realized volatility, estimated from log returns of recent
   * candles. Annualised purely so the number is human-recognisable (crypto
   * majors sit around 0.4–0.8); the analyst rescales it to the market horizon.
   */
  annualVol: number;
  /** How many candles the estimate used. Small samples are noisy; we surface it. */
  samples: number;
  rail: Rail;
  /** Candle interval used, e.g. `1m`, `1h`. */
  interval: string;
}

export interface MarketDataSource {
  readonly rail: Rail;
  observe(symbol: string, interval?: string): Promise<Observation | null>;
}

/** Milliseconds per candle interval, for annualisation. */
const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

const MS_PER_YEAR = 365 * 24 * 3_600_000;

/**
 * Realized volatility from close prices, annualised.
 *
 * Uses the sample standard deviation of log returns (n-1 denominator), scaled
 * by the number of intervals in a year. Returns null below 10 returns — an
 * estimate from fewer is noise, and a fabricated volatility would flow straight
 * into a real stake size.
 */
export function realizedVolatility(closes: number[], intervalMs: number): number | null {
  if (closes.length < 11) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    const cur = closes[i]!;
    if (prev > 0 && cur > 0) rets.push(Math.log(cur / prev));
  }
  if (rets.length < 10) return null;

  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (rets.length - 1);
  const perInterval = Math.sqrt(variance);
  const intervalsPerYear = MS_PER_YEAR / intervalMs;
  return perInterval * Math.sqrt(intervalsPerYear);
}

/**
 * Public Binance market data over HTTPS. No credentials required.
 *
 * Several hosts are tried in order because `api.binance.com` is DNS-blocked in
 * some jurisdictions (Nigeria among them) while the data-only mirrors are not.
 * Failing over is the difference between the tool working on the author's
 * machine and working on a reviewer's.
 */
export class RestSource implements MarketDataSource {
  readonly rail: Rail = 'mcp';
  static readonly HOSTS = [
    'https://api.binance.com',
    'https://data-api.binance.vision',
    'https://api1.binance.com',
    'https://api-gcp.binance.com',
  ];

  async observe(symbol: string, interval = '1m'): Promise<Observation | null> {
    const limit = 200;
    for (const host of RestSource.HOSTS) {
      try {
        const url = `${host}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
        if (!res.ok) continue;
        const rows = (await res.json()) as unknown;
        if (!Array.isArray(rows) || rows.length < 11) continue;

        // Kline row layout: [openTime, open, high, low, close, volume, ...]
        const closes = rows
          .map((r) => (Array.isArray(r) ? Number(r[4]) : NaN))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (closes.length < 11) continue;

        const vol = realizedVolatility(closes, INTERVAL_MS[interval] ?? 60_000);
        if (vol === null) continue;

        return {
          symbol,
          spot: closes[closes.length - 1]!,
          annualVol: vol,
          samples: closes.length,
          rail: this.rail,
          interval,
        };
      } catch {
        continue; // try the next host
      }
    }
    return null;
  }
}

/**
 * Observations supplied by an MCP-connected agent.
 *
 * The agent calls the Binance MCP Server with its own OAuth session, writes the
 * klines to a JSON file, and points the CLI at it. Shape:
 *
 *   { "BTCUSDT": { "interval": "1m", "closes": [ ... ] } }
 */
export class McpSource implements MarketDataSource {
  readonly rail: Rail = 'mcp';
  #path: string;
  #cache: Record<string, { interval?: string; closes?: unknown }> | null = null;

  constructor(path: string) {
    this.#path = path;
  }

  async observe(symbol: string, interval = '1m'): Promise<Observation | null> {
    if (this.#cache === null) {
      const raw = await readFile(this.#path, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      this.#cache =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, { interval?: string; closes?: unknown }>)
          : {};
    }
    const entry = this.#cache[symbol];
    if (!entry || !Array.isArray(entry.closes)) return null;

    const closes = entry.closes
      .map((c) => Number(c))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (closes.length < 11) return null;

    const iv = entry.interval ?? interval;
    const vol = realizedVolatility(closes, INTERVAL_MS[iv] ?? 60_000);
    if (vol === null) return null;

    return {
      symbol,
      spot: closes[closes.length - 1]!,
      annualVol: vol,
      samples: closes.length,
      rail: this.rail,
      interval: iv,
    };
  }
}

/** Fixed observations for tests and demo mode. */
export class StaticSource implements MarketDataSource {
  readonly rail: Rail = 'local';
  #data: Record<string, Observation>;
  constructor(data: Record<string, Observation>) {
    this.#data = data;
  }
  async observe(symbol: string): Promise<Observation | null> {
    return this.#data[symbol] ?? null;
  }
}

export { INTERVAL_MS };
