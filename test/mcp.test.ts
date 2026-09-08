/**
 * Tests for the MCP surface.
 *
 * Two things are worth pinning here. The first is that the server actually
 * speaks the protocol — a tool list that only exists in TypeScript is not a
 * server. The second, and the reason this file exists at all, is the spend
 * boundary: this surface is drivable by an arbitrary model, so a future edit
 * that adds a tool capable of moving money should fail a test rather than pass
 * a review.
 */

import { test, describe } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { DemoClient } from '../src/adapters/demo.js';
import { StaticSource } from '../src/adapters/marketdata.js';
import { createSkinServer } from '../src/mcp/server.js';

const SOURCE = new StaticSource({
  BTCUSDT: { symbol: 'BTCUSDT', spot: 109_420, annualVol: 0.52, samples: 200, rail: 'local', interval: '1m' },
  ETHUSDT: { symbol: 'ETHUSDT', spot: 4_118, annualVol: 0.61, samples: 200, rail: 'local', interval: '1m' },
  SOLUSDT: { symbol: 'SOLUSDT', spot: 203.4, annualVol: 0.78, samples: 200, rail: 'local', interval: '1m' },
  BNBUSDT: { symbol: 'BNBUSDT', spot: 871.2, annualVol: 0.44, samples: 200, rail: 'local', interval: '1m' },
  XRPUSDT: { symbol: 'XRPUSDT', spot: 2.87, annualVol: 0.69, samples: 200, rail: 'local', interval: '1m' },
});

const DEFAULTS = { limit: 12, runCap: 6, perCall: 1.5, kelly: 0.25, minOrder: 1 };

/** A connected client speaking to a real server over a linked transport pair. */
async function connect(): Promise<Client> {
  const server = createSkinServer(new DemoClient(), SOURCE, DEFAULTS);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

/** First text block of a tool result, which is where every headline lives. */
async function callText(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  };
  return { isError: res.isError === true, text: res.content[0]?.text ?? '' };
}

describe('mcp surface', () => {
  test('exposes exactly the eight read-only tools', async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'skin_calibration',
      'skin_opinion',
      'skin_positions',
      'skin_propose',
      'skin_record',
      'skin_scan',
      'skin_slips',
      'skin_unclaimed',
    ]);
    await client.close();
  });

  test('no tool can move money', async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools;

    // Matched per underscore-separated word, so `skin_unclaimed` (a report)
    // passes while a future `skin_place_order` does not.
    const verbs = new Set([
      'stake', 'place', 'order', 'buy', 'sell', 'trade',
      'claim', 'redeem', 'transfer', 'approve', 'send', 'sign',
    ]);
    for (const t of tools) {
      const offending = t.name.split('_').filter((w) => verbs.has(w));
      assert.deepEqual(
        offending,
        [],
        `${t.name} names a state-changing action; the MCP surface is read-only`,
      );
    }

    // The names are a convention; this is the invariant. If the server ever
    // reaches for the two client methods that spend, this fails.
    const src = await readFile(new URL('../src/mcp/server.ts', import.meta.url), 'utf8');
    for (const method of ['placeOrder', 'redeem(']) {
      assert.ok(!src.includes(`client.${method}`), `mcp/server.ts calls client.${method}`);
    }
    await client.close();
  });

  test('the record it reports is the record the engine computes', async () => {
    const client = await connect();
    const { text } = await callText(client, 'skin_record');
    const data = JSON.parse(text.slice(text.indexOf('{')));

    assert.equal(data.calls, data.wins + data.losses);
    assert.equal(data.mode, 'demo');
    assert.ok(data.brier !== null && data.brier > 0 && data.brier < 1);
    await client.close();
  });

  test('a proposal is sized but explicitly not placed', async () => {
    const client = await connect();
    const { text } = await callText(client, 'skin_propose', { market: 'ETH' });
    const data = JSON.parse(text.slice(text.indexOf('{')));

    assert.equal(data.verdict, 'staked');
    assert.ok(data.sizing.stakeUsdt > 0);
    assert.equal(data.execution.placed, false);
    assert.equal(data.execution.executableHere, false);
    assert.match(text, /NOT PLACED/);
    await client.close();
  });

  test('an ambiguous market is refused rather than guessed', async () => {
    const client = await connect();
    // Two demo markets mention BTC; picking one silently would size real money
    // against a market the caller did not name.
    const { isError, text } = await callText(client, 'skin_opinion', { market: 'BTC' });
    assert.ok(isError);
    assert.match(text, /matches 2 markets/);
    await client.close();
  });

  test('a scan never exceeds the run cap it was given', async () => {
    const client = await connect();
    const { text } = await callText(client, 'skin_scan', { budget: 2 });
    const data = JSON.parse(text.slice(text.indexOf('{')));

    assert.ok(data.totalStaked <= 2 + 1e-9, `staked ${data.totalStaked} against a $2 cap`);
    assert.ok(data.steps.length > 0);
    await client.close();
  });
});
