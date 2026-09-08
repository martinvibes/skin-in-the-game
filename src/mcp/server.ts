/**
 * Skin as an MCP server.
 *
 * The agent that keeps this record is not the only agent that should be able
 * to read it. Everything the CLI can show about what Skin has said and what
 * that cost it is exposed here, so another model — Claude, a trading desk's
 * own agent, a judge poking at the project — can query the record directly
 * instead of trusting a screenshot of it.
 *
 * ## There is no `skin_stake` tool, and that is the design
 *
 * Eight tools read. None of them spends. An MCP server is a surface an
 * arbitrary model can drive, often several conversation turns removed from the
 * person who owns the wallet, and prompt injection through a market title is
 * not a hypothetical on a venue where anyone can create a market. So the
 * boundary is drawn at the process edge: this server can form a view, size it,
 * and hand back the exact command that would execute it — and a human has to
 * type `stake` into their own terminal for money to move. `skin_propose` is
 * deliberately the end of the road.
 *
 * That is a smaller surface than it could be. It is also the only version of
 * this surface that is safe to hand to a model you did not write.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import type { PredictionClient } from '../adapters/baw.js';
import { DEMO_JOURNAL } from '../adapters/demo.js';
import type { MarketDataSource } from '../adapters/marketdata.js';
import type { Budget, Market, SettledCall } from '../domain/types.js';
import { formOpinion, horizonYears, parseClaim } from '../engine/analyst.js';
import { load as loadJournal, loadEntries, type JournalEntry } from '../engine/journal.js';
import { brierVerdict, buildRecord, joinConvictions } from '../engine/record.js';
import { scanMarkets } from '../engine/scan.js';
import { sizeStake } from '../engine/sizing.js';

/** Defaults for every tool that sizes money. Same numbers the CLI ships with. */
export interface McpDefaults {
  limit: number;
  runCap: number;
  perCall: number;
  kelly: number;
  minOrder: number;
}

// -- formatting --------------------------------------------------------------
// Plain text only: this output is read by a model, and ANSI escapes are noise
// in a transcript.

const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
const pct = (n: number, dp = 0) => `${(n * 100).toFixed(dp)}%`;

interface ToolReply {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  /** The SDK's result type is open; declaring that keeps handlers assignable. */
  [k: string]: unknown;
}

/** One headline a model can act on, then the numbers behind it. */
function reply(headline: string, data: unknown): ToolReply {
  return { content: [{ type: 'text', text: `${headline}\n\n${JSON.stringify(data, null, 2)}` }] };
}

