#!/usr/bin/env node
/**
 * `skin` — the command surface.
 *
 *   skin record     what the agent has actually done with its money
 *   skin scan       form opinions on live markets; commit nothing
 *   skin stake      scan, then put real money behind the calls that clear
 *   skin claim      sweep settled winnings and redeem them
 *   skin positions  what is still open
 *   skin export     dump the record as JSON for the dashboard
 *
 * ## Confirmation
 *
 * `stake` and `claim` move money. Both stop and wait for an explicit typed
 * confirmation before calling a state-changing `baw` command, which is what the
 * Agentic Wallet skill's own policy requires. `--yes` exists for unattended
 * runs and is deliberately noisy about the fact that it was used.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, exit } from 'node:process';
import { writeFile } from 'node:fs/promises';
import pc from 'picocolors';

import { LiveClient, type PredictionClient } from '../adapters/baw.js';
import { DEMO_JOURNAL, DemoClient } from '../adapters/demo.js';
import { bawAvailable } from '../adapters/exec.js';
import {
  McpSource,
  RestSource,
  StaticSource,
  type MarketDataSource,
} from '../adapters/marketdata.js';
import { formOpinion } from '../engine/analyst.js';
import { sizeStake } from '../engine/sizing.js';
import { buildRecord, joinConvictions } from '../engine/record.js';
import { load as loadJournal, loadEntries, record as journalRecord } from '../engine/journal.js';
import type { Budget, StakeVerdict } from '../domain/types.js';
import {
  heading,
  modeBanner,
  money,
  padEnd,
  padStart,
  pct,
  receipt,
  renderCalibration,
  renderRecord,
  renderSettled,
  rule,
  sparkline,
  usd,
  clip,
  wrap,
} from './render.js';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Flags {
  demo: boolean;
  live: boolean;
  yes: boolean;
  json: boolean;
  runCap: number;
  perCall: number;
  kelly: number;
  minOrder: number;
  limit: number;
  mcpData: string | null;
  out: string | null;
}

function parseFlags(args: string[]): Flags {
  const get = (name: string): string | null => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && i + 1 < args.length ? args[i + 1]! : null;
  };
  const has = (name: string) => args.includes(`--${name}`);
  const numOr = (name: string, fallback: number) => {
    const v = get(name);
    if (v === null) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    demo: has('demo'),
    live: has('live'),
    yes: has('yes'),
    json: has('json'),
    runCap: numOr('budget', 6),
    perCall: numOr('per-call', 1.5),
    kelly: numOr('kelly', 0.25),
    minOrder: numOr('min-order', 1),
    limit: numOr('limit', 12),
    mcpData: get('mcp-data'),
    out: get('out'),
  };
}

/**
 * Pick the execution mode.
 *
 * Defaults to demo unless `baw` is actually installed, because a reviewer who
 * clones the repo and runs `skin record` should get output, not an error about
 * a wallet they have not set up. `--live` forces the real path and fails loudly
 * if the CLI is missing, so live is never entered by accident either.
 */
async function makeClient(flags: Flags): Promise<PredictionClient> {
  if (flags.demo) return new DemoClient();
  const available = await bawAvailable();
  if (flags.live && !available) {
    console.error(
      pc.red('--live was requested but the `baw` CLI is not on PATH.\n') +
        'Install it with:\n' +
        '  npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet',
    );
    exit(1);
  }
  return available ? new LiveClient() : new DemoClient();
}

