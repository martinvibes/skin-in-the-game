/**
 * Surfaces: the slip, the stat, the ledger row, and the section frame.
 *
 * Kept in one file because they share the same visual grammar and are only
 * meaningful together — a slip that does not match the ledger rows it sits
 * above is worse than either alone.
 */

import type { ReactNode } from 'react';
import {
  moneyTone,
  pct,
  shortDate,
  until,
  usd,
  type JournalEntry,
  type OpenPosition,
  type SettledCall,
  type UnclaimedWin,
} from '../lib/data';

// ---------------------------------------------------------------------------

export function Section({
  eyebrow,
  title,
  lede,
  children,
  id,
}: {
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="border-t border-rule py-12 md:py-16">
      <div className="mb-8 max-w-2xl">
        <p className="label mb-3">{eyebrow}</p>
        <h2 className="font-display text-3xl leading-tight text-ink md:text-4xl">{title}</h2>
        {lede && <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">{lede}</p>}
      </div>
      {children}
    </section>
  );
}

/** A headline number with its label and an optional footnote. */
export function Stat({
  label,
  value,
  note,
  tone = 'text-ink',
  large = false,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  tone?: string;
  large?: boolean;
}) {
  return (
    <div className="ledger px-5 py-5">
      <p className="label mb-2">{label}</p>
      <p
        data-numeric
        className={`font-mono ${large ? 'text-4xl' : 'text-2xl'} font-medium leading-none ${tone}`}
      >
        {value}
      </p>
      {note && <p className="mt-2 text-xs leading-relaxed text-ink-faint">{note}</p>}
    </div>
  );
}

/** Rubber-stamp result marker. */
export function Stamp({ kind }: { kind: 'WON' | 'LOST' | 'OPEN' | 'UNCLAIMED' }) {
  const tone =
    kind === 'WON'
      ? 'text-jade'
      : kind === 'LOST'
        ? 'text-vermilion'
        : kind === 'UNCLAIMED'
          ? 'text-amber'
          : 'text-ink-faint';
  return (
    <span className={`stamp animate-stamp-in ${tone}`} aria-label={`result: ${kind}`}>
      {kind}
    </span>
  );
}

// ---------------------------------------------------------------------------

/**
 * A betting slip: one call, with the reasoning that produced it and the money
 * that backs it. This is the object the whole product is about, so it gets the
 * most distinctive surface — perforated edges, ruled interior, a stamp.
 */
export function Slip({ entry, settled }: { entry: JournalEntry; settled?: SettledCall }) {
  const edge = entry.conviction - entry.marketPrice;
  return (
    <article className="slip animate-rise px-5 py-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label mb-1.5">{shortDate(entry.at)}</p>
          <h3 className="text-[15px] font-medium leading-snug text-ink">{entry.question}</h3>
        </div>
        {settled ? <Stamp kind={settled.outcome} /> : <Stamp kind="OPEN" />}
      </header>

      <dl className="mb-4 grid grid-cols-3 gap-x-4 gap-y-3 border-y border-rule py-3">
        <Field label="agent said" value={pct(entry.conviction, 0)} tone="text-ink" />
        <Field label="market said" value={pct(entry.marketPrice, 0)} />
        <Field
          label="edge"
          value={`${edge >= 0 ? '+' : '−'}${Math.abs(edge * 100).toFixed(0)}%`}
          tone={edge > 0 ? 'text-jade' : 'text-vermilion'}
        />
        <Field label="staked" value={usd(entry.stake)} tone="text-amber" />
        <Field
          label="returned"
          value={settled ? usd(settled.payout) : '—'}
          tone={settled ? moneyTone(settled.pnl) : 'text-ink-faint'}
        />
        <Field
          label="p&l"
          value={settled ? usd(settled.pnl, true) : '—'}
          tone={settled ? moneyTone(settled.pnl) : 'text-ink-faint'}
        />
      </dl>

      <p className="text-xs leading-relaxed text-ink-faint">{entry.thesis}</p>
      <p className="mt-3 font-mono text-2xs text-ink-ghost">
        analyst {entry.analyst} · token {entry.tokenId.slice(0, 10)}
      </p>
    </article>
  );
}

function Field({ label, value, tone = 'text-ink-muted' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="label mb-1 !tracking-wider">{label}</dt>
      <dd data-numeric className={`font-mono text-sm ${tone}`}>
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The settled-calls ledger. Ruled rows, newest first. */
export function SettledLedger({ rows }: { rows: SettledCall[] }) {
  if (rows.length === 0) {
    return <Empty>No settled calls yet.</Empty>;
  }
  return (
    <div className="ledger overflow-x-auto">
      <table className="w-full min-w-[620px] text-left">
        <thead>
          <tr className="border-b border-rule">
            <Th className="pl-5">market</Th>
            <Th align="right">said</Th>
            <Th align="right">staked</Th>
            <Th align="right">returned</Th>
            <Th align="center">result</Th>
            <Th align="right" className="pr-5">
              p&l
            </Th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((s) => (
            <tr key={s.tokenId} className="ledger-row">
              <td className="max-w-[280px] truncate py-3 pl-5 pr-4 text-sm text-ink">{s.question}</td>
              <Td align="right" tone="text-ink">
                {pct(s.conviction, 0)}
              </Td>
              <Td align="right" tone="text-amber">
                {usd(s.cost)}
              </Td>
              <Td align="right">{s.payout > 0 ? usd(s.payout) : '—'}</Td>
              <td className="px-4 py-3 text-center">
                <span
                  className={`font-mono text-2xs font-bold tracking-widest ${
                    s.outcome === 'WON' ? 'text-jade' : 'text-vermilion'
                  }`}
                >
                  {s.outcome}
                </span>
              </td>
              <Td align="right" tone={moneyTone(s.pnl)} className="pr-5">
                {usd(s.pnl, true)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OpenLedger({ rows }: { rows: OpenPosition[] }) {
  if (rows.length === 0) return <Empty>Nothing open. Every call has resolved.</Empty>;
  return (
    <div className="ledger overflow-x-auto">
      <table className="w-full min-w-[520px] text-left">
        <thead>
          <tr className="border-b border-rule">
            <Th className="pl-5">market</Th>
            <Th align="right">side</Th>
            <Th align="right">said</Th>
            <Th align="right">at risk</Th>
            <Th align="right" className="pr-5">
              resolves
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.tokenId} className="ledger-row">
              <td className="max-w-[260px] truncate py-3 pl-5 pr-4 text-sm text-ink">{p.question}</td>
              <Td align="right">{p.side}</Td>
              <Td align="right" tone="text-ink">
                {pct(p.conviction, 0)}
              </Td>
              <Td align="right" tone="text-amber">
                {usd(p.cost)}
              </Td>
              <Td align="right" className="pr-5">
                {until(p.endDate)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UnclaimedPanel({ rows }: { rows: UnclaimedWin[] }) {
  if (rows.length === 0) return null;
  const total = rows.reduce((a, u) => a + u.payout, 0);
  return (
    <div className="ledger border-amber-dim/60 px-5 py-5">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <p className="label !text-amber">unclaimed winnings</p>
        <p data-numeric className="font-mono text-xl text-amber">
          {usd(total)}
        </p>
      </div>
      <ul className="space-y-2">
        {rows.map((u) => (
          <li key={u.tokenId} className="flex items-baseline justify-between gap-4 text-sm">
            <span className="truncate text-ink-muted">{u.question}</span>
            <span data-numeric className="shrink-0 font-mono text-ink">
              {usd(u.payout)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-rule pt-3 text-xs text-ink-faint">
        Settled, won, and still sitting on-chain. Prediction markets do not pay out
        automatically — <code className="font-mono text-amber-dim">skin claim</code> redeems them.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Th({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`label px-4 py-3 font-normal ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      } ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  tone = 'text-ink-muted',
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  tone?: string;
  className?: string;
}) {
  return (
    <td
      data-numeric
      className={`px-4 py-3 font-mono text-sm ${tone} ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      } ${className}`}
    >
      {children}
    </td>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="ledger px-5 py-10 text-center text-sm text-ink-faint">{children}</div>
  );
}
