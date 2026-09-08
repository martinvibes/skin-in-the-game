/**
 * Tests for the `baw` response parsing.
 *
 * These are regression tests in the literal sense: every case below is a shape
 * this adapter got wrong against the real CLI, found by diffing it against the
 * response bodies documented in the Agentic Wallet skill. Each one failed
 * silently — no exception, just a `null` or a `false` that stopped the agent
 * from trading and looked like a bug somewhere else entirely.
 *
 * The fixtures are copied verbatim from that reference, so if Binance changes
 * a field name the fix is here and the diff says exactly what moved.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LiveClient } from '../src/adapters/baw.js';
import { formOpinion } from '../src/engine/analyst.js';
import { StaticSource } from '../src/adapters/marketdata.js';

/** Response bodies exactly as the skill's reference documents them. */
const RESPONSES: Record<string, unknown> = {
  'wallet status': { status: 'CONNECTED' },
  'wallet address': {
    addresses: [
      { binanceChainId: 'CT_501', chainName: 'Solana', address: 'SoLaNaAddr' },
      { binanceChainId: '56', chainName: 'BSC', address: '0xBSCADDRESS' },
    ],
  },
  'wallet settings': {
    maxSigninDuration: '48h',
    dailyLimit: 50000,
    predictionEnabled: true,
    predictionDailyLimit: 40,
    predictionQuotaUsed: 8,
    predictionQuotaLeft: 32,
    quotaUsed: 0,
    quotaLeft: 50000,
  },
  // A bare array, one row per chain, with numbers as strings.
  // One topic, nested markets, epoch endDate — the live shape of
  // `prediction market list`.
  'prediction market': {
    marketTopics: [
      {
        marketTopicId: 5433296,
        marketVariant: 'CRYPTO_UP_DOWN',
        symbol: 'BTCUSDT',
        timeframe: '5 min',
        endDate: 1788864600000,
        title: 'BTC Up or Down 5m',
        l1Categories: ['crypto', 'main-up-down'],
        variantData: { type: 'CRYPTO_UP_DOWN', startPrice: 78670.105, endPrice: null },
        markets: [
          {
            marketId: 10228610,
            title: 'Bitcoin Up or Down - September 8, 6:45AM-6:50AM ET',
            tradingStatus: 'OPEN',
            outcomes: [
              { name: 'Up', price: 0.59, index: 0, tokenId: '137733' },
              { name: 'Down', price: 0.41, index: 1, tokenId: '756271' },
            ],
          },
        ],
      },
      {
        marketTopicId: 5235735,
        marketVariant: 'DEFAULT',
        endDate: 1790827200000,
        title: 'What price will Bitcoin hit in September?',
        l1Categories: ['crypto'],
        variantData: null,
        markets: [
          {
            marketId: 9504266,
            title: '↑ 82,500',
            tradingStatus: 'OPEN',
            outcomes: [
              { name: 'Yes', price: 0.776, tokenId: '950a' },
              { name: 'No', price: 0.224, tokenId: '950b' },
            ],
          },
        ],
      },
    ],
  },
  'wallet balance': [
    { symbol: 'USDT', binanceChainId: 'CT_501', balance: '900.00', value: '900.00' },
    { symbol: 'USDT', binanceChainId: '56', balance: '14.25', value: '14.25' },
    { symbol: 'BNB', binanceChainId: '56', balance: '0.02', value: '17.40' },
  ],
};

