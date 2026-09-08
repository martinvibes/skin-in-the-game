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

  test('USDT balance is the BSC row, not whichever chain came first', async () => {
    // USDT on Solana is not spendable on a market that settles on BSC. Taking
    // the first matching row put $900 of unusable balance into the bankroll
    // Kelly sizes against.
    const b = await new LiveClient({ bin }).walletBalance();
    assert.equal(b.usdt, 14.25);
  });
});
