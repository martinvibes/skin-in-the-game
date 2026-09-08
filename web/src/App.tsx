/**
 * Skin — an AI analyst that has to bet its own money on every call it makes.
 *
 * The page is written in acts. Each one owns the colour of the whole screen
 * while it is in front of you, and scrolling between them dissolves the ground
 * from paper to black and back rather than cutting. That is not decoration: the
 * console is a terminal and belongs in the dark, the record is a document and
 * belongs on paper, and moving between them should feel like moving between two
 * different kinds of evidence.
 *
 * Everything rendered here comes from `public/record.json`, written by
 * `skin export`. The page computes nothing: if a number is on screen, the CLI
 * produced it.
 */

import { useEffect, useState } from 'react';
import { Act, Heading, Reveal } from './components/Act';
import { Console } from './components/Console';
import { Loader } from './components/Loader';
import { Mark } from './components/Logo';
import { Nav, Roll, type View } from './components/Nav';
import { CalibrationPlot, EquityCurve } from './components/Charts';
import { OpenLedger, SettledLedger, Slip, Stat, UnclaimedPanel } from './components/Panels';
import { resetScroll, scrollToId, useSmoothScroll } from './lib/scroll';
import {
  brierVerdict,
  moneyTone,
  pct,
  usd,
  VERDICT_COPY,
  type Payload,
  type ScanStep,
} from './lib/data';

type Stage = 'enter' | 'shown' | 'leave';

/** How long the outgoing view has to get out of the way. */
const LEAVE_MS = 300;

export default function App() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('console');
  const [stage, setStage] = useState<Stage>('enter');
  const [staked, setStaked] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}record.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  // Re-measure on every view change: the acts are a different height each time,
  // and the smooth scroller drives the page off that measurement.
  useSmoothScroll([view, data !== null, booting]);

  useEffect(() => {
    resetScroll();
  }, [view]);

  // One listener feeds every `.ink-well` the pointer position it opens from,
  // rather than each button carrying its own handler.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('.ink-well') as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => document.removeEventListener('pointermove', onMove);
  }, []);

  // Views hand over rather than cut: the outgoing one lifts and fades, and only
  // then does the next mount and rise into place. Both halves are transitions
  // between declared states rather than a keyframe animation, because a
  // transition cannot start from a value an animation was supplying and the
  // outgoing view would otherwise blink out instead of leaving.
  function changeView(next: View) {
    if (next === view || stage === 'leave') return;
    setStage('leave');
    window.setTimeout(() => {
      setView(next);
      setStage('enter');
    }, LEAVE_MS);
  }

  // A view mounts already offset and transparent; it settles once the browser
  // has painted it there at least once.
  useEffect(() => {
    if (stage !== 'enter') return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setStage('shown'));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [stage, view]);

  if (error) return <Fallback message={error} />;
  if (!data) return <Loading />;

  return (
    <>
      {booting && (
        <Loader target={data.record.totalStaked} onDone={() => setBooting(false)} />
      )}
      <Nav view={view} onView={changeView} mode={data.mode} />
      <div id="scroll-content">
        <div key={view} className="view" data-state={stage}>
          <main>
            {view === 'console' && (
              <ConsoleView data={data} staked={staked} onStaked={() => setStaked(true)} />
            )}
            {view === 'record' && <RecordView data={data} />}
            {view === 'markets' && <MarketsView data={data} />}
            {view === 'how it works' && <HowView data={data} />}
          </main>
          <Footer data={data} />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Console — the default view
// ---------------------------------------------------------------------------

function ConsoleView({
  data,
  staked,
  onStaked,
}: {
  data: Payload;
  staked: boolean;
  onStaked: () => void;
}) {
  const rec = data.record;
  return (
    <>
      <Hero data={data} onStaked={onStaked} />

      <Act theme="dark">
        <Heading
          kicker="the point"
          title={
            <>
              Three numbers, and only one of them can be{' '}
              <span className="serif-accent">faked</span>.
            </>
          }
          lede="Hit rate is easy to flatter. Bet only on 95¢ near-certainties and it looks superb while you make nothing. Realized money and calibration cannot be gamed that way, so they come first."
        />
        <div className="grid gap-px overflow-hidden rounded-panel border hair sm:grid-cols-3">
          {[
            {
              label: 'realized p&l',
              value: usd(rec.realizedPnl, true),
              tone: moneyTone(rec.realizedPnl),
              note: `on ${usd(rec.totalStaked)} staked across ${rec.calls} settled calls`,
            },
            {
              label: 'brier score',
              value: rec.brier === null ? '—' : rec.brier.toFixed(3),
              tone: undefined,
              note: brierVerdict(rec.brier, rec.scoredCalls),
            },
            {
              label: 'hit rate',
              value: pct(rec.hitRate),
              tone: undefined,
              note: `${rec.wins} won · ${rec.losses} lost, listed last on purpose`,
            },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 90}>
              <div className="trace relative h-full bg-panel p-7">
                <p className="label mb-3">{s.label}</p>
                <p data-numeric className={`font-mono text-[32px] ${s.tone ?? 'text-ink'}`}>
                  {s.value}
                </p>
                <p className="mt-3 text-[13px] leading-relaxed text-faint">{s.note}</p>
              </div>
            </Reveal>
          ))}
        </div>
        {staked && (
          <p className="mt-6 font-mono text-2xs text-live">
            ✓ your run is journalled. In a live session those two calls would now appear as open
            positions
          </p>
        )}
      </Act>
    </>
  );
}

