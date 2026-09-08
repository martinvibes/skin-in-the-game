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

/**
 * The palette, as xterm-256 codes chosen to match the dashboard's tokens so a
 * viewer moving between the site and a recording of the CLI sees one product.
 *
 * Everything routes through `paint`, which is a no-op when colour is not
 * supported (a pipe, a CI log, `NO_COLOR`). That keeps rule 2 in the header
 * honest: colour is a second channel on top of a word, never the only one
 * carrying the meaning.
 */
const C = {
  gold: 214, // Binance amber. Identity, and money at stake.
  goldDim: 136,
  teal: 79, // Safe, read-only, the model's own view.
  green: 78, // Money gained.
  red: 210, // Money lost.
  blue: 111, // Time, and things that have run out of it.
  ink: 253,
  muted: 247,
  ghost: 244,
  faint: 240,
  hair: 237, // Rules and box edges.
  black: 16,
} as const;

const ESC = '\x1b[';
const RESET = `${ESC}0m`;

function paint(s: string, fg: number, bg?: number): string {
  if (!pc.isColorSupported) return s;
  const head = `${ESC}38;5;${fg}m` + (bg === undefined ? '' : `${ESC}48;5;${bg}m`);
  return head + s + RESET;
}

export const ink = (s: string) => paint(s, C.ink);
export const muted = (s: string) => paint(s, C.muted);
export const ghost = (s: string) => paint(s, C.ghost);
export const faint = (s: string) => paint(s, C.faint);
export const gold = (s: string) => paint(s, C.gold);
export const teal = (s: string) => paint(s, C.teal);
export const good = (s: string) => paint(s, C.green);
export const bad = (s: string) => paint(s, C.red);
export const cool = (s: string) => paint(s, C.blue);

/** A filled badge: dark text on a solid block, for labels that must be found fast. */
export const badge = (s: string, bg: number = C.gold) => pc.bold(paint(` ${s} `, C.black, bg));
export const goldBadge = (s: string) => badge(s, C.gold);
export const tealBadge = (s: string) => badge(s, C.teal);
export const redBadge = (s: string) => badge(s, C.red);
export const blueBadge = (s: string) => badge(s, C.blue);
export const greenBadge = (s: string) => badge(s, C.green);

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
  n > 0 ? good(usd(n, true)) : n < 0 ? bad(usd(n, true)) : ghost(usd(n, true));

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
  return paint(RULE.repeat(width), C.hair);
}

/**
 * A section head: a gold bar, the title in caps, and the subtitle that says
 * what the numbers under it actually are. The bar is the only ornament in the
 * output, and it exists so a viewer scrubbing a recording can find the section
 * boundaries without reading a word.
 */
export function heading(title: string, subtitle?: string): string {
  const lines = ['', gold('▌') + ' ' + pc.bold(ink(title.toUpperCase()))];
  if (subtitle) lines.push(faint('  ' + subtitle));
  lines.push(rule());
  return lines.join('\n');
}

/** The mode banner. Printed on every command so demo data is never ambiguous. */
export function modeBanner(mode: 'live' | 'demo'): string {
  return mode === 'live'
    ? redBadge('● LIVE') + faint('  real wallet, real money')
    : tealBadge('● DEMO') + faint('  synthetic fixtures · no wallet, no money moved');
}

