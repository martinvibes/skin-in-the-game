/**
 * Skin — an AI analyst that has to bet its own money on every call it makes.
 *
 * Four views rather than one scroll. A first visitor's question is "what does
 * this do?", and the honest answer is to let them run it, so `console` is the
 * default and the record sits behind it rather than in front.
 *
 * Everything rendered here comes from `public/record.json`, written by
 * `skin export`. The page computes nothing: if a number is on screen, the CLI
 * produced it.
 */

import { useEffect, useState } from 'react';
import { Console } from './components/Console';
import { Nav, type View } from './components/Nav';
import { CalibrationPlot, EquityCurve } from './components/Charts';
import {
  OpenLedger,
  Section,
  SettledLedger,
  Slip,
  Stat,
  UnclaimedPanel,
} from './components/Panels';
import {
  brierVerdict,
  moneyTone,
  pct,
  usd,
  VERDICT_COPY,
  type Payload,
  type ScanStep,
} from './lib/data';

export default function App() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('console');
  const [staked, setStaked] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}record.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  // Jump back to the top when the view changes; a reader who switches views
  // mid-scroll should land at the start of the new one, not its middle.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [view]);

  if (error) return <Fallback message={error} />;
  if (!data) return <Loading />;

  return (
    <div id="top" className="min-h-screen">
      <Nav view={view} onView={setView} mode={data.mode} />
      <main className="mx-auto max-w-6xl px-4 pb-24 md:px-8">
        {view === 'console' && (
          <ConsoleView data={data} staked={staked} onStaked={() => setStaked(true)} />
        )}
        {view === 'record' && <RecordView data={data} />}
        {view === 'markets' && <MarketsView data={data} />}
        {view === 'how it works' && <HowView data={data} />}
      </main>
      <Footer data={data} />
    </div>
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
      <section className="pt-12 md:pt-20">
        <p className="label mb-4">binance agent os · track a</p>
        <h1 className="max-w-4xl font-display text-4xl font-semibold leading-[1.04] tracking-tight text-cream md:text-[3.4rem] lg:text-6xl">
          An AI analyst that has to bet its own money on every call.
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted md:text-base">
          Every AI market agent tells you what it thinks. None of them ever pay for being wrong.
          This one has to put money on each call before it is allowed to make it — so its track
          record is a balance, not a claim.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <a className="btn-primary" href="#console">
            Try it below <span aria-hidden>↓</span>
          </a>
          <a
            className="btn-ghost"
            href="https://github.com/martinvibes/skin-in-the-game"
            target="_blank"
            rel="noreferrer"
          >
            Read the source <span aria-hidden>↗</span>
          </a>
        </div>

        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-2xs uppercase tracking-[0.14em] text-ghost">
          <span>agentic wallet</span>
          <span>·</span>
          <span>binance mcp server</span>
          <span>·</span>
          <span>kelly sizing</span>
          <span>·</span>
          <span>brier scored</span>
        </div>
      </section>

      <div id="console" className="pt-12 md:pt-16">
        <Console scan={data.scan} unclaimed={data.unclaimed} onStaked={onStaked} />
      </div>

      <Section
        eyebrow="the point"
        title="Three numbers, and only one of them can be faked."
        lede="Hit rate is easy to flatter — bet only on 95¢ near-certainties and it looks superb while you make nothing. Realized money and calibration cannot be gamed that way, so they come first."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="realized p&l"
            value={usd(rec.realizedPnl, true)}
            tone={moneyTone(rec.realizedPnl)}
            note={`on ${usd(rec.totalStaked)} staked across ${rec.calls} settled calls`}
          />
          <Stat
            label="brier score"
            value={rec.brier === null ? '—' : rec.brier.toFixed(3)}
            note={brierVerdict(rec.brier, rec.scoredCalls)}
          />
          <Stat
            label="hit rate"
            value={pct(rec.hitRate)}
            note={`${rec.wins} won · ${rec.losses} lost — listed last, on purpose`}
          />
        </div>
        {staked && (
          <p className="mt-4 font-mono text-2xs text-teal">
            ✓ your run is journalled — in a live session those two calls would now appear as open
            positions
          </p>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

function RecordView({ data }: { data: Payload }) {
  const rec = data.record;
  return (
    <>
      <Section
        eyebrow="the record"
        title="Computed from settled positions. The agent does not get a vote."
        lede="Nothing below is authored by the agent. Every figure is a function of positions that have already resolved on Binance — read back through the Agentic Wallet, not written by the thing being measured."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="realized p&l"
            value={usd(rec.realizedPnl, true)}
            tone={moneyTone(rec.realizedPnl)}
            note={`on ${usd(rec.totalStaked)} staked across ${rec.calls} settled calls`}
          />
          <Stat
            label="brier score"
            value={rec.brier === null ? '—' : rec.brier.toFixed(3)}
            note={`${brierVerdict(rec.brier, rec.scoredCalls)}. 0 is perfect; 0.25 is what you score by always saying “50%”.`}
          />
          <Stat label="hit rate" value={pct(rec.hitRate)} note={`${rec.wins} won · ${rec.losses} lost`} />
          <Stat
            label="return on stake"
            value={pct(rec.roi)}
            tone={moneyTone(rec.roi ?? 0)}
            note="realized p&l ÷ total staked"
          />
        </div>
      </Section>

      <Section
        eyebrow="equity"
        title="Cumulative profit and loss, one step per settled call."
        lede="The line that cannot be argued with. Green dots are wins, red are losses; the dashed rule is break-even."
      >
        <div className="panel px-4 py-5 md:px-6">
          <EquityCurve points={rec.equityCurve} />
          <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
            <span className="label">net after {rec.calls} calls</span>
            <span data-numeric className={`font-mono text-2xl ${moneyTone(rec.realizedPnl)}`}>
              {usd(rec.realizedPnl, true)}
            </span>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="calibration"
        title="Was it honest, not just lucky?"
        lede="Of the calls it made at 70% confidence, did about 70% come in? A forecaster sitting on the diagonal is telling the truth about its own uncertainty. This is the measure money alone cannot give you — and the reason every conviction is journalled before the outcome is known."
      >
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
                    <span className="h-2 w-4 rounded-sm bg-gain" /> delivered
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-4 rounded-sm bg-loss" /> fell short
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
                        <span className="w-10 shrink-0 font-mono text-2xs text-ghost">n={b.n}</span>
                        {/* Fill = what happened; the tick = what was claimed.
                            Drawing the claim as a marker rather than a second
                            bar keeps both readable when the observed rate is 0%
                            (a bar alone renders nothing) and when it exceeds the
                            claim (a stacked bar would hide it). */}
                        <span className="relative h-2 flex-1 rounded-full bg-raised">
                          <span
                            className={`absolute inset-y-0 left-0 rounded-full ${
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
      </Section>

      {data.journal.length > 0 && (
        <Section
          eyebrow="the slips"
          title="Every call, with the reasoning that produced it."
          lede="A claim, a price, and money committed against it — written down before the market resolved, and not editable afterwards."
        >
          <div className="grid gap-3 md:grid-cols-2">
            {data.journal
              .slice(-4)
              .reverse()
              .map((entry) => (
                <Slip
                  key={entry.tokenId}
                  entry={entry}
                  settled={data.settled.find((s) => s.tokenId === entry.tokenId)}
                />
              ))}
          </div>
        </Section>
      )}

      <Section eyebrow="the ledger" title="All settled calls." lede="Newest first.">
        <SettledLedger rows={data.settled} />
      </Section>

      <Section eyebrow="live" title="Open now." lede="Money committed, outcome not yet known.">
        <div className="grid items-start gap-3 lg:grid-cols-[1fr_340px]">
          <OpenLedger rows={data.open} />
          <UnclaimedPanel rows={data.unclaimed} />
        </div>
      </Section>
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
    <Section
      eyebrow="markets"
      title={`${scan.steps.length} markets, ${cleared} worth betting on.`}
      lede="The agent's full working on every market in the last scan — what it thinks, what the market thinks, and exactly why it did or did not act."
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <span className="chip">bankroll {usd(scan.bankroll)}</span>
        <span className="chip">run cap {usd(scan.runCap)}</span>
        <span className="chip">per call {usd(scan.perCallCap)}</span>
        <span className="chip">min order {usd(scan.minimumOrder)}</span>
        {scan.walletDailyRemaining !== null && (
          <span className="chip !border-money/35 !text-money">
            wallet daily left {usd(scan.walletDailyRemaining)}
          </span>
        )}
      </div>
      <div className="space-y-3">
        {scan.steps.map((s, i) => (
          <MarketRow key={s.marketTopicId + i} step={s} />
        ))}
      </div>
    </Section>
  );
}

function MarketRow({ step }: { step: ScanStep }) {
  const ok = step.verdict === 'staked';
  const copy = VERDICT_COPY[step.verdict];
  return (
    <article className={`panel p-5 ${ok ? 'border-gain/25' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base font-medium text-cream">{step.question}</h3>
          <p className="mt-1 font-mono text-2xs text-ghost">
            {step.symbol ?? 'unparsed'}
            {step.spot !== undefined && ` · spot $${step.spot.toLocaleString('en-US')}`}
            {step.annualVol !== undefined && ` · vol ${pct(step.annualVol, 0)}`}
            {step.samples !== undefined && ` · ${step.samples}×${step.interval}`}
          </p>
        </div>
        <span className={`chip shrink-0 ${ok ? '!border-gain/40 !text-gain' : ''}`}>
          {ok ? `bet ${usd(step.sizing?.stakeUsdt ?? 0)}` : copy.label}
        </span>
      </div>

      {step.conviction !== undefined && step.marketPrice !== undefined && (
        <div className="mt-4 grid grid-cols-3 gap-3 border-y border-line py-3.5">
          <Cell k="agent says" v={pct(step.conviction, 1)} tone="text-cream" />
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
        <div className="grid grid-cols-2 gap-3 border-b border-line py-3.5 sm:grid-cols-4">
          <Cell k="payout odds" v={`${step.sizing.odds.toFixed(2)}:1`} />
          <Cell k="full kelly" v={pct(step.sizing.kellyFull, 1)} />
          <Cell k="applied" v={pct(step.sizing.kellyApplied, 1)} />
          <Cell k="bound by" v={step.sizing.bindingConstraint} tone="text-money" />
        </div>
      )}

      <p className="mt-3.5 text-xs leading-relaxed text-faint">
        {step.thesis ?? copy.blurb}
      </p>
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
  ['price', 'A zero-drift lognormal returns a probability. No LLM guess — a formula you can recheck.'],
  ['compare', 'Edge is the gap against the market price. Under four points, no bet.'],
  ['size', 'Quarter-Kelly, capped per call, by the run budget, and by the wallet’s own daily limit.'],
  ['settle', 'The market resolves. Winnings are redeemed. The record updates itself.'],
];

function HowView({ data }: { data: Payload }) {
  return (
    <>
      <Section
        eyebrow="mechanism"
        title="How a call becomes money."
        lede="Five stages, and a market can be refused at any of them. Most are — that is the system working, not a bug in it."
      >
        <ol className="grid gap-3 md:grid-cols-5">
          {STAGES.map(([name, blurb], i) => (
            <li key={name} className="panel p-4">
              <p className="mb-2 font-mono text-2xs text-money">0{i + 1}</p>
              <p className="mb-1.5 font-display text-sm font-semibold uppercase tracking-wide text-cream">
                {name}
              </p>
              <p className="text-xs leading-relaxed text-faint">{blurb}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        eyebrow="refusals"
        title="Why it says no."
        lede="Each refusal has a name, and the console prints it. A gate you cannot see fire is a gate you cannot trust."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {(Object.keys(VERDICT_COPY) as Array<keyof typeof VERDICT_COPY>)
            .filter((k) => k !== 'staked')
            .map((k) => (
              <div key={k} className="panel p-4">
                <p className="mb-1.5 font-mono text-2xs uppercase tracking-[0.14em] text-teal">
                  {k}
                </p>
                <p className="text-sm leading-relaxed text-muted">{VERDICT_COPY[k].blurb}</p>
              </div>
            ))}
        </div>
      </Section>

      <Section
        eyebrow="the constraint that matters"
        title="The spending limit is not a prompt."
        lede="It is the Agentic Wallet’s daily limit, set by the user in the Binance app. The agent can read it and cannot raise it — so “the agent went rogue and spent everything” is not a failure mode that depends on the agent’s cooperation."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="panel p-5">
            <p className="label mb-2">agentic wallet</p>
            <p className="text-sm leading-relaxed text-muted">
              The whole trading path — reading markets, placing orders, redeeming winnings, and
              reading back settled positions to build the record.
            </p>
          </div>
          <div className="panel p-5">
            <p className="label mb-2">binance mcp server</p>
            <p className="text-sm leading-relaxed text-muted">
              Klines for the volatility estimate, fetched under the user’s own authenticated Agent
              OS session and handed to the CLI with <code className="text-teal">--mcp-data</code>.
            </p>
          </div>
          <div className="panel p-5">
            <p className="label mb-2">the journal</p>
            <p className="text-sm leading-relaxed text-muted">
              Append-only, first-write-wins. It records what the agent claimed{' '}
              <em>before</em> the outcome was known. Editable convictions would make the Brier
              score worthless.
            </p>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="run it yourself"
        title="Four commands, no wallet needed."
        lede="The demo path is fully offline. Clone it and the numbers on this page are reproducible on your machine."
      >
        <div className="panel scrollbar-thin overflow-x-auto p-5">
          <pre className="font-mono text-[13px] leading-relaxed text-muted">
            <span className="text-teal">$</span> git clone https://github.com/martinvibes/skin-in-the-game{'\n'}
            <span className="text-teal">$</span> npm install{'\n'}
            {'\n'}
            <span className="text-teal">$</span> npm run skin -- record --demo{'  '}
            <span className="text-ghost"># the track record</span>{'\n'}
            <span className="text-teal">$</span> npm run skin -- scan --demo{'    '}
            <span className="text-ghost"># opinions, no money</span>{'\n'}
            <span className="text-teal">$</span> npm run skin -- stake --demo{'   '}
            <span className="text-ghost"># receipts + typed confirmation</span>{'\n'}
            <span className="text-teal">$</span> npm run skin -- claim --demo{'   '}
            <span className="text-ghost"># sweep unclaimed winnings</span>
          </pre>
        </div>
        <p className="mt-3 font-mono text-2xs text-ghost">
          data on this page generated {new Date(data.generatedAt).toLocaleString('en-GB')}
        </p>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

function Footer({ data }: { data: Payload }) {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-6 px-4 py-10 md:px-8">
        <div className="max-w-md">
          <p className="font-display text-lg font-semibold text-cream">Skin</p>
          <p className="mt-1.5 text-xs leading-relaxed text-faint">
            Built on Binance Agentic Wallet and the Binance MCP Server for the Agent OS Mini
            Hackathon, Track A. MIT licensed. Not financial advice; the agent bets its own money
            and frequently loses it.
          </p>
        </div>
        <div className="text-right font-mono text-2xs text-ghost">
          <p>data: {data.mode}</p>
          <a
            className="mt-1 block text-faint hover:text-cream"
            href="https://github.com/martinvibes/skin-in-the-game"
            target="_blank"
            rel="noreferrer"
          >
            github.com/martinvibes/skin-in-the-game ↗
          </a>
        </div>
      </div>
    </footer>
  );
}

function Loading() {
  return (
    <div className="grid min-h-screen place-items-center">
      <p className="font-mono text-2xs uppercase tracking-[0.2em] text-ghost animate-pulse-soft">
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