/**
 * The hero.
 *
 * Sofer's landing page puts the thing you are supposed to try directly under
 * the headline, so the first scroll is into the product rather than into a
 * description of it. This does the same: claim, then the console you drive,
 * then the receipts. The line about being wrong is there because a page that
 * advertises only its wins is the thing this project exists to argue against.
 */
function Hero({ data, onStaked }: { data: Payload; onStaked: () => void }) {
  const rec = data.record;
  return (
    <Act theme="light" id="console" className="!pt-32 md:!pt-36">
      <Reveal className="text-center">
        <p className="kicker mb-8 justify-center">
          <span className="h-1.5 w-1.5 rounded-full bg-live" />
          binance agent os · track a
        </p>
        <h1 className="mx-auto max-w-[19ch] font-display text-[clamp(40px,6.6vw,78px)] font-medium leading-[1.02] tracking-[-0.035em] text-ink">
          Every AI has an opinion. This one has a{' '}
          <span className="serif-accent">balance</span>.
        </h1>
        <p className="mx-auto mt-7 max-w-[46ch] text-[17px] leading-relaxed text-muted md:text-[19px]">
          It is not allowed to tell you what a market will do until it has put its own money on
          the answer. Its track record is not a claim it makes. It is a balance you can read back off
          Binance.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <button
            className="btn-primary ink-well roll-host"
            onClick={() => scrollToId('run')}
          >
            <Roll>Run it</Roll> <span aria-hidden>↓</span>
          </button>
          <a
            className="btn ink-well roll-host"
            href="https://github.com/martinvibes/skin-in-the-game"
            target="_blank"
            rel="noreferrer"
          >
            <Roll>View on GitHub</Roll> <span aria-hidden>→</span>
          </a>
        </div>
      </Reveal>

      <Reveal delay={140} className="mt-16 md:mt-20">
        <div id="run">
          <Console scan={data.scan} unclaimed={data.unclaimed} onStaked={onStaked} />
        </div>
      </Reveal>

      <Reveal delay={200}>
        <div className="mt-16 border-t pt-8 hair md:mt-20">
          <p className="mb-7 text-center text-[19px] text-muted md:text-[21px]">
            It has been wrong <span className="serif-accent text-ink">{rec.losses} times</span>. It
            paid for every one.
          </p>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-8 md:grid-cols-4">
            <HeroFigure
              k="realized p&l"
              v={usd(rec.realizedPnl, true)}
              tone={moneyTone(rec.realizedPnl)}
            />
            <HeroFigure k="put at risk" v={usd(rec.totalStaked)} />
            <HeroFigure k="brier score" v={rec.brier === null ? '—' : rec.brier.toFixed(3)} />
            <HeroFigure k="settled calls" v={String(rec.calls)} />
          </dl>
        </div>
      </Reveal>
    </Act>
  );
}