function makeDataSource(flags: Flags, mode: 'live' | 'demo'): MarketDataSource {
  if (flags.mcpData) return new McpSource(flags.mcpData);
  if (mode === 'demo') {
    // Fixed observation so demo output is deterministic and reproducible.
    return new StaticSource({
      BTCUSDT: { symbol: 'BTCUSDT', spot: 109_420, annualVol: 0.52, samples: 200, rail: 'local', interval: '1m' },
      ETHUSDT: { symbol: 'ETHUSDT', spot: 4_118, annualVol: 0.61, samples: 200, rail: 'local', interval: '1m' },
      SOLUSDT: { symbol: 'SOLUSDT', spot: 203.4, annualVol: 0.78, samples: 200, rail: 'local', interval: '1m' },
      BNBUSDT: { symbol: 'BNBUSDT', spot: 871.2, annualVol: 0.44, samples: 200, rail: 'local', interval: '1m' },
      XRPUSDT: { symbol: 'XRPUSDT', spot: 2.87, annualVol: 0.69, samples: 200, rail: 'local', interval: '1m' },
    });
  }
  return new RestSource();
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdRecord(client: PredictionClient, flags: Flags) {
  const [rows, journal] = await Promise.all([client.settled(), loadJournal()]);
  // Demo rows carry their own convictions; live rows get them from the journal.
  const withConviction = joinConvictions(rows, journal);
  const rec = buildRecord(withConviction);

  if (flags.json) {
    stdout.write(JSON.stringify(rec, null, 2) + '\n');
    return;
  }

  console.log(renderRecord(rec));
  if (rec.equityCurve.length > 0) {
    console.log(heading('equity curve', 'cumulative realized PnL, oldest call first'));
    console.log(sparkline(rec.equityCurve.map((p) => p.cumulativePnl)));
    console.log(
      '  ' +
        padEnd(pc.dim(`start $0.00`), 30) +
        padStart(pc.dim('now ') + money(rec.realizedPnl), 40),
    );
    console.log(rule());
  }
  console.log(renderCalibration(rec));
  console.log(renderSettled(withConviction, flags.limit));

  const unclaimed = await client.unclaimed();
  if (unclaimed.length > 0) {
    const total = unclaimed.reduce((a, u) => a + u.payout, 0);
    console.log(
      pc.yellow(`  ${unclaimed.length} settled win(s) still unclaimed, worth ${usd(total)}.`) +
        pc.dim('  Run `skin claim` to redeem.'),
    );
    console.log(rule());
  }
}

async function cmdScan(
  client: PredictionClient,
  source: MarketDataSource,
  flags: Flags,
  budget: Budget,
  bankroll: number,
): Promise<StakeVerdict[]> {
  const markets = await client.markets({ limit: flags.limit });
  const verdicts: StakeVerdict[] = [];

  console.log(
    heading(
      'scan',
      `${markets.length} market(s) · bankroll ${usd(bankroll)} · run cap ${usd(budget.runCap)} · ¼ Kelly`,
    ),
  );

  for (const m of markets) {
    const opinion = await formOpinion(m, source);
    if (!opinion.ok) {
      console.log('  ' + padEnd(pc.dim('skip'), 10) + padEnd(clip(m.title, 40), 42) + pc.dim(opinion.reason));
      continue;
    }
    const o = opinion.opinion;
    const sized = sizeStake(o.conviction, o.marketPrice, bankroll, budget);

    const call = {
      marketTopicId: m.marketTopicId,
      marketId: m.marketId,
      question: m.title,
      tokenId: o.tokenId,
      side: o.side,
      conviction: o.conviction,
      marketPrice: o.marketPrice,
      thesis: o.thesis,
      createdAt: new Date().toISOString(),
    };

    if (!sized.ok) {
      verdicts.push({ kind: 'declined', call, reason: sized.reason, detail: sized.detail });
      console.log(
        '  ' +
          padEnd(pc.red('pass'), 10) +
          padEnd(clip(m.title, 40), 42) +
          pc.dim(`${pct(o.conviction, 0)} vs ${pct(o.marketPrice, 0)} · ${sized.reason}`),
      );
      continue;
    }

    verdicts.push({ kind: 'staked', call, sizing: sized.sizing });
    budget.spent += sized.sizing.stakeUsdt;
    console.log(
      '  ' +
        padEnd(pc.yellow('BET'), 10) +
        padEnd(clip(m.title, 40), 42) +
        pc.dim(`${pct(o.conviction, 0)} vs ${pct(o.marketPrice, 0)} · `) +
        pc.yellow(usd(sized.sizing.stakeUsdt)),
    );
  }
  console.log(rule());

  const staked = verdicts.filter((v) => v.kind === 'staked');
  if (staked.length === 0) {
    console.log(
      pc.dim(
        '  No market cleared the edge and budget gates. An analyst with nothing to say,\n' +
          '  saying nothing, is the system working — not a failure.',
      ),
    );
    console.log(rule());
  }
  return verdicts;
}

async function cmdStake(
  client: PredictionClient,
  source: MarketDataSource,
  flags: Flags,
  budget: Budget,
  bankroll: number,
) {
  const verdicts = await cmdScan(client, source, flags, budget, bankroll);
  const staked = verdicts.filter(
    (v): v is Extract<StakeVerdict, { kind: 'staked' }> => v.kind === 'staked',
  );
  if (staked.length === 0) return;

  for (const v of staked) {
    console.log(
      receipt({
        question: v.call.question,
        side: v.call.side,
        sizing: v.sizing,
        thesis: v.call.thesis,
        status: 'PENDING',
      }),
    );
  }

  const total = staked.reduce((a, v) => a + v.sizing.stakeUsdt, 0);
  console.log('');
  console.log(
    pc.bold(`  About to commit ${pc.yellow(usd(total))} of real money across ${staked.length} call(s).`),
  );
  console.log(pc.dim('  This is irreversible. Losing calls do not come back.'));

  const ok = await confirm(`  Type ${pc.bold('stake')} to proceed: `, 'stake', flags.yes);
  if (!ok) {
    console.log(pc.dim('\n  Cancelled. Nothing was committed.'));
    return;
  }

  for (const v of staked) {
    try {
      const quote = await client.quote({
        tokenId: v.call.tokenId,
        marketTopicId: v.call.marketTopicId,
        amount: v.sizing.stakeUsdt,
      });
      const order = await client.placeOrder(quote.quoteId, quote.slippageBps);

      // Journal BEFORE announcing success: the conviction must be on record
      // even if the confirmation output is lost.
      await journalRecord({
        tokenId: v.call.tokenId,
        conviction: v.call.conviction,
        marketPrice: v.call.marketPrice,
        stake: v.sizing.stakeUsdt,
        question: v.call.question,
        thesis: v.call.thesis,
        analyst: 'quant/lognormal',
        at: new Date().toISOString(),
      });

      console.log(
        '  ' +
          pc.green('✓') +
          ` ${clip(v.call.question, 44)} · ${usd(v.sizing.stakeUsdt)} · order ${order.orderId ?? 'submitted'}`,
      );
    } catch (err) {
      // Reported verbatim, as the wallet skill's policy requires.
      console.error('  ' + pc.red('✗') + ` ${clip(v.call.question, 44)}`);
      console.error(pc.red(indent(String(err instanceof Error ? err.message : err), 4)));
    }
  }
  console.log('');
  console.log(
    pc.dim(
      '  Orders are submitted, not necessarily filled. Verify with:\n' +
        '    baw prediction order history --status FILLED --json',
    ),
  );
}

async function cmdClaim(client: PredictionClient, flags: Flags) {
  const unclaimed = await client.unclaimed();
  console.log(heading('unclaimed winnings', 'settled, won, and still sitting there'));

  if (unclaimed.length === 0) {
    console.log(pc.dim('  Nothing to claim. Every settled win has been redeemed.'));
    console.log(rule());
    return;
  }

  for (const u of unclaimed) {
    console.log('  ' + padEnd(clip(u.question, 48), 50) + padStart(pc.green(usd(u.payout)), 12));
  }
  const total = unclaimed.reduce((a, u) => a + u.payout, 0);
  console.log(rule());
  console.log('  ' + padEnd(pc.bold('TOTAL REDEEMABLE'), 50) + padStart(pc.bold(pc.green(usd(total))), 12));
  console.log('');

  const ok = await confirm(`  Type ${pc.bold('claim')} to redeem all: `, 'claim', flags.yes);
  if (!ok) {
    console.log(pc.dim('\n  Cancelled. Winnings left unclaimed.'));
    return;
  }

  try {
    const res = await client.redeem(unclaimed.map((u) => u.tokenId));
    console.log('  ' + pc.green('✓') + ` Redeemed ${usd(total)}` + (res.txHash ? pc.dim(`  tx ${res.txHash}`) : ''));
  } catch (err) {
    console.error(pc.red(indent(String(err instanceof Error ? err.message : err), 2)));
    exit(1);
  }
}

async function cmdPositions(client: PredictionClient, flags: Flags) {
  const [open, journal] = await Promise.all([client.openPositions(), loadJournal()]);
  const rows = joinConvictions(open, journal);

  if (flags.json) {
    stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return;
  }

  console.log(heading('open positions', 'money committed, outcome not yet known'));
  if (rows.length === 0) {
    console.log(pc.dim('  No open positions.'));
    console.log(rule());
    return;
  }
  console.log(
    '  ' +
      padEnd(pc.dim('market'), 40) +
      padStart(pc.dim('side'), 6) +
      padStart(pc.dim('said'), 7) +
      padStart(pc.dim('cost'), 9) +
      padStart(pc.dim('resolves'), 12),
  );
  for (const p of rows) {
    console.log(
      '  ' +
        padEnd(clip(p.question, 38), 40) +
        padStart(p.side, 6) +
        padStart(p.conviction === null ? pc.dim('—') : pct(p.conviction, 0), 7) +
        padStart(usd(p.cost), 9) +
        padStart(pc.dim(untilLabel(p.endDate)), 12),
    );
  }
  console.log(rule());
}

/** Round every number in a payload, leaving strings, nulls and shape intact. */
function roundDeep<T>(value: T, places: number): T {
  const f = 10 ** places;
  if (typeof value === 'number') return (Math.round(value * f) / f) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => roundDeep(v, places)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, roundDeep(v, places)]),
    ) as T;
  }
  return value;
}