let dir = '';
let bin = '';

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skin-baw-'));
  bin = join(dir, 'fake-baw');
  await writeFile(
    bin,
    '#!/usr/bin/env node\n' +
      'const args = process.argv.slice(2).filter((a) => a !== "--json");\n' +
      `const R = ${JSON.stringify(RESPONSES)};\n` +
      'const key = args.slice(0, 2).join(" ");\n' +
      'if (!(key in R)) { console.error("unexpected: " + key); process.exit(1); }\n' +
      'console.log(JSON.stringify({ success: true, data: R[key] }));\n',
    'utf8',
  );
  await chmod(bin, 0o755);
});

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('baw adapter', () => {
  test('a CONNECTED wallet reads as signed in', async () => {
    // The regression: 1.9.0 returns only `{ status: 'CONNECTED' }` — no
    // boolean, no address. Reading just the boolean reported every connected
    // wallet as signed out, and the CLI refused to run at all.
    const { signedIn, state, address } = await new LiveClient({ bin }).status();
    assert.equal(signedIn, true);
    assert.equal(state, 'CONNECTED');
    assert.equal(address, '0xBSCADDRESS', 'address should come from the BSC row');
  });

  test('prediction quota is read, not the general daily limit', async () => {
    // Prediction trades draw on their own quota. Sizing against `quotaLeft`
    // (50000) instead of `predictionQuotaLeft` (32) would plan stakes the
    // venue rejects; finding neither, as before, dropped the wallet ceiling
    // out of the sizing minimum entirely.
    const s = await new LiveClient({ bin }).walletSettings();
    assert.equal(s.dailyRemaining, 32);
    assert.equal(s.dailyLimit, 40);
    assert.equal(s.predictionEnabled, true);
  });

  test('topics are flattened into the markets they contain', async () => {
    // The regression: outcome tokens live on the nested `markets` array, not
    // on the topic. Reading them at the topic level found none, every market
    // was dropped as untradable, and `scan --live` printed an empty book.
    const ms = await new LiveClient({ bin }).markets({ limit: 5 });
    assert.equal(ms.length, 2);

    const up = ms[0]!;
    assert.equal(up.marketTopicId, '5433296');
    assert.equal(up.marketId, '10228610');
    assert.equal(up.outcomes.length, 2);
    assert.equal(up.outcomes[0]!.label, 'Up');
    assert.equal(up.outcomes[0]!.price, 0.59);

    // Symbol and strike come from the topic, not from parsing the title.
    assert.equal(up.symbol, 'BTCUSDT');
    assert.equal(up.referencePrice, 78670.105);
    assert.equal(up.variant, 'CRYPTO_UP_DOWN');
  });

  test('an epoch-millisecond endDate becomes a usable horizon', async () => {
    // `Date.parse('1788864600000')` is NaN, so every live market was refused
    // for "no usable resolution time" and the agent had nothing to say.
    const ms = await new LiveClient({ bin }).markets({ limit: 5 });
    const end = ms[0]!.endDate;
    assert.equal(end, new Date(1788864600000).toISOString());
    assert.ok(Number.isFinite(Date.parse(end!)));
  });

  test('a fragment title is prefixed with its topic so it reads standalone', async () => {
    const ms = await new LiveClient({ bin }).markets({ limit: 5 });
    assert.match(ms[1]!.title, /Bitcoin hit in September/);
  });

  test('a barrier market is refused, not mispriced', async () => {
    // "Will X hit $K" resolves on touching the level. A terminal model
    // understates that by roughly half, which would read as a large edge on
    // every one of them — the most expensive way to be wrong here.
    const ms = await new LiveClient({ bin }).markets({ limit: 5 });
    const source = new StaticSource({
      BTCUSDT: {
        symbol: 'BTCUSDT', spot: 78_700, annualVol: 0.5,
        samples: 200, rail: 'local', interval: '1m',
      },
    });

    const barrier = await formOpinion(ms[1]!, source);
    assert.equal(barrier.ok, false);
    assert.match(barrier.ok ? '' : barrier.reason, /Barrier question/);

    // The up/down market beside it is still priced.
    const priced = await formOpinion(ms[0]!, source, Date.parse('2026-09-08T10:00:00Z'));
    assert.equal(priced.ok, true);
  });

  test('USDT balance is the BSC row, not whichever chain came first', async () => {
    // USDT on Solana is not spendable on a market that settles on BSC. Taking
    // the first matching row put $900 of unusable balance into the bankroll
    // Kelly sizes against.
    const b = await new LiveClient({ bin }).walletBalance();
    assert.equal(b.usdt, 14.25);
  });
});
