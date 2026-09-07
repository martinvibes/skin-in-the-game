/**
 * Terminal rendering.
 *
 * The CLI is what gets recorded for the demo, so layout is treated as part of
 * the product rather than as debug output. Three rules:
 *
 *   1. Numbers align. Money and probabilities are right-aligned in fixed
 *      columns so a column can be read down without re-reading each row.
 *   2. Colour carries one meaning only — green is money gained, red is money
 *      lost, amber is money at stake. It is never decoration, and every colour
 *      is paired with a word or symbol so the output survives a colourblind
 *      reader and a `| cat` pipe.
 *   3. Nothing is claimed that was not measured. A null renders as `—`, never
 *      as `0.00`.
 */

import pc from 'picocolors';
import type { Record as TrackRecord, SettledCall, Sizing } from '../domain/types.js';
import { brierVerdict } from '../engine/record.js';

export const RULE = '─';
export const WIDTH = 74;

export const usd = (n: number, signed = false): string => {
  const s = `$${Math.abs(n).toFixed(2)}`;
  if (!signed) return s;
  return n < 0 ? `−${s}` : `+${s}`;
};

export const pct = (n: number | null, dp = 1): string =>
  n === null ? '—' : `${(n * 100).toFixed(dp)}%`;

export const money = (n: number): string =>
  n > 0 ? pc.green(usd(n, true)) : n < 0 ? pc.red(usd(n, true)) : pc.dim(usd(n, true));

export const dim = (s: string) => pc.dim(s);
export const bold = (s: string) => pc.bold(s);
export const amber = (s: string) => pc.yellow(s);

/** Pad-end that accounts for the fact that colour codes have no width. */
export function padEnd(s: string, n: number): string {
  const visible = stripAnsi(s).length;
  return s + ' '.repeat(Math.max(0, n - visible));
}

export function padStart(s: string, n: number): string {
  const visible = stripAnsi(s).length;
  return ' '.repeat(Math.max(0, n - visible)) + s;
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '');
}

/** Truncate to a visible width, with an ellipsis when it does not fit. */
export function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '…';
}

export function rule(width = WIDTH): string {
  return pc.dim(RULE.repeat(width));
}

export function heading(title: string, subtitle?: string): string {
  const lines = ['', pc.bold(title.toUpperCase())];
  if (subtitle) lines.push(pc.dim(subtitle));
  lines.push(rule());
  return lines.join('\n');
}

/** The mode banner. Printed on every command so demo data is never ambiguous. */
export function modeBanner(mode: 'live' | 'demo'): string {
  return mode === 'live'
    ? pc.green('● LIVE') + pc.dim('  real wallet, real money')
    : pc.yellow('● DEMO') + pc.dim('  synthetic fixtures · no wallet, no money moved');
}

/**
 * A stake receipt.
 *
 * Rendered as a betting slip because that is what it is: a claim, a price, and
 * money committed against it. It shows the full sizing derivation rather than
 * just the final number, so the stake can be checked by hand.
 */
