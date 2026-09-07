/**
 * The conviction journal.
 *
 * Binance records what a position *did*. Only this file records what the agent
 * *claimed* before the outcome was known — and without that half, no honesty
 * measure is possible. Hit rate and PnL survive on Binance's data alone; Brier
 * score and the calibration curve do not.
 *
 * ## Append-only, on purpose
 *
 * Entries are appended as JSON Lines and never rewritten. A conviction written
 * before settlement and edited after it is worthless as evidence, so the
 * writer refuses to overwrite an existing token id and the reader keeps the
 * *first* entry it sees for any token. An agent that could revise its own
 * stated confidence after seeing the result would defeat the entire premise,
 * and "we simply won't do that" is a weaker guarantee than a store that cannot.
 *
 * The file is local and therefore trusted only as much as the machine it sits
 * on — this is a hackathon artifact, not a notarised audit log. The README says
 * so plainly. What it does buy is that the record cannot be quietly improved by
 * the agent itself during a run.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface JournalEntry {
  /** ERC-1155 outcome token the stake bought. The join key with Binance data. */
  tokenId: string;
  /** Probability the agent stated *before* the market resolved. */
  conviction: number;
  /** Market-implied probability at that moment, for edge reconstruction. */
  marketPrice: number;
  /** USDT committed. */
  stake: number;
  /** The market question, denormalised so the journal reads standalone. */
  question: string;
  /** One-line reasoning shown on the receipt. */
  thesis: string;
  /** Which analyst produced the number, e.g. `quant/lognormal` or `llm/claude`. */
  analyst: string;
  /** ISO-8601, written at stake time. */
  at: string;
}

export const DEFAULT_JOURNAL_PATH = join(homedir(), '.skin', 'journal.jsonl');

/** Append one entry. First write for a token id wins; later ones are ignored. */
export async function record(
  entry: JournalEntry,
  path = DEFAULT_JOURNAL_PATH,
): Promise<{ written: boolean }> {
  const existing = await load(path);
  if (existing.has(entry.tokenId)) return { written: false };
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(entry) + '\n', 'utf8');
  return { written: true };
}

/** All entries, earliest-first, deduplicated by token id (first wins). */
export async function loadEntries(path = DEFAULT_JOURNAL_PATH): Promise<JournalEntry[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const seen = new Set<string>();
  const out: JournalEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // A corrupt line is skipped rather than aborting the read: losing one
      // entry degrades the Brier sample, losing the file loses the record.
      continue;
    }
    const entry = toEntry(parsed);
    if (!entry || seen.has(entry.tokenId)) continue;
    seen.add(entry.tokenId);
    out.push(entry);
  }
  return out;
}

/** Convictions keyed by token id, for joining onto Binance's settled rows. */
export async function load(path = DEFAULT_JOURNAL_PATH): Promise<Map<string, number>> {
  const entries = await loadEntries(path);
  return new Map(entries.map((e) => [e.tokenId, e.conviction]));
}

function toEntry(v: unknown): JournalEntry | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const tokenId = typeof o['tokenId'] === 'string' ? o['tokenId'] : null;
  const conviction = typeof o['conviction'] === 'number' ? o['conviction'] : null;
  if (!tokenId || conviction === null || !Number.isFinite(conviction)) return null;
  return {
    tokenId,
    conviction,
    marketPrice: typeof o['marketPrice'] === 'number' ? o['marketPrice'] : 0,
    stake: typeof o['stake'] === 'number' ? o['stake'] : 0,
    question: typeof o['question'] === 'string' ? o['question'] : 'Unknown market',
    thesis: typeof o['thesis'] === 'string' ? o['thesis'] : '',
    analyst: typeof o['analyst'] === 'string' ? o['analyst'] : 'unknown',
    at: typeof o['at'] === 'string' ? o['at'] : new Date(0).toISOString(),
  };
}