function HeroFigure({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div>
      <dt className="label mb-2.5">{k}</dt>
      <dd data-numeric className={`font-mono text-2xl md:text-[30px] ${tone ?? 'text-ink'}`}>
        {v}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

function RecordView({ data }: { data: Payload }) {
  const rec = data.record;
  const stats = [
    <Stat
      key="p"
      label="realized p&l"
      value={usd(rec.realizedPnl, true)}
      tone={moneyTone(rec.realizedPnl)}
      note={`on ${usd(rec.totalStaked)} staked across ${rec.calls} settled calls`}
    />,
    <Stat
      key="b"
      label="brier score"
      value={rec.brier === null ? '—' : rec.brier.toFixed(3)}
      note={`${brierVerdict(rec.brier, rec.scoredCalls)}. 0 is perfect; 0.25 is what you score by always saying “50%”.`}
    />,
    <Stat
      key="h"
      label="hit rate"
      value={pct(rec.hitRate)}
      note={`${rec.wins} won · ${rec.losses} lost`}
    />,
    <Stat
      key="r"
      label="return on stake"
      value={pct(rec.roi)}
      tone={moneyTone(rec.roi ?? 0)}
      note="realized p&l ÷ total staked"
    />,
  ];

  return (
    <>
      <Act theme="light" className="!pt-32 md:!pt-36">
        <Heading
          kicker="the record"
          title={
            <>
              Computed from settled positions. The agent{' '}
              <span className="serif-accent">does not get a vote</span>.
            </>
          }
          lede="Nothing below is authored by the agent. Every figure is a function of positions that have already resolved on Binance, read back through the Agentic Wallet rather than written by the thing being measured."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((node, i) => (
            <Reveal key={i} delay={i * 80} className="h-full">
              {node}
            </Reveal>
          ))}
        </div>
      </Act>

      <Act theme="dark">
        <Heading
          kicker="equity"
          title="Cumulative profit and loss, one step per settled call."
          lede="The line that cannot be argued with. Green dots are wins, red are losses; the dashed rule is break-even."
        />
        <Reveal>
          <div className="panel px-4 py-5 md:px-6">
            <EquityCurve points={rec.equityCurve} />
            <div className="mt-4 flex items-baseline justify-between border-t pt-4 hair">
              <span className="label">net after {rec.calls} calls</span>
              <span data-numeric className={`font-mono text-2xl ${moneyTone(rec.realizedPnl)}`}>
                {usd(rec.realizedPnl, true)}
              </span>
            </div>
          </div>
        </Reveal>
      </Act>

      <Act theme="light">
        <Heading
          kicker="calibration"
          title="Was it honest, not just lucky?"
          lede="Of the calls it made at 70% confidence, did about 70% come in? A forecaster sitting on the diagonal is telling the truth about its own uncertainty. This is the measure money alone cannot give you, and the reason every conviction is journalled before the outcome is known."
        />
        <Reveal>
          <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
            <div className="panel p-5">
              <CalibrationPlot bins={rec.calibration} />
            </div>
            <div className="panel flex flex-col p-5">
              {rec.calibration.length === 0 ? (
                <p className="text-sm text-faint">No journalled convictions yet.</p>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-4 font-mono text-2xs text-faint">
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-0.5 bg-money" /> claimed
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-4 bg-gain" /> delivered
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-4 bg-loss" /> fell short
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col justify-around gap-3.5">
                    {rec.calibration.map((b, i) => {
                      const short = b.observedRate < b.meanConviction;
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="w-16 shrink-0 font-mono text-2xs text-faint">
                            {Math.round(b.lower * 100)}–{Math.round(b.upper * 100)}%
                          </span>
                          <span className="w-10 shrink-0 font-mono text-2xs text-ghost">
                            n={b.n}
                          </span>
                          {/* Fill = what happened; the tick = what was claimed.
                              Drawing the claim as a marker rather than a second
                              bar keeps both readable when the observed rate is
                              0% (a bar alone renders nothing) and when it
                              exceeds the claim (a stacked bar would hide it). */}
                          <span className="relative h-2 flex-1 bg-raised">
                            <span
                              className={`absolute inset-y-0 left-0 ${
                                short ? 'bg-loss' : 'bg-gain'
                              }`}
                              style={{ width: `${b.observedRate * 100}%` }}
                            />
                            <span
                              className="absolute inset-y-[-3px] w-0.5 bg-money"
                              style={{ left: `${b.meanConviction * 100}%` }}
                            />
                          </span>
                          <span
                            className={`w-28 shrink-0 text-right font-mono text-2xs ${
                              short ? 'text-loss' : 'text-gain'
                            }`}
                          >
                            {pct(b.meanConviction, 0)} → {pct(b.observedRate, 0)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </Reveal>
      </Act>

      {data.journal.length > 0 && (
        <Act theme="dark">
          <Heading
            kicker="the slips"
            title="Every call, with the reasoning that produced it."
            lede="A claim, a price, and money committed against it, written down before the market resolved and not editable afterwards."
          />
          <div className="grid gap-3 md:grid-cols-2">
            {data.journal
              .slice(-4)
              .reverse()
              .map((entry, i) => (
                <Reveal key={entry.tokenId} delay={i * 80}>
                  <Slip
                    entry={entry}
                    settled={data.settled.find((s) => s.tokenId === entry.tokenId)}
                  />
                </Reveal>
              ))}
          </div>
        </Act>
      )}

      <Act theme="light">
        <Heading kicker="the ledger" title="All settled calls." lede="Newest first." />
        <Reveal>
          <SettledLedger rows={data.settled} />
        </Reveal>
      </Act>

      <Act theme="dark">
        <Heading kicker="live" title="Open now." lede="Money committed, outcome not yet known." />
        <Reveal>
          <div className="grid items-start gap-3 lg:grid-cols-[1fr_340px]">
            <OpenLedger rows={data.open} />
            <UnclaimedPanel rows={data.unclaimed} />
          </div>
        </Reveal>
      </Act>
    </>
  );
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

function MarketsView({ data }: { data: Payload }) {
  const { scan } = data;
  const cleared = scan.steps.filter((s) => s.verdict === 'staked').length;
  return (
    <>
      <Act theme="light" className="!pb-12 !pt-32 md:!pt-36">
        <Heading
          kicker="markets"
          title={
            <>
              {scan.steps.length} markets,{' '}
              <span className="serif-accent">{cleared} worth betting on</span>.
            </>
          }
          lede="The agent's full working on every market in the last scan: what it thinks, what the market thinks, and exactly why it did or did not act."
        />
        <Reveal>
          <div className="flex flex-wrap gap-2">
            <span className="chip">bankroll {usd(scan.bankroll)}</span>
            <span className="chip">run cap {usd(scan.runCap)}</span>
            <span className="chip">per call {usd(scan.perCallCap)}</span>
            <span className="chip">min order {usd(scan.minimumOrder)}</span>
            {scan.walletDailyRemaining !== null && (
              <span
                className="chip !text-accent"
                style={{ borderColor: 'rgb(var(--c-accent) / 0.4)' }}
              >
                wallet daily left {usd(scan.walletDailyRemaining)}
              </span>
            )}
          </div>
        </Reveal>
      </Act>

      <Act theme="dark">
        <div className="space-y-3">
          {scan.steps.map((s, i) => (
            <Reveal key={s.marketTopicId + i} delay={Math.min(i, 4) * 70}>
              <MarketRow step={s} />
            </Reveal>
          ))}
        </div>
      </Act>
    </>
  );
}

function MarketRow({ step }: { step: ScanStep }) {
  const ok = step.verdict === 'staked';
  const copy = VERDICT_COPY[step.verdict];
  return (
    <article
      className="panel trace p-5"
      style={ok ? { borderColor: 'rgb(var(--c-gain) / 0.35)' } : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-medium text-ink">{step.question}</h3>
          <p className="mt-1 font-mono text-2xs text-ghost">
            {step.symbol ?? 'unparsed'}
            {step.spot !== undefined && ` · spot $${step.spot.toLocaleString('en-US')}`}
            {step.annualVol !== undefined && ` · vol ${pct(step.annualVol, 0)}`}
            {step.samples !== undefined && ` · ${step.samples}×${step.interval}`}
          </p>
        </div>
        <span
          className={`chip shrink-0 ${ok ? '!text-gain' : ''}`}
          style={ok ? { borderColor: 'rgb(var(--c-gain) / 0.45)' } : undefined}
        >
          {ok ? `bet ${usd(step.sizing?.stakeUsdt ?? 0)}` : copy.label}
        </span>
      </div>

      {step.conviction !== undefined && step.marketPrice !== undefined && (
        <div className="mt-4 grid grid-cols-3 gap-3 border-y py-3.5 hair">
          <Cell k="agent says" v={pct(step.conviction, 1)} tone="text-ink" />
          <Cell k="market says" v={pct(step.marketPrice, 1)} />
          <Cell
            k="edge"
            v={`${(step.edge ?? 0) >= 0 ? '+' : '−'}${pct(Math.abs(step.edge ?? 0), 1)}`}
            tone={(step.edge ?? 0) >= 0 ? 'text-gain' : 'text-loss'}
          />
        </div>
      )}

      {/* The lede promises the full working, so a row that bet has to show how
          the stake was derived — not just that one happened. */}
      {ok && step.sizing && (
        <div className="grid grid-cols-2 gap-3 border-b py-3.5 hair sm:grid-cols-4">
          <Cell k="payout odds" v={`${step.sizing.odds.toFixed(2)}:1`} />
          <Cell k="full kelly" v={pct(step.sizing.kellyFull, 1)} />
          <Cell k="applied" v={pct(step.sizing.kellyApplied, 1)} />
          <Cell k="bound by" v={step.sizing.bindingConstraint} tone="text-money" />
        </div>
      )}

      <p className="mt-3.5 text-xs leading-relaxed text-faint">{step.thesis ?? copy.blurb}</p>
      {!ok && step.detail && (
        <p className="mt-2 font-mono text-2xs leading-relaxed text-ghost">{step.detail}</p>
      )}
    </article>
  );
}

function Cell({ k, v, tone = 'text-muted' }: { k: string; v: string; tone?: string }) {
  return (
    <div>
      <p className="label mb-1">{k}</p>
      <p data-numeric className={`font-mono text-sm ${tone}`}>
        {v}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

const STAGES: Array<[string, string]> = [
  ['observe', 'Realized volatility from Binance klines, fetched through the MCP Server.'],
  [
    'price',
    'A zero-drift lognormal returns a probability. No LLM guess, just a formula you can recheck.',
  ],
  ['compare', 'Edge is the gap against the market price. Under four points, no bet.'],
  ['size', 'Quarter-Kelly, capped per call, by the run budget, and by the wallet’s own daily limit.'],
  ['settle', 'The market resolves. Winnings are redeemed. The record updates itself.'],
];

/**
 * The three ways into the system, and the fact that only one of them moves
 * money. Stated rather than merely enacted: a reader who has just clicked
 * `stake` in the console above is owed a plain answer about what that button
 * did, and the asymmetry is the whole security argument in one row.
 */
const DOORS: Array<{ who: string; what: string; can: string; spends: boolean }> = [
  {
    who: 'this page',
    what: 'anyone on the internet',
    can: 'A static build reading one JSON file. No server behind it, no key, no wallet session. The console replays a run the CLI already made and recorded; its buttons move a state machine. Click every one of them and the balance does not change.',
    spends: false,
  },
  {
    who: 'the mcp server',
    what: 'any agent that connects',
    can: 'Eight tools: read the record, scan the book, ask for an opinion, get a costed proposal. There is deliberately no skin_stake. An agent can argue for a bet, size it, and hand back the exact command to run. It cannot place the order.',
    spends: false,
  },
  {
    who: 'the cli',
    what: 'one operator, at a terminal',
    can: 'Holds the signed-in Agentic Wallet session. Prints the receipt, then waits for the word stake to be typed. Re-prices the call against the real quote a moment before the order goes out, and abandons it if the edge that justified it has gone.',
    spends: true,
  },
];

/**
 * The two rails, and what each command on them actually does.
 *
 * A reader who wants to try this needs to know two things before typing
 * anything: which commands are safe on a laptop with no wallet, and which one
 * is the one that spends. Listing them together, with the money command marked
 * in the same accent the boundary section uses, answers both in one glance.
 */
const RAILS: Array<{
  rail: string;
  note: string;
  spends: boolean;
  rows: Array<[string, string]>;
}> = [
  {
    rail: 'demo',
    note: 'Fully offline, synthetic fixtures. No wallet, no install, nothing to lose. Every number on this page came from this rail.',
    spends: false,
    rows: [
      ['skin record --demo', 'The track record: Brier score, calibration, equity curve.'],
      ['skin scan --demo', 'Opinions and refusals, each one named. Commits nothing.'],
      ['skin stake --demo', 'Receipts and the typed confirmation, with nothing sent.'],
      ['skin claim --demo', 'Sweeps settled wins that were never redeemed.'],
    ],
  },
  {
    rail: 'live',
    note: 'Needs npm i -g @binance/agentic-wallet, then baw auth signin to pair the Agentic Wallet with the Binance app.',
    spends: true,
    rows: [
      ['skin doctor --live', 'Wallet, session, prediction quota and balance, before anything is risked.'],
      ['skin scan --live', 'The real book, re-priced against real quotes. Still commits nothing.'],
      ['skin stake --live', 'The only command that can spend. Prints receipts, waits for the word.'],
      ['skin claim --live', 'Redeems settled wins back to the wallet.'],
      ['skin mcp', 'Serves the read-only tools to an agent over stdio.'],
    ],
  },
];

const SURFACES: Array<[string, string]> = [
  [
    'agentic wallet',
    'The whole trading path: reading markets, placing orders, redeeming winnings, and reading back settled positions to build the record.',
  ],
  [
    'binance mcp server',
    'Klines for the volatility estimate, fetched under the user’s own authenticated Agent OS session and handed to the CLI with --mcp-data.',
  ],
  [
    'the journal',
    'Append-only, first-write-wins. It records what the agent claimed before the outcome was known. Editable convictions would make the Brier score worthless.',
  ],
];

function HowView({ data }: { data: Payload }) {
  return (
    <>
      <Act theme="light" className="!pt-32 md:!pt-36">
        <Heading
          kicker="mechanism"
          title={
            <>
              How a call becomes <span className="serif-accent">money</span>.
            </>
          }
          lede="Five stages, and a market can be refused at any of them. Most are, and that is the system working rather than a bug in it."
        />
        <ol className="grid gap-6 md:grid-cols-5">
          {STAGES.map(([name, blurb], i) => (
            <Reveal key={name} delay={i * 80}>
              <li className="border-t pt-5 hair">
                <p className="mb-3 font-display text-2xl text-accent">0{i + 1}</p>
                <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-ink">
                  {name}
                </p>
                <p className="text-[13px] leading-relaxed text-muted">{blurb}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </Act>

      <Act theme="dark">
        <Heading
          kicker="refusals"
          title="Why it says no."
          lede="Each refusal has a name, and the console prints it. A gate you cannot see fire is a gate you cannot trust."
        />
        <div className="grid gap-px overflow-hidden rounded-panel border hair md:grid-cols-2">
          {(Object.keys(VERDICT_COPY) as Array<keyof typeof VERDICT_COPY>)
            .filter((k) => k !== 'staked')
            .map((k, i) => (
              <Reveal key={k} delay={Math.min(i, 4) * 70}>
                <div className="trace relative h-full bg-panel p-5">
                  <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-teal">
                    {k}
                  </p>
                  <p className="text-sm leading-relaxed text-muted">{VERDICT_COPY[k].blurb}</p>
                </div>
              </Reveal>
            ))}
        </div>
      </Act>

      <Act theme="light">
        <Heading
          kicker="the constraint that matters"
          title={
            <>
              The spending limit is <span className="serif-accent">not a prompt</span>.
            </>
          }
          lede="It is the Agentic Wallet’s daily limit, set by the user in the Binance app. The agent can read it and cannot raise it, so “the agent went rogue and spent everything” is not a failure mode that depends on the agent’s cooperation."
        />
        <div className="grid gap-8 md:grid-cols-3">
          {SURFACES.map(([k, v], i) => (
            <Reveal key={k} delay={i * 80}>
              <div className="border-t pt-5 hair">
                <p className="label mb-3">{k}</p>
                <p className="text-sm leading-relaxed text-muted">{v}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Act>

      <Act theme="dark">
        <Heading
          kicker="the boundary"
          title={
            <>
              Three ways in. <span className="serif-accent">One</span> can spend.
            </>
          }
          lede="A public button that really placed orders would need a hot wallet with a stranger’s finger on it, which is the opposite of the argument this project is making. So the money has exactly one door, and there is a human hand on it."
        />
        <div className="grid gap-px overflow-hidden rounded-panel border hair md:grid-cols-3">
          {DOORS.map((d, i) => (
            <Reveal key={d.who} delay={i * 80}>
              <div className="flex h-full flex-col bg-panel p-5">
                <p className="label mb-1">{d.who}</p>
                <p className="mb-4 font-mono text-2xs text-ghost">{d.what}</p>
                <p className="flex-1 text-sm leading-relaxed text-muted">{d.can}</p>
                <p
                  className={`mt-5 inline-flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.14em] ${
                    d.spends ? 'text-accent' : 'text-teal'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${d.spends ? 'bg-accent' : 'bg-teal'}`}
                  />
                  {d.spends ? 'spends, once a human types the word' : 'cannot spend'}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Act>

      <Act theme="dark">
        <Heading
          kicker="run it yourself"
          title="Two rails. One of them spends."
          lede="The demo rail is fully offline: clone it and every number on this page is reproducible on your machine, with no wallet and nothing at risk. The live rail is the same code pointed at a real Agentic Wallet."
        />
        <Reveal>
          <div className="mb-6 panel scrollbar-thin overflow-x-auto p-5">
            <pre className="font-mono text-[13px] leading-relaxed text-muted">
              <span className="text-teal">$</span> git clone
              https://github.com/martinvibes/skin-in-the-game{'\n'}
              <span className="text-teal">$</span> npm install
            </pre>
          </div>
        </Reveal>
        <div className="grid gap-px overflow-hidden rounded-panel border hair md:grid-cols-2">
          {RAILS.map((r, i) => (
            <Reveal key={r.rail} delay={i * 90}>
              <div className="flex h-full flex-col bg-panel p-5">
                <p
                  className={`mb-2 inline-flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.14em] ${
                    r.spends ? 'text-accent' : 'text-teal'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${r.spends ? 'bg-accent' : 'bg-teal'}`}
                  />
                  {r.rail}
                </p>
                <p className="mb-5 text-sm leading-relaxed text-muted">{r.note}</p>
                <dl className="flex flex-col gap-4">
                  {r.rows.map(([cmd, what]) => {
                    const money = r.spends && cmd.startsWith('skin stake');
                    return (
                      <div key={cmd} className="border-t pt-3 hair">
                        <dt
                          className={`font-mono text-[13px] ${money ? 'text-accent' : 'text-ink'}`}
                        >
                          <span className="text-ghost">$ </span>
                          {cmd}
                        </dt>
                        <dd className="mt-1 text-sm leading-relaxed text-muted">{what}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mt-3 font-mono text-2xs text-ghost">
          data on this page generated {new Date(data.generatedAt).toLocaleString('en-GB')}
        </p>
      </Act>
    </>
  );
}

// ---------------------------------------------------------------------------

function Footer({ data }: { data: Payload }) {
  return (
    <Act theme="dark" className="!pb-16 !pt-10 md:!pb-20 md:!pt-12">
      <div className="flex flex-wrap items-end justify-between gap-8 border-t pt-10 hair">
        <div className="max-w-md">
          <div className="flex items-center gap-1.5">
            <Mark size={22} />
            <p className="font-display text-xl font-semibold tracking-[-0.045em] text-ink">Skin</p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-faint">
            Built on Binance Agentic Wallet and the Binance MCP Server for the Agent OS Mini
            Hackathon, Track A. MIT licensed. Not financial advice; the agent bets its own money
            and frequently loses it.
          </p>
        </div>
        <div className="text-right font-mono text-2xs text-ghost">
          <p>data: {data.mode}</p>
          <a
            className="mt-1 block text-faint hover:text-ink"
            href="https://github.com/martinvibes/skin-in-the-game"
            target="_blank"
            rel="noreferrer"
          >
            github.com/martinvibes/skin-in-the-game ↗
          </a>
        </div>
      </div>
    </Act>
  );
}

function Loading() {
  return (
    <div className="grid min-h-screen place-items-center">
      <p className="animate-pulse-soft font-mono text-2xs uppercase tracking-[0.2em] text-ghost">
        loading the record…
      </p>
    </div>
  );
}

/** Never renders fabricated numbers — an empty record is stated, not invented. */
function Fallback({ message }: { message: string }) {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="panel max-w-md p-6 text-center">
        <p className="label mb-3">no record available</p>
        <p className="text-sm leading-relaxed text-muted">
          The dashboard could not load <code className="text-teal">record.json</code>. Rather than
          show numbers it cannot source, it shows nothing.
        </p>
        <p className="mt-4 font-mono text-2xs text-ghost">{message}</p>
        <p className="mt-4 font-mono text-2xs text-faint">
          npm run skin -- export --demo --out web/public/record.json
        </p>
      </div>
    </div>
  );
}