/**
 * One scan, recorded rather than printed.
 *
 * The dashboard's console replays this step by step. Producing it here — from
 * the same `formOpinion` and `sizeStake` the CLI itself calls — means the web
 * UI cannot drift from the tool: it is showing a real run's working, not a
 * second implementation of the model that happens to agree today.
 */
async function buildScanTrace(
  client: PredictionClient,
  source: MarketDataSource,
  flags: Flags,
  budget: Budget,
  bankroll: number,
) {
  const markets = await client.markets({ limit: flags.limit });
  const steps = [];
  let staked = 0;

  for (const m of markets) {
    const base = { question: m.title, marketTopicId: m.marketTopicId, endDate: m.endDate };

    const opinion = await formOpinion(m, source);
    if (!opinion.ok) {
      steps.push({ ...base, verdict: 'no-model', detail: opinion.reason });
      continue;
    }

    const o = opinion.opinion;
    const obs = o.observation;
    const view = {
      ...base,
      symbol: obs.symbol,
      spot: obs.spot,
      annualVol: obs.annualVol,
      samples: obs.samples,
      interval: obs.interval,
      rail: obs.rail,
      side: o.side,
      tokenId: o.tokenId,
      conviction: o.conviction,
      marketPrice: o.marketPrice,
      edge: o.conviction - o.marketPrice,
      thesis: o.thesis,
      analyst: o.analyst,
    };

    const sized = sizeStake(o.conviction, o.marketPrice, bankroll, budget);
    if (!sized.ok) {
      steps.push({ ...view, verdict: sized.reason, detail: sized.detail });
      continue;
    }

    // Mirror the real run: a cleared stake consumes run budget, so a later
    // market can legitimately be refused for `budget-exhausted`.
    budget.spent += sized.sizing.stakeUsdt;
    staked += sized.sizing.stakeUsdt;
    steps.push({ ...view, verdict: 'staked', detail: null, sizing: sized.sizing });
  }

  return {
    bankroll,
    runCap: budget.runCap,
    perCallCap: budget.perCallCap,
    minimumOrder: budget.minimumOrder,
    kellyFraction: budget.kellyFraction,
    walletDailyRemaining: budget.walletDailyRemaining,
    rail: source.rail,
    totalStaked: Math.round(staked * 100) / 100,
    // The horizon is measured from `Date.now()`, so two exports taken a
    // millisecond apart disagree in the eleventh decimal. That drift is far
    // below anything the dashboard renders, but it would make the committed
    // payload un-reproducible — and a payload nobody can regenerate is a
    // payload nobody can check. Four decimals is three more than the UI shows
    // and hundreds of times coarser than the jitter.
    steps: roundDeep(steps, 4),
  };
}

