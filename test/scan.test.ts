/**
 * The two gates that only a live venue could have taught us: a market that
 * settles before a human can act, and a listed price that no longer exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { StaticSource } from '../src/adapters/marketdata.js';
import { closingSoon, probePrice, scanMarkets } from '../src/engine/scan.js';

const FLAT_SOURCE = new StaticSource({
  BNBUSDT: {
    symbol: 'BNBUSDT',
    spot: 752.28,
    annualVol: 0.49,
    samples: 200,
    rail: 'local',
    interval: '1m',
  },
});

// ---------------------------------------------------------------------------
// Horizon
// ---------------------------------------------------------------------------

test('closingSoon reports the remaining time only inside the window', () => {
  const now = Date.parse('2026-09-08T12:00:00Z');
  const at = (s: number) => new Date(now + s * 1000).toISOString();
  assert.equal(closingSoon(at(41), 2, now), 41_000);
  assert.equal(closingSoon(at(600), 2, now), null);
  assert.equal(closingSoon(at(41), 0, now), null, 'a zero horizon disables the gate');
  assert.equal(closingSoon(undefined, 2, now), null);
  assert.equal(closingSoon('not a date', 2, now), null);
});

test('closingSoon still fires on a market that already ended', () => {
  const now = Date.parse('2026-09-08T12:00:00Z');
  const past = new Date(now - 30_000).toISOString();
  assert.equal(closingSoon(past, 2, now), -30_000);
});

// ---------------------------------------------------------------------------
// Price confirmation
// ---------------------------------------------------------------------------

test('probePrice prefers the quote over the listed price', async () => {
  const client = { quote: async () => ({ averagePrice: 0.53 }) } as never;
  const got = await probePrice(client, { tokenId: 't', marketTopicId: 'm' }, 1, 0.03);
  assert.deepEqual(got, { price: 0.53, quoted: true });
});

test('probePrice keeps the listed price when the venue cannot quote', async () => {
  const client = {
    quote: async () => {
      throw new Error('no route');
    },
  } as never;
  const got = await probePrice(client, { tokenId: 't', marketTopicId: 'm' }, 1, 0.42);
  assert.deepEqual(got, { price: 0.42, quoted: false });
});

test('probePrice rejects a quote outside (0, 1) rather than trusting it', async () => {
  for (const bad of [0, 1, -0.2, 1.4, Number.NaN]) {
    const client = { quote: async () => ({ averagePrice: bad }) } as never;
    const got = await probePrice(client, { tokenId: 't', marketTopicId: 'm' }, 1, 0.42);
    assert.deepEqual(got, { price: 0.42, quoted: false }, `price ${bad}`);
  }
});

test('a stale listed price is declined, not staked', async () => {
  // The market that cost a real dollar of confidence: NO listed at 3%, which
  // the model reads as a 43-point edge, quoting at 53% where there is none.
  const market = {
    marketTopicId: 'm-1',
    marketId: 'k-1',
    title: 'BNB Up or Down · 15 min',
    symbol: 'BNBUSDT',
    referencePrice: 752.09,
    endDate: new Date(Date.now() + 15 * 60_000).toISOString(),
    outcomes: [
      { tokenId: 'yes', label: 'Up', price: 0.97 },
      { tokenId: 'no', label: 'Down', price: 0.03 },
    ],
  };
  const client = {
    markets: async () => [market],
    quote: async () => ({ averagePrice: 0.53 }),
  } as never;
  const trace = await scanMarkets(
    client,
    FLAT_SOURCE,
    { limit: 5 },
    { runCap: 6, perCallCap: 2, minimumOrder: 1, kellyFraction: 0.25, spent: 0, walletDailyRemaining: null },
    100,
  );
  const step = trace.steps[0];
  assert.equal(step?.verdict, 'stale-price');
  assert.match(String(step?.detail), /Listed at 3%, quotes at 53%/);
  assert.equal(trace.totalStaked, 0);
});
