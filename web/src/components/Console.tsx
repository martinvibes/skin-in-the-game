/**
 * The console: the agent's whole loop, driven by the reader.
 *
 * This exists because a static report cannot answer the only question a first
 * visitor actually has — *what does this thing do?* So instead of describing
 * the loop, the page runs it: scan, then stake behind a typed confirmation,
 * then claim. Three phases, in the order the CLI enforces them.
 *
 * Every number rendered here comes from `scan` in `record.json`, which the CLI
 * produced by calling the same `formOpinion` and `sizeStake` that a real run
 * calls. Nothing is recomputed in the browser, so the console cannot quietly
 * disagree with the tool it is demonstrating.
 */

import { Field } from './Field';
import { Roll } from './Nav';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  pct,
  usd,
  VERDICT_COPY,
  type ScanStep,
  type ScanTrace,
  type UnclaimedWin,
} from '../lib/data';

type Phase = 'idle' | 'scanning' | 'scanned' | 'staking' | 'staked' | 'claimed';

const STEP_MS = 620;

export function Console({
  scan,
  unclaimed,
  onStaked,
}: {
  scan: ScanTrace;
  unclaimed: UnclaimedWin[];
  onStaked?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [shown, setShown] = useState(0);
  const [typed, setTyped] = useState('');
  const [rejected, setRejected] = useState(false);
  const timers = useRef<number[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const cleared = scan.steps.filter((s) => s.verdict === 'staked');
  const unclaimedTotal = unclaimed.reduce((a, u) => a + u.payout, 0);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Keep the newest output in view, on every phase and not just while lines
  // are streaming. A terminal that leaves you staring at the top of the buffer
  // after you pressed the button has hidden the answer you asked for — the
  // slips and the claim both render below the fold of this pane.
  useEffect(() => {
    if (phase === 'idle' || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [shown, phase]);

  const runScan = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setShown(0);
    setTyped('');
    setRejected(false);
    setPhase('scanning');

    // Reveal one market at a time. The delay is the point: the sequence is what
    // makes "most markets are refused" legible as behaviour rather than a
    // static list the reader skims past.
    scan.steps.forEach((_, i) => {
      timers.current.push(
        window.setTimeout(() => setShown(i + 1), STEP_MS * (i + 1)),
      );
    });
    timers.current.push(
      window.setTimeout(() => setPhase('scanned'), STEP_MS * (scan.steps.length + 1)),
    );
  }, [scan.steps]);

  const skip = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setShown(scan.steps.length);
    setPhase('scanned');
  }, [scan.steps.length]);

  function submitConfirm(e: React.FormEvent) {
    e.preventDefault();
    // The CLI requires the whole word; "y" is not accepted. The demo enforces
    // the same rule, because the gate is a feature and softening it here would
    // misrepresent the tool.
    if (typed.trim().toLowerCase() !== 'stake') {
      setRejected(true);
      return;
    }
    setRejected(false);
    setPhase('staked');
    onStaked?.();
  }

  return (
    <div className="terminal overflow-hidden">
      <Header phase={phase} />

      <div
        ref={logRef}
        className="scrollbar-thin max-h-[30rem] min-h-[19rem] overflow-y-auto px-4 py-4 md:px-6"
      >
        {phase === 'idle' ? (
          <Idle scan={scan} onRun={runScan} />
        ) : (
          <div className="space-y-1.5">
            <Line prompt>skin scan --limit {scan.steps.length}</Line>
            <Line muted>
              reading klines via <Rail rail={scan.rail} /> · bankroll {usd(scan.bankroll)} · run cap{' '}
              {usd(scan.runCap)} · {kellyLabel(scan.kellyFraction)}
            </Line>

            {scan.steps.slice(0, shown).map((s, i) => (
              <StepRow key={s.marketTopicId + i} step={s} />
            ))}

            {phase === 'scanning' && <Cursor />}

            {(phase === 'scanned' || phase === 'staking' || phase === 'staked' || phase === 'claimed') && (
              <Summary scan={scan} cleared={cleared.length} />
            )}

            {(phase === 'staking' || phase === 'staked' || phase === 'claimed') && (
              <>
                <div className="h-3" />
                <Line prompt>skin stake --budget {scan.runCap} --per-call {scan.perCallCap}</Line>
                <div className="grid gap-3 py-2 md:grid-cols-2">
                  {cleared.map((s) => (
                    <Receipt key={s.tokenId} step={s} settled={phase !== 'staking'} />
                  ))}
                </div>
              </>
            )}

            {phase === 'staked' && <Placed cleared={cleared} />}
            {phase === 'claimed' && (
              <>
                <Placed cleared={cleared} />
                <div className="h-3" />
                <Line prompt>skin claim</Line>
                <Line tone="gain">
                  ✓ Redeemed {usd(unclaimedTotal)} across {unclaimed.length} settled win
                  {unclaimed.length === 1 ? '' : 's'}
                </Line>
                <Line muted>
                  Prediction markets do not pay out automatically. An agent that never claims
                  starves no matter how good its calls are.
                </Line>
              </>
            )}
          </div>
        )}
      </div>

      <Controls
        phase={phase}
        cleared={cleared.length}
        totalStaked={scan.totalStaked}
        unclaimedTotal={unclaimedTotal}
        hasUnclaimed={unclaimed.length > 0}
        typed={typed}
        rejected={rejected}
        onTyped={(v) => {
          setTyped(v);
          setRejected(false);
        }}
        onSkip={skip}
        onOpenStake={() => setPhase('staking')}
        onConfirm={submitConfirm}
        onClaim={() => setPhase('claimed')}
        onReset={() => {
          timers.current.forEach(clearTimeout);
          setPhase('idle');
          setShown(0);
          setTyped('');
          setRejected(false);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header({ phase }: { phase: Phase }) {
  const live = phase === 'scanning';
  return (
    <div className="flex items-center gap-3 border-b px-4 py-3 hair md:px-6">
      <div className="flex gap-1.5">
        <Dot className="bg-ghost" />
        <Dot className="bg-ghost" />
        <Dot className={live ? 'bg-teal animate-pulse-soft' : 'bg-ghost'} />
      </div>
      <span className="whitespace-nowrap font-mono text-2xs tracking-[0.14em] text-faint">
        skin · {phase === 'idle' ? 'ready' : phase === 'scanning' ? 'running' : 'session'}
      </span>
      {/* The wallet half of this label is the first thing to go on a phone:
          the point is "demo", and "no wallet" is the reassurance, not the fact. */}
      <span className="ml-auto chip whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-money" />
        demo data<span className="hidden sm:inline"> · no wallet</span>
      </span>
    </div>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`h-2.5 w-2.5 rounded-full ${className}`} />;
}

function Idle({ scan, onRun }: { scan: ScanTrace; onRun: () => void }) {
  return (
    <div className="relative flex h-full min-h-[24rem] flex-col items-center justify-center overflow-hidden px-4 text-center">
      {/* The contour field only runs while the console is idle. Once output is
          streaming, a moving background competes with the thing you came to
          read, so it is unmounted rather than dimmed. */}
      <Field />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(58% 58% at 50% 48%, rgb(var(--c-panel) / 0.55) 0%, rgb(var(--c-panel) / 0.08) 55%, rgb(var(--c-panel) / 0.85) 100%)',
        }}
      />
      <p className="label relative mb-3">the loop, end to end</p>
      <h3 className="relative mb-3 font-display text-[26px] font-medium tracking-[-0.03em] text-cream md:text-[32px]">
        Watch it form an opinion and pay for it.
      </h3>
      <p className="relative mb-7 max-w-md text-sm leading-relaxed text-muted">
        {scan.steps.length} live markets. The agent prices each one, compares itself to the
        market, and either sizes a stake or says why it will not. Then you confirm the money.
      </p>
      <button className="btn-primary ink-well roll-host relative" onClick={onRun}>
        <Roll>Run a scan</Roll>
        <span aria-hidden>→</span>
      </button>
      <p className="relative mt-5 font-mono text-2xs text-ghost">
        nothing here spends real money
      </p>
    </div>
  );
}

function Line({
  children,
  prompt,
  muted,
  tone,
}: {
  children: React.ReactNode;
  prompt?: boolean;
  muted?: boolean;
  tone?: 'gain' | 'loss' | 'money';
}) {
  const color = tone
    ? { gain: 'text-gain', loss: 'text-loss', money: 'text-money' }[tone]
    : muted
      ? 'text-faint'
      : 'text-cream';
  return (
    <p className={`animate-line-in font-mono text-[13px] leading-relaxed ${color}`}>
      {prompt && <span className="mr-2 select-none text-teal">$</span>}
      {children}
    </p>
  );
}

function Cursor() {
  return (
    <p className="font-mono text-[13px] text-teal">
      <span className="animate-pulse-soft">▊</span>
    </p>
  );
}

function Rail({ rail }: { rail: string }) {
  const label = rail === 'mcp' ? 'Binance MCP Server' : rail === 'rest' ? 'Binance REST' : 'local fixtures';
  return <span className="text-teal">{label}</span>;
}

/** One market's result: the reasoning, then the decision. */
function StepRow({ step }: { step: ScanStep }) {
  const ok = step.verdict === 'staked';
  const copy = VERDICT_COPY[step.verdict];

  return (
    <div className="animate-line-in py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={`font-mono text-2xs font-bold uppercase tracking-[0.12em] ${
            ok ? 'text-gain' : 'text-faint'
          }`}
        >
          {ok ? '✓ bet' : '✗ pass'}
        </span>
        <span className="font-mono text-[13px] text-cream">{step.question}</span>
      </div>

      <div className="mt-1 pl-[3.4rem] md:pl-16">
        {step.conviction !== undefined && step.marketPrice !== undefined ? (
          <p className="font-mono text-2xs text-faint">
            model <span className="text-cream">{pct(step.conviction, 1)}</span> · market{' '}
            <span className="text-cream">{pct(step.marketPrice, 1)}</span> · edge{' '}
            <span className={(step.edge ?? 0) >= 0 ? 'text-gain' : 'text-loss'}>
              {(step.edge ?? 0) >= 0 ? '+' : '−'}
              {pct(Math.abs(step.edge ?? 0), 1)}
            </span>
            {step.annualVol !== undefined && (
              <>
                {' '}
                · vol <span className="text-cream">{pct(step.annualVol, 0)}</span> from{' '}
                {step.samples}×{step.interval}
              </>
            )}
          </p>
        ) : null}

        <p className="mt-1 font-mono text-2xs">
          <span className={ok ? 'text-money' : 'text-faint'}>
            {ok && step.sizing
              ? `stake ${usd(step.sizing.stakeUsdt)} · ${kellyLabel(
                  step.sizing.kellyApplied / Math.max(step.sizing.kellyFull, 1e-9),
                )} · bound by ${step.sizing.bindingConstraint}`
              : `${copy.label} · ${copy.blurb}`}
          </span>
        </p>
      </div>
    </div>
  );
}

function Summary({ scan, cleared }: { scan: ScanTrace; cleared: number }) {
  const passed = scan.steps.length - cleared;
  return (
    <div className="mt-3 rounded-card border bg-raised px-4 py-3 hair">
      <p className="font-mono text-[13px] text-cream">
        {cleared} of {scan.steps.length} markets cleared ·{' '}
        <span className="text-money">{usd(scan.totalStaked)}</span> would be committed
      </p>
      <p className="mt-1 font-mono text-2xs leading-relaxed text-faint">
        {passed} refused.{' '}
        {cleared === 0
          ? 'An analyst with nothing to say, saying nothing, is the system working, not a failure.'
          : 'A scan where nothing clears is a successful scan. Refusals are the product, not the leftovers.'}
      </p>
    </div>
  );
}

/** The betting slip, with the whole derivation on it. */
function Receipt({ step, settled }: { step: ScanStep; settled: boolean }) {
  const z = step.sizing;
  if (!z) return null;
  return (
    <div className="animate-rise rounded-card border bg-raised p-4 hair">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="font-display text-sm leading-snug text-cream">{step.question}</p>
        <span
          className={`chip shrink-0 ${
            settled ? '!border-gain/40 !text-gain' : '!border-money/40 !text-money'
          }`}
        >
          {settled ? 'submitted' : 'pending'}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 border-y py-3 font-mono hair text-2xs">
        <Row k="side" v={step.side ?? '—'} />
        <Row k="agent says" v={pct(z.p, 1)} tone="text-cream" />
        <Row k="market says" v={pct(z.price, 1)} />
        <Row k="edge" v={`+${pct(z.edge, 1)}`} tone="text-gain" />
        <Row k="payout odds" v={`${z.odds.toFixed(2)}:1`} />
        <Row k="full Kelly" v={pct(z.kellyFull, 1)} />
        <Row k="applied" v={pct(z.kellyApplied, 1)} />
        <Row k="bound by" v={z.bindingConstraint} />
      </dl>

      <div className="flex items-baseline justify-between pt-3">
        <span className="label">stake</span>
        <span data-numeric className="font-mono text-xl text-money">
          {usd(z.stakeUsdt)}
        </span>
      </div>

      <p className="mt-3 border-t pt-3 text-2xs hair leading-relaxed text-faint">
        {step.thesis}
      </p>
    </div>
  );
}

function Row({ k, v, tone = 'text-muted' }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ghost">{k}</dt>
      <dd data-numeric className={tone}>
        {v}
      </dd>
    </div>
  );
}

function Placed({ cleared }: { cleared: ScanStep[] }) {
  return (
    <>
      {cleared.map((s) => (
        <Line key={s.tokenId} tone="gain">
          ✓ order submitted · {s.side} · {usd(s.sizing?.stakeUsdt ?? 0)} · token{' '}
          {(s.tokenId ?? '').slice(0, 10)}
        </Line>
      ))}
      <Line muted>
        Submitted is not filled. A real run verifies with{' '}
        <span className="text-cream">baw prediction order history --status FILLED</span>.
      </Line>
      <Line muted>
        Convictions were written to the journal before any outcome is known. That is what makes
        the Brier score mean anything.
      </Line>
    </>
  );
}

// ---------------------------------------------------------------------------

function Controls({
  phase,
  cleared,
  totalStaked,
  unclaimedTotal,
  hasUnclaimed,
  typed,
  rejected,
  onTyped,
  onSkip,
  onOpenStake,
  onConfirm,
  onClaim,
  onReset,
}: {
  phase: Phase;
  cleared: number;
  totalStaked: number;
  unclaimedTotal: number;
  hasUnclaimed: boolean;
  typed: string;
  rejected: boolean;
  onTyped: (v: string) => void;
  onSkip: () => void;
  onOpenStake: () => void;
  onConfirm: (e: React.FormEvent) => void;
  onClaim: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t bg-raised px-4 py-3.5 hair md:px-6">
      {/* No button here while idle: the empty console already carries a large
          one, and two identical primaries on screen make neither read as the
          next action. */}
      {phase === 'idle' && (
        <p className="font-mono text-2xs text-ghost">
          step 1 of 3 · scan costs nothing · stake asks before it moves money
        </p>
      )}

      {phase === 'scanning' && (
        <>
          <button className="btn-ghost" onClick={onSkip}>
            Skip animation
          </button>
          <p className="font-mono text-2xs text-faint">pricing markets…</p>
        </>
      )}

      {phase === 'scanned' && (
        <>
          <button className="btn-primary" onClick={onOpenStake} disabled={cleared === 0}>
            Stake {usd(totalStaked)} <span aria-hidden>→</span>
          </button>
          <button className="btn-quiet" onClick={onReset}>
            Reset
          </button>
          <p className="font-mono text-2xs text-ghost">step 2 of 3 · this is where money moves</p>
        </>
      )}

      {phase === 'staking' && (
        <form onSubmit={onConfirm} className="flex w-full flex-wrap items-center gap-3">
          <label htmlFor="confirm" className="font-mono text-[13px] text-cream">
            Type <span className="text-money">stake</span> to confirm:
          </label>
          <input
            id="confirm"
            autoFocus
            value={typed}
            onChange={(e) => onTyped(e.target.value)}
            placeholder="stake"
            aria-invalid={rejected}
            aria-describedby={rejected ? 'confirm-error' : undefined}
            className={`w-36 rounded-[2px] border bg-void px-4 py-2 font-mono text-sm text-cream
              placeholder:text-ghost focus:outline-none ${
                rejected ? 'border-loss' : 'border-line-bright focus:border-teal'
              }`}
          />
          <button className="btn-primary" type="submit">
            Confirm
          </button>
          <button className="btn-quiet" type="button" onClick={onReset}>
            Cancel
          </button>
          {rejected && (
            <p id="confirm-error" role="alert" className="font-mono text-2xs text-loss">
              The whole word, typed out. “y” is not accepted, same as the CLI.
            </p>
          )}
        </form>
      )}

      {phase === 'staked' && (
        <>
          {hasUnclaimed ? (
            <button className="btn-primary" onClick={onClaim}>
              Claim {usd(unclaimedTotal)} <span aria-hidden>→</span>
            </button>
          ) : null}
          <button className="btn-quiet" onClick={onReset}>
            Run it again
          </button>
          <p className="font-mono text-2xs text-ghost">
            step 3 of 3 · winnings sit unclaimed until redeemed
          </p>
        </>
      )}

      {phase === 'claimed' && (
        <>
          <button className="btn-ghost" onClick={onReset}>
            Run it again
          </button>
          <p className="font-mono text-2xs text-faint">
            That is the whole loop: price, refuse or size, confirm, settle, claim.
          </p>
        </>
      )}
    </div>
  );
}

function kellyLabel(fraction: number): string {
  if (Math.abs(fraction - 0.25) < 0.01) return '¼ Kelly';
  if (Math.abs(fraction - 0.5) < 0.01) return '½ Kelly';
  if (Math.abs(fraction - 1) < 0.01) return 'full Kelly';
  return `${(fraction * 100).toFixed(0)}% Kelly`;
}