/** The wordmark. Solid gold, so the first thing on screen is the product. */
export function wordmark(): string {
  return goldBadge('SKIN') + ' ' + faint('skin in the game');
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
  const label = ` ${status} `; // width including the badge's padding
  const stamp =
    status === 'STAKED'
      ? badge(status, C.green)
      : status === 'PENDING'
        ? badge(status, C.blue)
        : badge(status, C.red);

  const out: string[] = [];
  const bar = (l: string, r: string) => paint(l + '┄'.repeat(WIDTH - 2) + r, C.goldDim);
  const side_ = paint('┆', C.goldDim);
  out.push(bar('┌', '┐'));
  out.push(
    side_ + ' ' +
      padEnd(pc.bold(ink(clip(question, w - label.length - 2))), w - label.length) +
      stamp +
      ' ' + side_,
  );
  out.push(side_ + ' ' + padEnd(faint('side ') + pc.bold(gold(side)), w) + ' ' + side_);
  out.push(bar('┆', '┆'));

  const row = (k: string, v: string) =>
    side_ + ' ' + padEnd(ghost(k), 22) + padEnd(v, w - 22) + ' ' + side_;

  out.push(row('agent says', pc.bold(teal(pct(sizing.p)))));
  out.push(row('market says', muted(pct(sizing.price))));
  out.push(row('edge', (sizing.edge > 0 ? good : bad)(pct(sizing.edge))));
  out.push(row('payout odds', muted(`${sizing.odds.toFixed(2)}:1`)));
  out.push(row('full Kelly', muted(pct(sizing.kellyFull))));
  out.push(row('applied (¼ Kelly)', muted(pct(sizing.kellyApplied))));
  out.push(row('bound by', ghost(sizing.bindingConstraint)));
  out.push(bar('┆', '┆'));
  out.push(row('STAKE', goldBadge(usd(sizing.stakeUsdt))));
  out.push(bar('┆', '┆'));
  for (const line of wrap(thesis, w)) {
    out.push(side_ + ' ' + padEnd(faint(line), w) + ' ' + side_);
  }
  out.push(bar('└', '┘'));
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
    out.push(faint('  No settled calls yet. Nothing to show, and nothing to claim.'));
    out.push(rule());
    return out.join('\n');
  }

  const stat = (label: string, value: string, note?: string) =>
    '  ' + padEnd(ghost(label), 20) + padStart(value, 14) + (note ? '  ' + faint(note) : '');

  out.push(stat('realized PnL', money(r.realizedPnl), `on ${usd(r.totalStaked)} staked`));
  out.push(stat('return on stake', r.roi === null ? '—' : (r.roi >= 0 ? good : bad)(pct(r.roi))));
  out.push('');
  out.push(
    stat(
      'Brier score',
      // Brier is the number the whole project is judged on, so it is the one
      // thing on this screen wearing the brand colour.
      r.brier === null ? '—' : goldBadge(r.brier.toFixed(3)),
      brierVerdict(r.brier, r.scoredCalls) ?? undefined,
    ),
  );
  out.push(stat('', '', `0 perfect · 0.25 = always saying "50%" · lower is better`));
  out.push('');
  out.push(stat('settled calls', muted(String(r.calls))));
  out.push(stat('won / lost', `${good(String(r.wins))}${ghost(' / ')}${bad(String(r.losses))}`));
  out.push(stat('hit rate', muted(pct(r.hitRate))));
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
  if (values.length === 0) return faint('  (no data)');
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
    return v >= 0 ? good(ch) : bad(ch);
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
      padEnd(faint('market'), 36) +
      padStart(teal('said'), 7) +
      padStart(faint('result'), 9) +
      padStart(faint('pnl'), 10),
  );
  for (const s of rows.slice(-limit)) {
    const result = s.outcome === 'WON' ? good('WON') : bad('LOST');
    out.push(
      '  ' +
        padEnd(muted(clip(s.question, 34)), 36) +
        padStart(s.conviction === null ? ghost('—') : teal(pct(s.conviction, 0)), 7) +
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
    out.push(faint('  No journalled convictions yet — nothing to calibrate.'));
    out.push(rule());
    return out.join('\n');
  }
  out.push(
    '  ' +
      padEnd(faint('bucket'), 12) +
      padEnd(faint('n'), 5) +
      padEnd(teal('said'), 8) +
      padEnd(faint('actual'), 9) +
      faint('  reliability'),
  );
  for (const b of r.calibration) {
    const barWidth = 24;
    const said = Math.round(b.meanConviction * barWidth);
    const actual = Math.round(b.observedRate * barWidth);
    const bar = Array.from({ length: barWidth }, (_, i) => {
      if (i < Math.min(said, actual)) return good('█');
      if (i < said) return gold('▒'); // claimed but not delivered
      if (i < actual) return cool('▒'); // delivered beyond the claim
      return paint('·', C.hair);
    }).join('');
    out.push(
      '  ' +
        padEnd(muted(`${(b.lower * 100).toFixed(0)}–${(b.upper * 100).toFixed(0)}%`), 12) +
        padEnd(ghost(String(b.n)), 5) +
        padEnd(teal(pct(b.meanConviction, 0)), 8) +
        padEnd(muted(pct(b.observedRate, 0)), 9) +
        '  ' +
        bar,
    );
  }
  out.push(
    '  ' +
      good('█') +
      faint(' delivered  ') +
      gold('▒') +
      faint(' overclaimed  ') +
      cool('▒') +
      faint(' underclaimed'),
  );
  out.push(rule());
  return out.join('\n');
}
