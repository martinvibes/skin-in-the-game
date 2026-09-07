/**
 * The dashboard.
 *
 * Single page, read top to bottom, ordered by how hard each claim is to fake:
 * the thesis, then the money, then the honesty score, then the raw ledger. The
 * unfakeable numbers come first and the prose comes last, which is the opposite
 * of how a pitch deck is built and the right way round for an accountability
 * instrument.
 */

import { useEffect, useState } from 'react';
import { EquityCurve, CalibrationPlot } from './components/Charts';
import {
  OpenLedger,
  Section,
  SettledLedger,
  Slip,
  Stat,
  UnclaimedPanel,
} from './components/Panels';
import { brierVerdict, moneyTone, pct, usd, type Payload } from './lib/data';

const REPO = 'https://github.com/martinvibes/skin-in-the-game';

export default function App() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The dashboard reads whatever `skin export` last wrote. It is a viewer for
    // a file the CLI produces, not a second source of truth — there is no path
    // by which this page can compute a number the CLI would not.
    fetch(`${import.meta.env.BASE_URL}record.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Payload) => setData(d))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <Fallback message={error} />;
  if (!data) return <Fallback message={null} />;

  const { record: rec, settled, open, unclaimed, journal, mode } = data;
  const lastEquity = rec.equityCurve.at(-1)?.cumulativePnl ?? 0;

  return (
    <div className="min-h-screen bg-ground bg-ruled">
      <Header mode={mode} />

      <main className="mx-auto max-w-page px-6 md:px-10">
        {/* ---------------------------------------------------------------- */}
        <section className="py-16 md:py-24">
          <p className="label mb-6">Binance Agent OS · Track A</p>
          <h1 className="max-w-3xl font-display text-[2.75rem] leading-[1.05] text-ink md:text-6xl">
            An AI analyst that has to bet
            <br />
            <span className="italic text-amber">its own money</span> on every call.
          </h1>
          <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-ink-muted">
            Every AI market agent tells you what it thinks. None of them ever pay for being
            wrong. This one has to put money on each call before it is allowed to make it —
            so its track record is a balance, not a claim.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <a
              href={REPO}
              className="border border-ink-ghost px-5 py-2.5 font-mono text-xs tracking-wider text-ink transition-colors hover:border-amber hover:text-amber"
            >
              SOURCE ↗
            </a>
            <a
              href="#record"
              className="border border-rule px-5 py-2.5 font-mono text-xs tracking-wider text-ink-muted transition-colors hover:border-ink-ghost hover:text-ink"
            >
              THE RECORD ↓
            </a>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="record"
          eyebrow="the record"
          title="Computed from settled positions. The agent does not get a vote."
          lede={
            <>
              Nothing below is authored by the agent. Every figure is a function of positions
              that have already resolved on Binance — read back through the Agentic Wallet, not
              written by the thing being measured.
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="realized p&l"
              value={usd(rec.realizedPnl, true)}
              tone={moneyTone(rec.realizedPnl)}
              note={`on ${usd(rec.totalStaked)} staked across ${rec.calls} settled calls`}
              large
            />
            <Stat
              label="brier score"
              value={rec.brier === null ? '—' : rec.brier.toFixed(3)}
              note={
                <>
                  {brierVerdict(rec.brier, rec.scoredCalls)}. 0 is perfect; 0.25 is what you
                  score by always saying &ldquo;50%&rdquo;.
                </>
              }
              large
            />
            <Stat
              label="hit rate"
              value={pct(rec.hitRate)}
              note={`${rec.wins} won · ${rec.losses} lost`}
            />
            <Stat
              label="return on stake"
              value={pct(rec.roi)}
              tone={rec.roi === null ? 'text-ink' : moneyTone(rec.roi)}
              note="realized p&l ÷ total staked"
            />
          </div>

          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ink-faint">
            Hit rate is listed third on purpose. A forecaster who only bets on near-certainties
            posts a beautiful hit rate and makes no money; one who finds genuine 40% shots priced
            at 20% looks wrong most of the time and gets rich. Money and calibration are the
            numbers that cannot be gamed by picking easy questions.
          </p>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          eyebrow="equity"
          title="Cumulative profit and loss, one step per settled call."
          lede="The line that cannot be argued with. Green dots are wins, red are losses; the dashed rule is break-even."
        >
          <div className="ledger px-4 py-6 md:px-6">
            <EquityCurve points={rec.equityCurve} />
            <div className="mt-4 flex items-baseline justify-between border-t border-rule pt-4">
              <span className="label">net after {rec.calls} calls</span>
              <span data-numeric className={`font-mono text-xl ${moneyTone(lastEquity)}`}>
                {usd(lastEquity, true)}
              </span>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          eyebrow="calibration"
          title="Was it honest, not just lucky?"
          lede={
            <>
              Of the calls it made at 70% confidence, did about 70% come in? A forecaster sitting
              on the diagonal is telling the truth about its own uncertainty. This is the measure
              money alone cannot give you — and the reason every conviction is journalled
              <em> before</em> the outcome is known.
            </>
          }
        >
          <div className="grid gap-6 md:grid-cols-[320px,1fr] md:items-start">
            <div className="ledger px-4 py-6">
              <CalibrationPlot bins={rec.calibration} />
            </div>
            <div className="ledger divide-y divide-rule">
              <p className="flex items-center gap-4 px-5 py-3 font-mono text-2xs text-ink-ghost">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-px bg-amber" /> claimed
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-3 bg-jade" /> delivered
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-3 bg-vermilion" /> fell short
                </span>
              </p>
              {rec.calibration.length === 0 ? (
                <p className="px-5 py-8 text-sm text-ink-faint">
                  No journalled convictions yet.
                </p>
              ) : (
                rec.calibration.map((b, i) => {
                  const gap = b.observedRate - b.meanConviction;
                  return (
                    <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                      <span data-numeric className="w-20 shrink-0 font-mono text-xs text-ink-faint">
                        {(b.lower * 100).toFixed(0)}–{(b.upper * 100).toFixed(0)}%
                      </span>
                      <span className="w-10 shrink-0 font-mono text-2xs text-ink-ghost">
                        n={b.n}
                      </span>
                      {/*
                        Fill = what actually happened; the amber tick = what was
                        claimed. Drawing the claim as a marker rather than a
                        second bar keeps both readable in the two cases that
                        matter most: an observed rate of 0% (a bar alone would
                        render nothing at all) and an observed rate above the
                        claim (a stacked bar would hide the claim underneath).
                        The gap between fill and tick is the miss.
                      */}
                      <div className="relative h-2 flex-1 bg-ground-sunken">
                        <div
                          className={`absolute inset-y-0 left-0 ${gap < 0 ? 'bg-vermilion' : 'bg-jade'}`}
                          style={{ width: `${b.observedRate * 100}%`, opacity: 0.9 }}
                        />
                        <span
                          className="absolute -top-1 -bottom-1 w-px bg-amber"
                          style={{ left: `${b.meanConviction * 100}%` }}
                          title={`claimed ${(b.meanConviction * 100).toFixed(0)}%`}
                        />
                      </div>
                      <span
                        data-numeric
                        className={`w-24 shrink-0 text-right font-mono text-xs ${
                          gap < 0 ? 'text-vermilion' : 'text-jade'
                        }`}
                      >
                        {pct(b.meanConviction, 0)} → {pct(b.observedRate, 0)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        {journal.length > 0 && (
          <Section
            eyebrow="the slips"
            title="Every call, with the reasoning that produced it."
            lede="A claim, a price, and money committed against it — written down before the market resolved, and not editable afterwards."
          >
            <div className="grid gap-4 md:grid-cols-2">
              {journal
                .slice(-4)
                .reverse()
                .map((entry) => (
                  <Slip
                    key={entry.tokenId}
                    entry={entry}
                    settled={settled.find((s) => s.tokenId === entry.tokenId)}
                  />
                ))}
            </div>
          </Section>
        )}

        {/* ---------------------------------------------------------------- */}
        <Section
          eyebrow="the ledger"
          title="All settled calls."
          lede="Newest first. What it said, what it staked, what came back."
        >
          <SettledLedger rows={settled} />
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          eyebrow="live"
          title="Open now."
          lede="Money committed, outcome not yet known."
        >
          <div className="grid gap-4 lg:grid-cols-[1fr,340px] lg:items-start">
            <OpenLedger rows={open} />
            <UnclaimedPanel rows={unclaimed} />
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          eyebrow="mechanism"
          title="How a call becomes money."
          lede="Five stages, and a market can be refused at any of them. Most are — that is the system working, not a bug in it."
        >
          <ol className="grid gap-3 md:grid-cols-5">
            {[
              ['observe', 'Realized volatility from Binance klines, via the MCP Server.'],
              ['price', 'A zero-drift lognormal model returns a probability — not a vibe.'],
              ['compare', 'Edge is the gap against the market price. No gap, no bet.'],
              ['size', 'Quarter-Kelly, capped per call and by the wallet’s own daily limit.'],
              ['settle', 'The market resolves. Winnings are redeemed. The record updates itself.'],
            ].map(([title, body], i) => (
              <li key={title} className="ledger px-4 py-5">
                <span className="font-mono text-2xs text-amber-dim">0{i + 1}</span>
                <h3 className="mb-2 mt-2 font-mono text-xs uppercase tracking-widest text-ink">
                  {title}
                </h3>
                <p className="text-xs leading-relaxed text-ink-faint">{body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-4 ledger px-5 py-5">
            <p className="label mb-3">the constraint that matters</p>
            <p className="max-w-3xl text-sm leading-relaxed text-ink-muted">
              The spending ceiling is not a prompt asking the model to behave. It is the Agentic
              Wallet&rsquo;s daily limit, set by the user in the Binance app. The agent can read
              it and cannot raise it — so &ldquo;the agent went rogue and spent everything&rdquo;
              is not a failure mode that depends on the agent&rsquo;s cooperation.
            </p>
          </div>
        </Section>
      </main>

      <Footer generatedAt={data.generatedAt} mode={mode} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header({ mode }: { mode: 'live' | 'demo' }) {
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-ground/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-page items-center justify-between px-6 py-4 md:px-10">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-lg text-ink">Skin in the Game</span>
          <span className="hidden font-mono text-2xs tracking-widest text-ink-ghost sm:inline">
            BINANCE AGENT OS
          </span>
        </div>
        <ModeBadge mode={mode} />
      </div>
    </header>
  );
}

/**
 * Mode badge.
 *
 * Persistent and unmissable. Demo data must never be mistakable for live data,
 * so this sits in the header on every screen rather than in a footnote.
 */
function ModeBadge({ mode }: { mode: 'live' | 'demo' }) {
  const live = mode === 'live';
  return (
    <span
      className={`flex items-center gap-2 border px-3 py-1.5 font-mono text-2xs tracking-widest ${
        live ? 'border-jade/40 text-jade' : 'border-amber-dim text-amber'
      }`}
      title={
        live
          ? 'Live: real wallet, real money.'
          : 'Demo: synthetic fixtures. No wallet connected, no money moved.'
      }
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${live ? 'bg-jade' : 'bg-amber'}`}
      />
      {live ? 'LIVE' : 'DEMO DATA'}
    </span>
  );
}