export function receipt(opts: {
  question: string;
  side: string;
  sizing: Sizing;
  thesis: string;
  status: 'STAKED' | 'DECLINED' | 'PENDING';
}): string {
  const { question, side, sizing, thesis, status } = opts;
  const w = WIDTH - 4;
  // The three stamps have different widths, so the question column is sized
  // against the actual stamp rather than a constant — otherwise the right edge
  // of the slip shifts by a character depending on status.
  const label = ` ${status} `;
  const stamp =
    status === 'STAKED'
      ? pc.bgYellow(pc.black(label))
      : status === 'PENDING'
        ? pc.bgBlue(pc.white(label))
        : pc.bgRed(pc.white(label));

  const out: string[] = [];
  out.push(pc.dim('┌' + '┄'.repeat(WIDTH - 2) + '┐'));
  out.push(
    pc.dim('┆ ') +
      padEnd(pc.bold(clip(question, w - label.length - 2)), w - label.length) +
      stamp +
      pc.dim(' ┆'),
  );
  out.push(pc.dim('┆ ') + padEnd(pc.dim('side ') + pc.bold(side), w) + pc.dim(' ┆'));
  out.push(pc.dim('┆') + pc.dim('┄'.repeat(WIDTH - 2)) + pc.dim('┆'));

  const row = (k: string, v: string) =>
    pc.dim('┆ ') + padEnd(pc.dim(k), 22) + padEnd(v, w - 22) + pc.dim(' ┆');

  out.push(row('agent says', pc.bold(pct(sizing.p))));
  out.push(row('market says', pct(sizing.price)));
  out.push(row('edge', (sizing.edge > 0 ? pc.green : pc.red)(pct(sizing.edge))));
  out.push(row('payout odds', `${sizing.odds.toFixed(2)}:1`));
  out.push(row('full Kelly', pct(sizing.kellyFull)));
  out.push(row('applied (¼ Kelly)', pct(sizing.kellyApplied)));
  out.push(row('bound by', sizing.bindingConstraint));
  out.push(pc.dim('┆') + pc.dim('┄'.repeat(WIDTH - 2)) + pc.dim('┆'));
  out.push(row('STAKE', amber(pc.bold(usd(sizing.stakeUsdt)))));
  out.push(pc.dim('┆') + pc.dim('┄'.repeat(WIDTH - 2)) + pc.dim('┆'));
  for (const line of wrap(thesis, w)) {
    out.push(pc.dim('┆ ') + padEnd(pc.dim(line), w) + pc.dim(' ┆'));
  }
  out.push(pc.dim('└' + '┄'.repeat(WIDTH - 2) + '┘'));
  return out.join('\n');
}

/** Word-wrap to a width, preserving whole words. */
export function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    if (cur === '') cur = word;
    else if ((cur + ' ' + word).length <= width) cur += ' ' + word;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

/**
 * The track record block — the centrepiece of the demo.
 *
 * Ordered so the least flattering, hardest-to-fake numbers come first: money,
 * then honesty, then hit rate. Hit rate is the one an agent could game by only
 * betting on near-certainties, so it is deliberately not the headline.
 */
export function renderRecord(r: TrackRecord): string {
  const out: string[] = [];
  out.push(heading('the record', 'computed from settled positions — the agent does not get a vote'));

  if (r.calls === 0) {
    out.push(pc.dim('  No settled calls yet. Nothing to show, and nothing to claim.'));
    out.push(rule());
    return out.join('\n');
  }

  const stat = (label: string, value: string, note?: string) =>
    '  ' + padEnd(pc.dim(label), 20) + padStart(value, 14) + (note ? '  ' + pc.dim(note) : '');

  out.push(stat('realized PnL', money(r.realizedPnl), `on ${usd(r.totalStaked)} staked`));
  out.push(stat('return on stake', r.roi === null ? '—' : (r.roi >= 0 ? pc.green : pc.red)(pct(r.roi)),
  ));
  out.push('');
  out.push(
    stat(
      'Brier score',
      r.brier === null ? '—' : pc.bold(r.brier.toFixed(3)),
      brierVerdict(r.brier, r.scoredCalls) ?? undefined,
    ),
  );
  out.push(stat('', '', `0 perfect · 0.25 = always saying "50%" · lower is better`));
  out.push('');
  out.push(stat('settled calls', String(r.calls)));
  out.push(stat('won / lost', `${pc.green(String(r.wins))} / ${pc.red(String(r.losses))}`));
  out.push(stat('hit rate', pct(r.hitRate)));
  out.push(rule());
  return out.join('\n');
}

/**
 * Equity sparkline over settled calls.
 *
 * A cumulative-PnL curve is the one picture that cannot be argued with, so it
 * is worth drawing even in a terminal. Uses block glyphs scaled between the
 * running minimum and maximum, with the zero line marked.
 */