/** Dump everything the dashboard needs as one JSON file. */
async function cmdExport(
  client: PredictionClient,
  source: MarketDataSource,
  flags: Flags,
  budget: Budget,
  bankroll: number,
) {
  const [settled, open, unclaimed, journal, entries, balance, settings] = await Promise.all([
    client.settled(),
    client.openPositions(),
    client.unclaimed(),
    loadJournal(),
    // Demo mode uses bundled entries rather than `~/.skin/journal.jsonl`, so the
    // exported payload is identical on any machine and never carries a real
    // operator's positions into a committed file.
    client.mode === 'demo' ? Promise.resolve(DEMO_JOURNAL) : loadEntries(),
    client.walletBalance().catch(() => ({ usdt: null })),
    client.walletSettings().catch(() => ({ dailyRemaining: null, dailyLimit: null })),
  ]);

  const withConviction = joinConvictions(settled, journal);
  const scan = await buildScanTrace(client, source, flags, { ...budget, spent: 0 }, bankroll);
  const payload = {
    generatedAt: new Date().toISOString(),
    mode: client.mode,
    scan,
    record: buildRecord(withConviction),
    settled: withConviction,
    open: joinConvictions(open, journal),
    unclaimed,
    journal: entries,
    wallet: { usdt: balance.usdt, ...settings },
  };

  const json = JSON.stringify(payload, null, 2);
  if (flags.out) {
    await writeFile(flags.out, json + '\n', 'utf8');
    console.log(pc.green(`Wrote ${flags.out}`) + pc.dim(` (${client.mode} data)`));
  } else {
    stdout.write(json + '\n');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Typed confirmation. The word must be typed in full; "y" is not accepted. */
async function confirm(prompt: string, word: string, skip: boolean): Promise<boolean> {
  if (skip) {
    console.log(pc.yellow(`  --yes supplied: proceeding without confirmation.`));
    return true;
  }
  if (!stdin.isTTY) {
    console.log(pc.red('  Not a TTY and --yes was not supplied. Refusing to move money.'));
    return false;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(prompt);
    return answer.trim().toLowerCase() === word;
  } finally {
    rl.close();
  }
}

function untilLabel(endDate?: string): string {
  if (!endDate) return '—';
  const ms = Date.parse(endDate) - Date.now();
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return 'due';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = min / 60;
  return h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
}

const indent = (s: string, n: number) =>
  s.split('\n').map((l) => ' '.repeat(n) + l).join('\n');

function help(): string {
  return [
    '',
    pc.bold('  skin') + pc.dim(' — an AI analyst that has to bet its own money'),
    '',
    pc.dim('  COMMANDS'),
    '    record       what the agent has actually done with its money',
    '    scan         form opinions on live markets; commit nothing',
    '    stake        scan, then put real money behind the calls that clear',
    '    claim        sweep settled winnings and redeem them',
    '    positions    what is still open',
    '    export       dump the record as JSON for the dashboard',
    '',
    pc.dim('  MODE'),
    '    --demo             synthetic fixtures; no wallet, no money (default without baw)',
    '    --live             require the real Binance Agentic Wallet',
    '',
    pc.dim('  BUDGET') + pc.dim('  (the wallet\'s own daily limit always applies on top)'),
    '    --budget <usdt>    ceiling for the whole run          (default 6)',
    '    --per-call <usdt>  ceiling for any single stake       (default 1.5)',
    '    --kelly <f>        fraction of full Kelly to apply    (default 0.25)',
    '    --min-order <usdt> venue minimum order size           (default 1)',
    '',
    pc.dim('  OTHER'),
    '    --mcp-data <path>  klines JSON supplied by an MCP-connected agent',
    '    --limit <n>        markets to scan / calls to list    (default 12)',
    '    --json             machine-readable output',
    '    --out <path>       write export to a file',
    '    --yes              skip confirmation (unattended runs)',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------

async function main() {
  const args = argv.slice(2);
  const command = args.find((a) => !a.startsWith('--')) ?? 'record';
  const flags = parseFlags(args);

  if (command === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(help());
    return;
  }

  const client = await makeClient(flags);
  const source = makeDataSource(flags, client.mode);

  if (!flags.json) {
    console.log('');
    console.log('  ' + pc.bold('SKIN') + pc.dim('  skin in the game') + '   ' + modeBanner(client.mode));
  }

  // A signed-out wallet is a normal first-run state, not a crash.
  if (client.mode === 'live') {
    const status = await client.status();
    if (!status.signedIn) {
      console.error(
        pc.red('\n  Wallet is not signed in.\n') +
          pc.dim('  Ask your agent: "Sign in to Binance Agentic Wallet", or run `baw auth signin`.\n'),
      );
      exit(1);
    }
  }

  // Bankroll is what the agent can actually spend, and the wallet's daily
  // remainder is read (never written) from Binance.
  const [balance, settings] = await Promise.all([
    client.walletBalance().catch(() => ({ usdt: null })),
    client.walletSettings().catch(() => ({ dailyRemaining: null, dailyLimit: null })),
  ]);
  const bankroll = balance.usdt ?? flags.runCap;

  const budget: Budget = {
    perCallCap: flags.perCall,
    runCap: flags.runCap,
    spent: 0,
    minimumOrder: flags.minOrder,
    walletDailyRemaining: settings.dailyRemaining,
    kellyFraction: flags.kelly,
  };

  switch (command) {
    case 'record':
      await cmdRecord(client, flags);
      break;
    case 'scan':
      await cmdScan(client, source, flags, budget, bankroll);
      break;
    case 'stake':
      await cmdStake(client, source, flags, budget, bankroll);
      break;
    case 'claim':
      await cmdClaim(client, flags);
      break;
    case 'positions':
      await cmdPositions(client, flags);
      break;
    case 'export':
      await cmdExport(client, source, flags, budget, bankroll);
      break;
    default:
      console.error(pc.red(`Unknown command: ${command}`));
      console.log(help());
      exit(1);
  }
}

main().catch((err) => {
  console.error(pc.red('\n' + (err instanceof Error ? err.message : String(err))));
  exit(1);
});

export { wrap };
