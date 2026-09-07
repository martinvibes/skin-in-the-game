/**
 * Shared surfaces: section frames, stats, ledgers.
 *
 * One panel shape, one label voice, one set of colour rules — the visual
 * grammar lives in `index.css` and these components only arrange it.
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

export function Stat({
  label,
  value,
  note,
  tone = 'text-cream',
}: {
  label: string;
  value: string;
  note?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="panel trace h-full px-5 py-5">
      <p className="label mb-2.5">{label}</p>
      <p data-numeric className={`font-mono text-3xl font-medium leading-none ${tone}`}>
        {value}
      </p>
      {note && <p className="mt-2.5 text-xs leading-relaxed text-faint">{note}</p>}
    </div>
  );
}

export function Stamp({ kind }: { kind: 'WON' | 'LOST' | 'OPEN' | 'UNCLAIMED' }) {
  const tone = {
    WON: '!border-gain/40 !text-gain',
    LOST: '!border-loss/40 !text-loss',
    UNCLAIMED: '!border-money/40 !text-money',
    OPEN: '',
  }[kind];
  return <span className={`chip ${tone}`}>{kind.toLowerCase()}</span>;
}

// ---------------------------------------------------------------------------

/** One journalled call: the claim, the money, and what came back. */
export function Slip({ entry, settled }: { entry: JournalEntry; settled?: SettledCall }) {
  const edge = entry.conviction - entry.marketPrice;
  return (
    <article className="panel trace animate-rise p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label mb-1.5">{shortDate(entry.at)}</p>
          <h3 className="font-display text-[15px] font-medium leading-snug text-cream">
            {entry.question}
          </h3>
        </div>
        <Stamp kind={settled ? settled.outcome : 'OPEN'} />
      </header>

      <dl className="mb-4 grid grid-cols-3 gap-x-4 gap-y-3 border-y border-line py-3.5">
        <Field label="agent said" value={pct(entry.conviction, 0)} tone="text-cream" />
        <Field label="market said" value={pct(entry.marketPrice, 0)} />
        <Field
          label="edge"
          value={`${edge >= 0 ? '+' : '−'}${Math.abs(edge * 100).toFixed(0)}%`}
          tone={edge > 0 ? 'text-gain' : 'text-loss'}
        />
        <Field label="staked" value={usd(entry.stake)} tone="text-money" />
        <Field
          label="returned"
          value={settled ? usd(settled.payout) : '—'}
          tone={settled ? moneyTone(settled.pnl) : 'text-ghost'}
        />
        <Field
          label="p&l"
          value={settled ? usd(settled.pnl, true) : '—'}
          tone={settled ? moneyTone(settled.pnl) : 'text-ghost'}
        />
      </dl>

      <p className="text-xs leading-relaxed text-faint">{entry.thesis}</p>
      <p className="mt-3 font-mono text-2xs text-ghost">
        {entry.analyst} · token {entry.tokenId.slice(0, 10)}
      </p>
    </article>
  );
}

function Field({ label, value, tone = 'text-muted' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="label mb-1">{label}</dt>
      <dd data-numeric className={`font-mono text-sm ${tone}`}>
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SettledLedger({ rows }: { rows: SettledCall[] }) {
  if (rows.length === 0) return <Empty>No settled calls yet.</Empty>;
  return (
    <div className="panel scrollbar-thin overflow-x-auto">
      <table className="w-full min-w-[620px] text-left">
        <thead>
          <tr className="border-b border-line">
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
            <tr key={s.tokenId} className="border-b border-line/60 last:border-0 hover:bg-raised/60">
              <td className="max-w-[280px] truncate py-3.5 pl-5 pr-4 text-sm text-cream">
                {s.question}
              </td>
              <Td align="right" tone="text-cream">
                {pct(s.conviction, 0)}
              </Td>
              <Td align="right" tone="text-money">
                {usd(s.cost)}
              </Td>
              {/* A losing call returned $0.00, which is known. The em dash is
                  reserved throughout for "not known" — see `pct` in lib/data. */}
              <Td align="right">{usd(s.payout)}</Td>
              <td className="px-4 py-3.5 text-center">
                <span
                  className={`font-mono text-2xs font-bold uppercase tracking-[0.12em] ${
                    s.outcome === 'WON' ? 'text-gain' : 'text-loss'
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
    <div className="panel scrollbar-thin overflow-x-auto">
      <table className="w-full min-w-[520px] text-left">
        <thead>
          <tr className="border-b border-line">
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
            <tr key={p.tokenId} className="border-b border-line/60 last:border-0 hover:bg-raised/60">
              <td className="max-w-[260px] truncate py-3.5 pl-5 pr-4 text-sm text-cream">
                {p.question}
              </td>
              <Td align="right">{p.side}</Td>
              <Td align="right" tone="text-cream">
                {pct(p.conviction, 0)}
              </Td>
              <Td align="right" tone="text-money">
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
    <div className="panel border-money/25 p-5">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <p className="label !text-money">unclaimed winnings</p>
        <p data-numeric className="font-mono text-xl text-money">
          {usd(total)}
        </p>
      </div>
      <ul className="space-y-2.5">
        {rows.map((u) => (
          <li key={u.tokenId} className="flex items-baseline justify-between gap-4 text-sm">
            <span className="truncate text-muted">{u.question}</span>
            <span data-numeric className="shrink-0 font-mono text-cream">
              {usd(u.payout)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-line pt-3.5 text-xs leading-relaxed text-faint">
        Settled, won, and still sitting on-chain. Prediction markets do not pay out
        automatically. <code className="whitespace-nowrap font-mono text-money">skin claim</code>{' '}
        redeems them.
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
  tone = 'text-muted',
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
      className={`px-4 py-3.5 font-mono text-sm ${tone} ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      } ${className}`}
    >
      {children}
    </td>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="panel px-5 py-12 text-center text-sm text-faint">{children}</div>;
}