export function sparkline(values: number[], width = WIDTH - 4): string {
  if (values.length === 0) return pc.dim('  (no data)');
  const blocks = '▁▂▃▄▅▆▇█';
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;

  const sampled = resample(values, Math.min(width, values.length * 3));
  const chars = sampled.map((v) => {
    const idx = Math.min(
      blocks.length - 1,
      Math.max(0, Math.round(((v - min) / span) * (blocks.length - 1))),
    );
    const ch = blocks[idx]!;
    return v >= 0 ? pc.green(ch) : pc.red(ch);
  });
  return '  ' + chars.join('');
}

/** Linear resample so a short series still fills a readable width. */
function resample(values: number[], target: number): number[] {
  if (values.length >= target) return values;
  const out: number[] = [];
  for (let i = 0; i < target; i++) {
    const pos = (i / (target - 1 || 1)) * (values.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    const t = pos - lo;
    out.push(values[lo]! * (1 - t) + values[hi]! * t);
  }
  return out;
}

/** A compact table of settled calls, newest last. */
export function renderSettled(rows: SettledCall[], limit = 12): string {
  const out: string[] = [];
  out.push(heading('settled calls', `last ${Math.min(limit, rows.length)} of ${rows.length}`));
  out.push(
    '  ' +
      padEnd(pc.dim('market'), 36) +
      padStart(pc.dim('said'), 7) +
      padStart(pc.dim('result'), 9) +
      padStart(pc.dim('pnl'), 10),
  );
  for (const s of rows.slice(-limit)) {
    const result = s.outcome === 'WON' ? pc.green('WON') : pc.red('LOST');
    out.push(
      '  ' +
        padEnd(clip(s.question, 34), 36) +
        padStart(s.conviction === null ? pc.dim('—') : pct(s.conviction, 0), 7) +
        padStart(result, 9) +
        padStart(money(s.pnl), 10),
    );
  }
  out.push(rule());
  return out.join('\n');
}

/** Reliability curve: stated confidence against observed frequency. */
export function renderCalibration(r: TrackRecord): string {
  const out: string[] = [];
  out.push(
    heading('calibration', 'of the calls it made at X% confidence, how many came in?'),
  );
  if (r.calibration.length === 0) {
    out.push(pc.dim('  No journalled convictions yet — nothing to calibrate.'));
    out.push(rule());
    return out.join('\n');
  }
  out.push(
    '  ' +
      padEnd(pc.dim('bucket'), 12) +
      padEnd(pc.dim('n'), 5) +
      padEnd(pc.dim('said'), 8) +
      padEnd(pc.dim('actual'), 9) +
      pc.dim('  reliability'),
  );
  for (const b of r.calibration) {
    const barWidth = 24;
    const said = Math.round(b.meanConviction * barWidth);
    const actual = Math.round(b.observedRate * barWidth);
    const bar = Array.from({ length: barWidth }, (_, i) => {
      if (i < Math.min(said, actual)) return pc.green('█');
      if (i < said) return pc.yellow('▒'); // claimed but not delivered
      if (i < actual) return pc.cyan('▒'); // delivered beyond the claim
      return pc.dim('·');
    }).join('');
    out.push(
      '  ' +
        padEnd(`${(b.lower * 100).toFixed(0)}–${(b.upper * 100).toFixed(0)}%`, 12) +
        padEnd(String(b.n), 5) +
        padEnd(pct(b.meanConviction, 0), 8) +
        padEnd(pct(b.observedRate, 0), 9) +
        '  ' +
        bar,
    );
  }
  out.push(
    pc.dim('  ') +
      pc.green('█') +
      pc.dim(' delivered  ') +
      pc.yellow('▒') +
      pc.dim(' overclaimed  ') +
      pc.cyan('▒') +
      pc.dim(' underclaimed'),
  );
  out.push(rule());
  return out.join('\n');
}