function failure(message: string): ToolReply {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// -- shared plumbing ---------------------------------------------------------

/**
 * Resolve a market from whatever the caller had to hand.
 *
 * Agents will pass a topic id if they have one and a fragment of the question
 * if they do not, so both work. Matching is case-insensitive substring on the
 * title, which is ambiguous by nature — an ambiguous match is reported as such
 * rather than silently resolved to the first hit, because the next step after
 * this is sizing real money.
 */
async function findMarket(
  client: PredictionClient,
  needle: string,
  limit: number,
): Promise<{ ok: true; market: Market } | { ok: false; message: string }> {
  const markets = await client.markets({ limit: Math.max(limit, 24) });
  const exact = markets.find((m) => m.marketTopicId === needle || m.marketId === needle);
  if (exact) return { ok: true, market: exact };

  const n = needle.toLowerCase();
  const hits = markets.filter((m) => m.title.toLowerCase().includes(n));
  if (hits.length === 1) return { ok: true, market: hits[0]! };
  if (hits.length > 1) {
    return {
      ok: false,
      message:
        `"${needle}" matches ${hits.length} markets. Pass a marketTopicId instead:\n` +
        hits.map((m) => `  ${m.marketTopicId}  ${m.title}`).join('\n'),
    };
  }
  return {
    ok: false,
    message:
      `No tradable market matches "${needle}". Call skin_scan to see what is open right now.`,
  };
}

function budgetFrom(
  d: McpDefaults,
  args: { budget?: number; perCall?: number; kelly?: number; minOrder?: number },
  walletDailyRemaining: number | null,
): Budget {
  return {
    perCallCap: args.perCall ?? d.perCall,
    runCap: args.budget ?? d.runCap,
    spent: 0,
    minimumOrder: args.minOrder ?? d.minOrder,
    walletDailyRemaining,
    kellyFraction: args.kelly ?? d.kelly,
  };
}

/** Bankroll is what the wallet actually holds; the run cap is the fallback. */
async function bankrollOf(client: PredictionClient, runCap: number): Promise<number> {
  const balance = await client.walletBalance().catch(() => ({ usdt: null }));
  return balance.usdt ?? runCap;
}

async function journalEntries(client: PredictionClient): Promise<JournalEntry[]> {
  return client.mode === 'demo' ? DEMO_JOURNAL : loadEntries();
}

// -- the server --------------------------------------------------------------

const INSTRUCTIONS = `Skin is an AI analyst that has to bet its own money on Binance prediction
markets. Every probability it states is journalled before the outcome is known and scored
against reality afterwards, so its record is a fact rather than a claim.

Use skin_record and skin_calibration to judge whether this agent's numbers are worth
anything: a Brier score above 0.25 means it is worse than a coin-flipper who always says
50%, and skin_calibration shows where the miscalibration lives.

Use skin_scan for the current book of opinions, skin_opinion to see the model's working on
one market, and skin_propose for a sized stake.

No tool on this server can spend money. skin_propose returns the exact command, and a human
has to run it and type a confirmation word. Do not tell a user you have placed a bet.`;

export function createSkinServer(
  client: PredictionClient,
  source: MarketDataSource,
  defaults: McpDefaults,
): McpServer {
  const server = new McpServer(
    { name: 'skin', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );

  const modeNote =
    client.mode === 'demo'
      ? ' [demo mode: synthetic fixtures, no wallet, no money moved]'
      : '';

  // -- the record ------------------------------------------------------------

  server.registerTool(
    'skin_record',
    {
      title: 'Track record',
      description:
        "The agent's settled track record: calls, hit rate, realized PnL, ROI and Brier " +
        'score. Every field is a pure function of positions Binance has already settled; ' +
        'nothing here can be authored by the agent. Start here before trusting anything ' +
        'else it says.',
      inputSchema: {},
    },
    async (): Promise<ToolReply> => {
      const [rows, journal] = await Promise.all([client.settled(), loadJournal()]);
      const settled = joinConvictions(rows, journal);
      const rec = buildRecord(settled);

      const headline =
        rec.calls === 0
          ? 'Nothing has settled yet. The agent has no record to stand on.'
          : `${rec.calls} settled calls · ${rec.wins}W/${rec.losses}L · ` +
            `hit rate ${rec.hitRate === null ? 'n/a' : pct(rec.hitRate)} · ` +
            `realized ${usd(rec.realizedPnl)} on ${usd(rec.totalStaked)} staked · ` +
            `Brier ${rec.brier === null ? 'n/a' : rec.brier.toFixed(3)}` +
            modeNote;

      return reply(headline, {
        mode: client.mode,
        calls: rec.calls,
        wins: rec.wins,
        losses: rec.losses,
        hitRate: rec.hitRate,
        realizedPnl: rec.realizedPnl,
        totalStaked: rec.totalStaked,
        roi: rec.roi,
        brier: rec.brier,
        scoredCalls: rec.scoredCalls,
        brierVerdict: brierVerdict(rec.brier, rec.scoredCalls),
        equityCurve: rec.equityCurve,
      });
    },
  );

  server.registerTool(
    'skin_calibration',
    {
      title: 'Calibration',
      description:
        'Reliability curve: for each confidence bucket, what the agent said versus how ' +
        'often it was right. A well-calibrated agent that says 70% is right about 70% of ' +
        'the time. Use this to find where its numbers break down rather than whether they ' +
        'do on average.',
      inputSchema: {},
    },
    async (): Promise<ToolReply> => {
      const [rows, journal] = await Promise.all([client.settled(), loadJournal()]);
      const rec = buildRecord(joinConvictions(rows, journal));
      const bins = rec.calibration.filter((b) => b.n > 0);

      const worst = bins.reduce<null | (typeof bins)[number]>(
        (a, b) =>
          a === null ||
          Math.abs(b.meanConviction - b.observedRate) > Math.abs(a.meanConviction - a.observedRate)
            ? b
            : a,
        null,
      );

      const headline =
        rec.scoredCalls === 0
          ? 'No settled call carries a stated conviction, so there is nothing to calibrate.'
          : `Brier ${rec.brier === null ? 'n/a' : rec.brier.toFixed(3)} over ${rec.scoredCalls} ` +
            `scored calls (0.25 is a coin-flipper).` +
            (worst
              ? ` Widest gap: said ${pct(worst.meanConviction)}, was right ` +
                `${pct(worst.observedRate)} of ${worst.n}.`
              : '') +
            modeNote;

      return reply(headline, {
        mode: client.mode,
        brier: rec.brier,
        scoredCalls: rec.scoredCalls,
        verdict: brierVerdict(rec.brier, rec.scoredCalls),
        bins,
      });
    },
  );

  server.registerTool(
    'skin_slips',
    {
      title: 'Conviction slips',
      description:
        'The journal: every probability the agent wrote down before the outcome was known, ' +
        'with the thesis it gave at the time and, where the market has since resolved, ' +
        'what actually happened. This is the audit trail behind the Brier score.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional()
          .describe('How many slips to return, newest first. Default 20.'),
      },
    },
    async ({ limit }): Promise<ToolReply> => {
      const [entries, rows] = await Promise.all([journalEntries(client), client.settled()]);
      const byToken = new Map<string, SettledCall>(rows.map((r) => [r.tokenId, r]));

      const slips = [...entries]
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, limit ?? 20)
        .map((e) => {
          const s = byToken.get(e.tokenId);
          return {
            at: e.at,
            question: e.question,
            conviction: e.conviction,
            marketPrice: e.marketPrice,
            edge: Math.round((e.conviction - e.marketPrice) * 10_000) / 10_000,
            stake: e.stake,
            thesis: e.thesis,
            analyst: e.analyst,
            status: s ? s.outcome : 'OPEN',
            pnl: s ? s.pnl : null,
          };
        });

      const settledSlips = slips.filter((s) => s.status !== 'OPEN');
      const headline =
        `${slips.length} slip(s): ${settledSlips.filter((s) => s.status === 'WON').length} won, ` +
        `${settledSlips.filter((s) => s.status === 'LOST').length} lost, ` +
        `${slips.length - settledSlips.length} still open.` +
        modeNote;

      return reply(headline, { mode: client.mode, slips });
    },
  );

  // -- what is on the table right now ---------------------------------------

  server.registerTool(
    'skin_positions',
    {
      title: 'Open positions',
      description:
        'Money currently committed and not yet resolved, each row carrying the conviction ' +
        'that justified it. These are the calls the record has not judged yet.',
      inputSchema: {},
    },
    async (): Promise<ToolReply> => {
      const [open, journal] = await Promise.all([client.openPositions(), loadJournal()]);
      const rows = joinConvictions(open, journal);
      const exposure = rows.reduce((a, r) => a + r.cost, 0);

      return reply(
        rows.length === 0
          ? `No open positions.${modeNote}`
          : `${rows.length} open position(s), ${usd(exposure)} at risk.${modeNote}`,
        { mode: client.mode, exposure: Math.round(exposure * 100) / 100, positions: rows },
      );
    },
  );

  server.registerTool(
    'skin_unclaimed',
    {
      title: 'Unclaimed winnings',
      description:
        'Settled wins whose payout is still sitting on-chain unredeemed. Redeeming them ' +
        'moves money, so this server only reports them: run `skin claim` to sweep.',
      inputSchema: {},
    },
    async (): Promise<ToolReply> => {
      const rows = await client.unclaimed();
      const total = rows.reduce((a, r) => a + r.payout, 0);

      return reply(
        rows.length === 0
          ? `Nothing unclaimed. Every settled win has been redeemed.${modeNote}`
          : `${rows.length} unclaimed win(s) worth ${usd(total)}. Redeem with: skin claim` +
            modeNote,
        { mode: client.mode, total: Math.round(total * 100) / 100, unclaimed: rows },
      );
    },
  );

  // -- forming views ---------------------------------------------------------

  server.registerTool(
    'skin_scan',
    {
      title: 'Scan markets',
      description:
        'Form a view on every open crypto market and size the ones that clear the edge and ' +
        'budget gates. Returns the full working for each: the spot and volatility the model ' +
        'read, its probability, the market price, and either the stake or the exact reason ' +
        'it refused. Commits nothing.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional()
          .describe('Markets to scan. Default 12.'),
        budget: z.number().positive().optional()
          .describe('Ceiling for the whole run in USDT. Default 6.'),
        perCall: z.number().positive().optional()
          .describe('Ceiling for any single stake in USDT. Default 1.5.'),
        kelly: z.number().positive().max(1).optional()
          .describe('Fraction of full Kelly to apply. Default 0.25.'),
      },
    },
    async (args): Promise<ToolReply> => {
      const settings = await client
        .walletSettings()
        .catch(() => ({ dailyRemaining: null, dailyLimit: null, predictionEnabled: null }));
      const budget = budgetFrom(defaults, args, settings.dailyRemaining);
      const bankroll = await bankrollOf(client, budget.runCap);
      const trace = await scanMarkets(
        client,
        source,
        { limit: args.limit ?? defaults.limit },
        budget,
        bankroll,
      );

      const staked = trace.steps.filter((s) => s.verdict === 'staked');
      const headline =
        `${trace.steps.length} market(s) scanned · ${staked.length} cleared · ` +
        `${usd(trace.totalStaked)} would be committed of a ${usd(trace.runCap)} run cap.` +
        (staked.length === 0
          ? ' An analyst with nothing to say, saying nothing, is the system working.'
          : '') +
        modeNote;

      return reply(headline, trace);
    },
  );

  server.registerTool(
    'skin_opinion',
    {
      title: 'Opinion on one market',
      description:
        "The model's full working on a single market: the claim it parsed out of the " +
        'question, the horizon, the spot and realized volatility it measured, its ' +
        'probability, and the edge against the traded price. Returns the reason instead ' +
        'when the model has no method for that question, which is most of them.',
      inputSchema: {
        market: z.string().min(1)
          .describe('A marketTopicId, or any distinctive fragment of the market question.'),
      },
    },
    async ({ market }): Promise<ToolReply> => {
      const found = await findMarket(client, market, defaults.limit);
      if (!found.ok) return failure(found.message);
      const m = found.market;

      const result = await formOpinion(m, source);
      if (!result.ok) {
        return reply(`No opinion on "${m.title}": ${result.reason}`, {
          mode: client.mode,
          marketTopicId: m.marketTopicId,
          question: m.title,
          verdict: 'no-model',
          reason: result.reason,
        });
      }

      const o = result.opinion;
      const claim = parseClaim(m.title);
      const years = horizonYears(m.endDate);

      return reply(
        `${o.side} at ${pct(o.marketPrice)}: the model says ${pct(o.conviction)}, ` +
          `an edge of ${pct(o.conviction - o.marketPrice, 1)}. ${o.thesis}${modeNote}`,
        {
          mode: client.mode,
          marketTopicId: m.marketTopicId,
          question: m.title,
          endDate: m.endDate ?? null,
          horizonDays: years === null ? null : Math.round(years * 365 * 100) / 100,
          claim,
          observation: o.observation,
          side: o.side,
          tokenId: o.tokenId,
          conviction: o.conviction,
          marketPrice: o.marketPrice,
          edge: Math.round((o.conviction - o.marketPrice) * 10_000) / 10_000,
          thesis: o.thesis,
          analyst: o.analyst,
        },
      );
    },
  );

  server.registerTool(
    'skin_propose',
    {
      title: 'Propose a stake',
      description:
        'Size a stake on one market: quarter-Kelly against the measured edge, clipped by ' +
        "the per-call cap, the run budget and the wallet's own daily limit, with the " +
        'binding constraint named. This is the last tool on the server: it returns the ' +
        'command that would execute the stake and cannot execute it. Placing the order ' +
        'requires a human to run that command and type a confirmation word into their own ' +
        'terminal. Do not report a proposal as a placed bet.',
      inputSchema: {
        market: z.string().min(1)
          .describe('A marketTopicId, or any distinctive fragment of the market question.'),
        budget: z.number().positive().optional()
          .describe('Ceiling for the whole run in USDT. Default 6.'),
        perCall: z.number().positive().optional()
          .describe('Ceiling for this stake in USDT. Default 1.5.'),
        kelly: z.number().positive().max(1).optional()
          .describe('Fraction of full Kelly to apply. Default 0.25.'),
      },
    },
    async (args): Promise<ToolReply> => {
      const found = await findMarket(client, args.market, defaults.limit);
      if (!found.ok) return failure(found.message);
      const m = found.market;

      const result = await formOpinion(m, source);
      if (!result.ok) {
        return reply(`No stake proposed on "${m.title}": ${result.reason}`, {
          mode: client.mode,
          question: m.title,
          verdict: 'no-model',
          reason: result.reason,
        });
      }

      const o = result.opinion;
      const settings = await client
        .walletSettings()
        .catch(() => ({ dailyRemaining: null, dailyLimit: null, predictionEnabled: null }));
      const budget = budgetFrom(defaults, args, settings.dailyRemaining);
      const bankroll = await bankrollOf(client, budget.runCap);
      const sized = sizeStake(o.conviction, o.marketPrice, bankroll, budget);

      const command =
        `npm run skin -- stake --live --budget ${budget.runCap} --per-call ${budget.perCallCap}` +
        ` --kelly ${budget.kellyFraction}`;

      const base = {
        mode: client.mode,
        marketTopicId: m.marketTopicId,
        question: m.title,
        endDate: m.endDate ?? null,
        side: o.side,
        tokenId: o.tokenId,
        conviction: o.conviction,
        marketPrice: o.marketPrice,
        edge: Math.round((o.conviction - o.marketPrice) * 10_000) / 10_000,
        thesis: o.thesis,
        bankroll,
      };

      if (!sized.ok) {
        return reply(
          `No stake: ${sized.detail} (${sized.reason})${modeNote}`,
          { ...base, verdict: sized.reason, detail: sized.detail, sizing: null },
        );
      }

      return reply(
        `Proposed: ${usd(sized.sizing.stakeUsdt)} on ${o.side} at ${pct(o.marketPrice)}, ` +
          `bound by ${sized.sizing.bindingConstraint}. NOT PLACED: this server cannot ` +
          `spend. Run: ${command}${modeNote}`,
        {
          ...base,
          verdict: 'staked',
          sizing: sized.sizing,
          execution: {
            placed: false,
            executableHere: false,
            reason:
              'This MCP server is read-only by design. An arbitrary model can drive it, ' +
              'and market titles are attacker-controlled text, so the spend boundary sits ' +
              'at the process edge rather than inside a tool description.',
            command,
            confirmation:
              'That command prints the receipt, then waits for the operator to type the ' +
              'word `stake` before any order is submitted.',
          },
        },
      );
    },
  );

  return server;
}

/**
 * Serve over stdio.
 *
 * Nothing may be written to stdout after this point that is not a protocol
 * message, so the banner goes to stderr — which is also where the host will
 * show it if the connection fails.
 */
export async function serveStdio(
  client: PredictionClient,
  source: MarketDataSource,
  defaults: McpDefaults,
): Promise<void> {
  const server = createSkinServer(client, source, defaults);
  process.stderr.write(
    `skin mcp · 8 read-only tools · ${client.mode} mode · no tool on this server can spend\n`,
  );
  await server.connect(new StdioServerTransport());
}
