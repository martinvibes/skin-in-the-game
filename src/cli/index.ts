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
 *   skin doctor     check every live wallet call before staking real money
 *   skin mcp        expose the record to other agents over MCP, read-only
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
import { cmdDoctor } from './doctor.js';
import { serveStdio } from '../mcp/server.js';
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
import { formOpinion, priceClause } from '../engine/analyst.js';
import { sizeStake } from '../engine/sizing.js';
import { buildRecord, joinConvictions } from '../engine/record.js';
import { closingSoon, probePrice, scanMarkets } from '../engine/scan.js';
import {
  journalPathFor,
  load as loadJournal,
  loadEntries,
  record as journalRecord,
} from '../engine/journal.js';
import type { Budget, StakeVerdict } from '../domain/types.js';
import {
  heading,
  cool,
  faint,
  good,
  ghost,
  gold,
  goldBadge,
  ink,
  modeBanner,
  muted,
  teal,
  wordmark,
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
  deep: boolean;
  raw: boolean;
  demo: boolean;
  live: boolean;
  yes: boolean;
  json: boolean;
  runCap: number;
  perCall: number;
  kelly: number;
  minOrder: number;
  minHorizon: number;
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
    minHorizon: numOr('min-horizon', 2),
    limit: numOr('limit', 12),
    deep: has('deep'),
    raw: has('raw'),
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

  // Money already committed, outcome not yet known. This is the only part of
  // the record the agent cannot influence any more and cannot yet be judged on,
  // and leaving it out made `record` print "nothing to show" to an operator who
  // had a live position open — the one moment they most need to see it.
  const open = await client.openPositions();
  if (open.length > 0) {
    const staked = open.reduce((a, p) => a + p.cost, 0);
    const payout = open.reduce((a, p) => a + p.shares, 0);
    console.log(
      heading(
        'open now',
        `${open.length} position(s) · ${usd(staked)} committed · pays ${usd(payout)} if every one wins`,
      ),
    );
    console.log(
      '  ' +
        faint(padEnd('market', 42) + padEnd('side', 6)) +
        teal(padEnd('said', 8)) +
        faint(padEnd('paid', 8) + 'settles'),
    );
    for (const p of open) {
      const said = p.conviction ?? journal.get(p.tokenId);
      console.log(
        '  ' +
          padEnd(muted(clip(p.question, 40)), 42) +
          padEnd(pc.bold(ink(p.side)), 6) +
          // The adapter cannot know what the agent believed; the journal can.
          padEnd(said === undefined ? ghost('—') : teal(pct(said, 0)), 8) +
          padEnd(muted(pct(p.avgPrice, 0)), 8) +
          cool(untilLabel(p.endDate)),
      );
    }
    console.log(rule());
  }

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

/**
 * The middle column of a scan row.
 *
 * A row that reads "80% vs 70%" never says the one thing the reader needs
 * first: which side of the market the agent is actually buying. Naming the
 * side, the price it pays and the value it thinks it is getting makes the
 * row a sentence — buy NO at 53 cents, worth 46 — instead of two bare numbers
 * whose order you have to remember.
 */
function shape(side: string, price: number, conviction: number): string {
  return (
    `${pc.bold(ink(side))} @ ${muted(pct(price, 0))}` + faint(' · fair ') + teal(pct(conviction, 0))
  );
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
  console.log(
    faint('  side it would buy @ price it would pay · ') +
      teal('fair') +
      faint(' = what the model thinks it is worth'),
  );

  for (const m of markets) {
    const soon = closingSoon(m.endDate, flags.minHorizon);
    if (soon !== null) {
      console.log(
        '  ' +
          padEnd(cool('late'), 10) +
          padEnd(muted(clip(m.title, 40)), 42) +
          faint(`resolves in ${Math.max(0, Math.round(soon / 1000))}s · too soon to act on`),
      );
      continue;
    }

    const opinion = await formOpinion(m, source);
    if (!opinion.ok) {
      console.log(
        '  ' + padEnd(ghost('skip'), 10) + padEnd(muted(clip(m.title, 40)), 42) + faint(opinion.reason),
      );
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
      thesisHead: o.thesisHead,
      createdAt: new Date().toISOString(),
    };

    if (!sized.ok) {
      verdicts.push({ kind: 'declined', call, reason: sized.reason, detail: sized.detail });
      console.log(
        '  ' +
          padEnd(ghost('pass'), 10) +
          padEnd(muted(clip(m.title, 40)), 42) +
          padEnd(shape(o.side, o.marketPrice, o.conviction), 30) +
          faint(sized.reason),
      );
      continue;
    }

    // Cheap gates passed on the listed price. Find out what the price really
    // is before calling this a bet, because the listed one is a last-trade
    // print and can be wrong by more than the entire edge.
    const probe = await probePrice(
      client,
      { tokenId: o.tokenId, marketTopicId: m.marketTopicId },
      sized.sizing.stakeUsdt,
      o.marketPrice,
    );
    const priced = probe.quoted ? sizeStake(o.conviction, probe.price, bankroll, budget) : sized;
    call.marketPrice = probe.price;
    call.thesis = priceClause(o.thesisHead, o.side, probe.price, probe.quoted);

    if (!priced.ok) {
      const detail =
        `Listed at ${pct(o.marketPrice, 0)}, quotes at ${pct(probe.price, 0)}. ${priced.detail}`;
      verdicts.push({ kind: 'declined', call, reason: 'stale-price', detail });
      console.log(
        '  ' +
          padEnd(ghost('pass'), 10) +
          padEnd(muted(clip(m.title, 40)), 42) +
          padEnd(
            `${pc.bold(ink(o.side))} @ ${faint(pct(o.marketPrice, 0))} ${ghost('→')} ${gold(pct(probe.price, 0))}` +
              faint(` · fair ${pct(o.conviction, 0)}`),
            30,
          ) +
          gold('stale-price'),
      );
      continue;
    }

    verdicts.push({ kind: 'staked', call, sizing: priced.sizing });
    budget.spent += priced.sizing.stakeUsdt;
    console.log(
      '  ' +
        padEnd(goldBadge('BET'), 10) +
        padEnd(pc.bold(ink(clip(m.title, 40))), 42) +
        padEnd(shape(o.side, probe.price, o.conviction), 30) +
        pc.bold(gold(usd(priced.sizing.stakeUsdt))),
    );
  }
  console.log(rule());

  // Say the outcome as a sentence. A column of `pass` reads as the tool
  // failing to find anything; the same information counted out loud reads as
  // the tool doing its job, which is what it is.
  const staked = verdicts.filter((v) => v.kind === 'staked');
  const declined = verdicts.length - staked.length;
  const committed = staked.reduce((a, v) => a + (v.kind === 'staked' ? v.sizing.stakeUsdt : 0), 0);
  const skipped = markets.length - verdicts.length;
  const parts = [
    staked.length > 0
      ? goldBadge(`${staked.length} cleared`) + ' ' + pc.bold(gold(usd(committed)))
      : null,
    declined > 0 ? ghost(`${declined} refused`) : null,
    skipped > 0 ? faint(`${skipped} not priced`) : null,
  ].filter(Boolean);
  console.log('  ' + parts.join(faint('  ·  ')));
  console.log(rule());

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
    '  ' +
      pc.bold(ink('About to commit ')) +
      goldBadge(usd(total)) +
      pc.bold(ink(` of real money across ${staked.length} call(s).`)),
  );
  console.log(faint('  This is irreversible. Losing calls do not come back.'));

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

      // Re-gate at execution.
      //
      // The scan measured its edge against the market's last *traded* price,
      // which can be minutes stale. `averagePrice` is what this order will
      // actually fill at, and on a short-duration market the two routinely
      // differ by ten points — enough to erase the entire reason for the bet
      // between forming the view and placing it. So the call is re-tested
      // against the price we are really paying, and abandoned if the edge that
      // justified it has gone. The alternative is buying something the agent
      // no longer believes is cheap, which is how a disciplined system quietly
      // becomes a random one.
      const paid = quote.averagePrice;
      const gate = {
        ...budget,
        spent: 0,
        runCap: v.sizing.stakeUsdt,
        perCallCap: v.sizing.stakeUsdt,
      };
      const regated = sizeStake(v.call.conviction, paid, bankroll, gate);
      if (!regated.ok) {
        console.log(
          '  ' +
            gold('~') +
            ' ' + muted(clip(v.call.question, 40)) +
            faint(' · re-priced ') + faint(pct(v.call.marketPrice, 0)) + ghost(' → ') +
            pc.bold(gold(pct(paid, 0))) +
            faint(` · ${regated.reason}`),
        );
        console.log(faint('    Not placed. The edge that justified this call is gone.'));
        continue;
      }

      const order = await client.placeOrder(quote.quoteId, quote.slippageBps);

      // Journal BEFORE announcing success: the conviction must be on record
      // even if the confirmation output is lost. The price recorded is the one
      // actually paid, not the one that prompted the call.
      await journalRecord(
        {
          tokenId: v.call.tokenId,
          conviction: v.call.conviction,
          marketPrice: paid,
          stake: v.sizing.stakeUsdt,
          question: v.call.question,
          thesis: priceClause(v.call.thesisHead, v.call.side, paid, true),
          analyst: 'quant/lognormal',
          at: new Date().toISOString(),
        },
        journalPathFor(client.mode),
      );

      console.log(
        '  ' +
          good('✓') +
          ' ' + ink(clip(v.call.question, 44)) +
          faint(' · ') + pc.bold(gold(usd(v.sizing.stakeUsdt))) +
          faint(` · order ${order.orderId ?? 'submitted'}`),
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
    client.walletSettings().catch(() => ({ dailyRemaining: null, dailyLimit: null, predictionEnabled: null })),
  ]);

  const withConviction = joinConvictions(settled, journal);
  const scan = await scanMarkets(
    client,
    source,
    { limit: flags.limit, minHorizonMinutes: flags.minHorizon },
    { ...budget, spent: 0 },
    bankroll,
  );
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
    '    doctor       check every live wallet call before staking real money',
    '    mcp          serve the record to other agents over MCP (read-only)',
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
    '    --min-horizon <min> skip markets resolving sooner     (default 2)',
    '',
    pc.dim('  OTHER'),
    '    --deep             doctor: also price a quote (still places no order)',
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

  // MCP owns stdout from here on: anything written to it that is not a
  // protocol frame breaks the transport, so the banner is skipped entirely and
  // `serveStdio` announces itself on stderr instead.
  if (command === 'mcp') {
    await serveStdio(client, source, {
      limit: flags.limit,
      runCap: flags.runCap,
      perCall: flags.perCall,
      kelly: flags.kelly,
      minOrder: flags.minOrder,
    });
    return;
  }

  if (!flags.json) {
    console.log('');
    console.log('  ' + wordmark() + '   ' + modeBanner(client.mode));
  }

  // Doctor runs before the sign-in guard on purpose: "you are not signed in"
  // is one of the diagnoses, not a reason to refuse to diagnose.
  if (command === 'doctor') {
    if (client.mode !== 'live') {
      console.error(
        pc.red('\n  doctor only means anything against a real wallet.\n') +
          pc.dim('  Install `baw`, sign in, then run: npm run skin -- doctor --live\n'),
      );
      exit(1);
    }
    exit(await cmdDoctor(client as LiveClient, { deep: flags.deep, raw: flags.raw }));
  }

  // A signed-out wallet is a normal first-run state, not a crash. `CREATING`
  // is its own state: approved on the phone, wallet not yet provisioned, and
  // a trade sent in that window fails in a way that reads like our bug.
  if (client.mode === 'live') {
    const status = await client.status();
    if (!status.signedIn) {
      console.error(
        status.state.toUpperCase() === 'CREATING'
          ? pc.yellow('\n  Wallet is still being created.\n') +
              pc.dim('  Give it a moment, then run `npm run skin -- doctor --live` again.\n')
          : pc.red('\n  Wallet is not signed in.\n') +
              pc.dim(
                '  Sign in is two steps, and the second one is the one people skip:\n' +
                  '    baw auth signin --json              # shows a pairing code and a URL\n' +
                  '    baw auth verify --qrCodeId <id>     # blocks until you approve on your phone\n' +
                  '  Leave `verify` running until it returns, or the session never lands locally.\n',
              ),
      );
      exit(1);
    }
  }

  // Bankroll is what the agent can actually spend, and the wallet's daily
  // remainder is read (never written) from Binance.
  const [balance, settings] = await Promise.all([
    client.walletBalance().catch(() => ({ usdt: null })),
    client
      .walletSettings()
      .catch(() => ({ dailyRemaining: null, dailyLimit: null, predictionEnabled: null })),
  ]);
  const bankroll = balance.usdt ?? flags.runCap;

  // Prediction trading is a per-wallet toggle set in the Binance app. If it is
  // off, every order is refused by policy however well sized, so say that here
  // rather than after a scan the user cannot act on.
  if (settings.predictionEnabled === false && (command === 'stake' || command === 'claim')) {
    console.error(
      pc.red('\n  Prediction trading is switched off for this wallet.\n') +
        pc.dim(
          '  Binance app > Agentic Wallet > settings, and enable prediction trading.\n' +
            '  `skin scan --live` still works: it forms opinions and commits nothing.\n',
        ),
    );
    exit(1);
  }

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
