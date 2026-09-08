/**
 * `skin doctor` — first contact with a real wallet.
 *
 * Every field this project reads out of `baw` goes through a candidate list of
 * spellings (see the note at the top of `adapters/baw.ts`), because Binance has
 * moved these names between releases. That defensive read is the right call in
 * production and a terrible one to debug blind: a mistyped candidate list does
 * not throw, it quietly yields `null`, and a null bankroll turns into a refused
 * stake with no explanation.
 *
 * So this command runs every read-only call the agent makes, and prints two
 * things side by side: the keys the CLI actually returned, and the values we
 * managed to pull out of them. A mismatch is then a five-second fix rather than
 * an evening with a debugger, which matters when the wallet holds real money
 * and the market resolves in fifteen minutes.
 *
 * It never places an order and never redeems. `--deep` adds a trade quote,
 * which is a price enquiry and still moves nothing.
 */

import pc from 'picocolors';
import { runBaw } from '../adapters/exec.js';
import type { LiveClient } from '../adapters/baw.js';

interface ProbeResult {
  label: string;
  cmd: string;
  ok: boolean;
  rawKeys: string;
  parsed: Array<[string, unknown]>;
  error?: string;
}

/** A compact description of a payload's shape, one line long. */
function shapeOf(v: unknown, depth = 0): string {
  if (Array.isArray(v)) {
    const head = v.length > 0 ? shapeOf(v[0], depth + 1) : 'empty';
    return `array(${v.length}) of { ${head} }`;
  }
  if (v && typeof v === 'object') {
    const ks = Object.keys(v as Record<string, unknown>);
    const shown = ks.slice(0, 16).join(', ');
    return ks.length > 16 ? `${shown}, +${ks.length - 16} more` : shown;
  }
  return v === null ? 'null' : typeof v;
}

function show(v: unknown): string {
  if (v === null || v === undefined) return pc.red('NULL');
  if (typeof v === 'string') return v.length > 46 ? `${v.slice(0, 44)}…` : v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? pc.green('true') : pc.yellow('false');
  if (Array.isArray(v)) return `${v.length} row(s)`;
  return JSON.stringify(v).slice(0, 46);
}