function Footer({ generatedAt, mode }: { generatedAt: string; mode: 'live' | 'demo' }) {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto max-w-page px-6 py-10 md:px-10">
        <div className="hairline mb-8" />
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-md">
            <p className="font-display text-xl text-ink">Skin in the Game</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-faint">
              Built on Binance Agentic Wallet and the Binance MCP Server for the Agent OS Mini
              Hackathon, Track A. MIT licensed. Not financial advice; the agent bets its own
              money and frequently loses it.
            </p>
          </div>
          <div className="font-mono text-2xs text-ink-ghost">
            <p>
              data: {mode} · generated{' '}
              {new Date(generatedAt).toLocaleString('en-GB', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <a href={REPO} className="mt-1 inline-block text-ink-faint hover:text-amber">
              github.com/martinvibes/skin-in-the-game ↗
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/** Loading and error state. Never renders fabricated numbers. */
function Fallback({ message }: { message: string | null }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ground px-6">
      <div className="max-w-md text-center">
        <p className="font-display text-2xl text-ink">Skin in the Game</p>
        {message === null ? (
          <p className="mt-3 font-mono text-xs tracking-widest text-ink-faint">LOADING RECORD…</p>
        ) : (
          <>
            <p className="mt-3 text-sm text-vermilion">Could not load the record: {message}</p>
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              The dashboard reads <code className="font-mono text-ink-muted">public/record.json</code>,
              which is produced by <code className="font-mono text-ink-muted">skin export --out</code>.
              Generate it and reload — the page will not invent numbers to fill the gap.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