async function probe(
  label: string,
  argv: string[],
  parse: (raw: unknown) => Promise<Array<[string, unknown]>>,
): Promise<ProbeResult> {
  const cmd = `baw ${argv.join(' ')}`;
  try {
    const raw = await runBaw(argv);
    const parsed = await parse(raw);
    return { label, cmd, ok: true, rawKeys: shapeOf(raw), parsed };
  } catch (err) {
    return {
      label,
      cmd,
      ok: false,
      rawKeys: '',
      parsed: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function cmdDoctor(
  client: LiveClient,
  opts: { deep: boolean; raw: boolean },
): Promise<number> {
  const results: ProbeResult[] = [];

  results.push(
    await probe('wallet status', ['wallet', 'status'], async () => {
      const s = await client.status();
      return [
        ['state', s.state],
        ['signedIn', s.signedIn],
        ['address (BSC)', s.address],
      ];
    }),
  );

  results.push(
    await probe('wallet settings', ['wallet', 'settings'], async () => {
      const s = await client.walletSettings();
      return [
        ['predictionEnabled', s.predictionEnabled],
        ['predictionDailyLimit', s.dailyLimit],
        ['predictionQuotaLeft', s.dailyRemaining],
      ];
    }),
  );

  results.push(
    await probe('wallet balance', ['wallet', 'balance'], async () => {
      const b = await client.walletBalance();
      return [['usdt', b.usdt]];
    }),
  );

  let firstTopicId: string | null = null;
  let firstMarketId: string | null = null;
  let firstTokenId: string | null = null;

  results.push(
    await probe(
      'market list',
      [
        'prediction', 'market', 'list',
        '--l1Category', 'crypto',
        '--sortBy', 'END_DATE', '--orderBy', 'ASC',
        '--limit', '5',
      ],
      async () => {
        const ms = await client.markets({ limit: 5 });
        const m = ms[0];
        // `last-trade-price` wants the market id; `trade quote` wants the
        // topic id. They are different numbers on the same market.
        firstTopicId = m?.marketTopicId ?? null;
        firstMarketId = m?.marketId ?? null;
        firstTokenId = m?.outcomes?.[0]?.tokenId ?? null;
        return [
          ['tradable markets', ms.length],
          ['first title', m?.title ?? null],
          ['first marketTopicId', m?.marketTopicId ?? null],
          ['first endDate', m?.endDate ?? null],
          ['outcomes', m?.outcomes?.length ?? null],
          ['outcome[0] label', m?.outcomes?.[0]?.label ?? null],
          ['outcome[0] price', m?.outcomes?.[0]?.price ?? null],
          ['outcome[0] tokenId', m?.outcomes?.[0]?.tokenId ?? null],
        ];
      },
    ),
  );

  results.push(
    await probe(
      'open positions',
      ['prediction', 'position', 'list', '--tab', 'ONGOING', '--limit', '100'],
      async () => {
        const p = await client.openPositions();
        return [
          ['open', p.length],
          ['first question', p[0]?.question ?? null],
          ['first cost', p[0]?.cost ?? null],
          ['first conviction', p[0]?.conviction ?? null],
        ];
      },
    ),
  );

  results.push(
    await probe(
      'unclaimed wins',
      ['prediction', 'position', 'list', '--tab', 'PENDING_CLAIM', '--limit', '100'],
      async () => {
        const u = await client.unclaimed();
        return [
          ['claimable', u.length],
          ['total payout', u.reduce((a, x) => a + x.payout, 0)],
          ['first tokenId', u[0]?.tokenId ?? null],
        ];
      },
    ),
  );

  results.push(
    await probe(
      'settled history',
      ['prediction', 'position', 'settled-history', '--filter', 'all', '--limit', '100'],
      async () => {
        const s = await client.settled(100);
        return [
          ['settled', s.length],
          ['first question', s[0]?.question ?? null],
          ['first payout', s[0]?.payout ?? null],
          ['first cost', s[0]?.cost ?? null],
          ['first outcome', s[0]?.outcome ?? null],
        ];
      },
    ),
  );

  if (firstMarketId) {
    results.push(
      await probe(
        'last trade price',
        ['prediction', 'market', 'last-trade-price', '--marketId', firstMarketId],
        async () => [['price', await client.lastPrice(firstMarketId as string)]],
      ),
    );
  }

  // A quote is a price enquiry. It commits nothing, but it is the last call
  // before an order, so it is the one most worth checking before going live.
  if (opts.deep && firstTopicId && firstTokenId) {
    results.push(
      await probe(
        'trade quote (no order placed)',
        ['prediction', 'trade', 'quote', '--amount', '1', '--side', 'BUY'],
        async () => {
          const q = await client.quote({
            tokenId: firstTokenId as string,
            marketTopicId: firstTopicId as string,
            amount: 1,
            slippageBps: 1000,
          });
          return [
            ['quoteId', q.quoteId],
            ['averagePrice', q.averagePrice],
            ['amountOut', q.amountOut],
            ['feeAmount', q.feeAmount],
            ['minReceive', q.minReceive],
            ['expireAt', q.expireAt],
          ];
        },
      ),
    );
  }

  // -- report ---------------------------------------------------------------

  console.log('');
  console.log(pc.bold('  WALLET DOCTOR'));
  console.log(pc.dim('  every read-only call the agent makes, and what parsed out of it'));
  console.log(pc.dim('  ' + '─'.repeat(74)));

  const blockers: string[] = [];
  let failures = 0;
  let nulls = 0;

  for (const r of results) {
    const bad = !r.ok;
    const missing = r.parsed.filter(([, v]) => v === null || v === undefined).length;
    if (bad) failures++;
    nulls += missing;

    const tag = bad
      ? pc.red('FAIL')
      : missing > 0
        ? pc.yellow('PART')
        : pc.green(' OK ');

    console.log('');
    console.log(`  [${tag}] ${pc.bold(r.label)}`);
    console.log(pc.dim(`         ${r.cmd}`));

    if (bad) {
      console.log(pc.red(`         ${(r.error ?? '').split('\n')[0]}`));
      continue;
    }

    console.log(pc.dim(`         returned  `) + pc.cyan(r.rawKeys));
    for (const [k, v] of r.parsed) {
      console.log(`         ${k.padEnd(22)}${show(v)}`);

      // Two values are perfectly parseable and still mean "you cannot trade".
      // They are worth calling out here rather than letting the user discover
      // them as a rejected order.
      if (k === 'state' && v !== 'CONNECTED') {
        blockers.push(
          v === 'CREATING'
            ? 'Wallet is still being created. Wait a moment and re-run doctor.'
            : 'Wallet is not signed in. Run `baw auth signin`, then `baw auth verify --qrCodeId <id>`.',
        );
      }
      if (k === 'predictionEnabled' && v === false) {
        blockers.push(
          'Prediction trading is switched off for this wallet. Enable it in the ' +
            'Binance app under Agentic Wallet settings; no stake can be placed until you do.',
        );
      }
    }
    if (missing > 0) {
      console.log(
        pc.yellow(
          `         ${missing} field(s) did not parse. Compare the names above ` +
            `with the candidate\n         lists in src/adapters/baw.ts and add the ones Binance is using.`,
        ),
      );
    }
  }

  console.log('');
  console.log(pc.dim('  ' + '─'.repeat(74)));

  for (const b of blockers) console.log(pc.yellow(`  ! ${b}`));
  if (blockers.length > 0) console.log('');

  if (failures === 0 && nulls === 0 && blockers.length === 0) {
    console.log(pc.green('  All probes parsed cleanly. The live path is ready to stake.'));
  } else {
    console.log(
      `  ${failures} command(s) failed, ${nulls} field(s) unparsed. ` +
        pc.dim('Fix these before staking real money.'),
    );
  }
  console.log('');

  if (opts.raw) {
    console.log(pc.dim('  Re-run any single command yourself for the full body, e.g.'));
    console.log(pc.dim('    baw wallet settings --json | jq\n'));
  }

  return failures > 0 || blockers.length > 0 ? 1 : 0;
}
