/**
 * Thin, auditable process runner for the `baw` CLI.
 *
 * Two rules govern this file, both taken from the Binance Agentic Wallet
 * skill's own operating policy:
 *
 *   1. Every invocation passes `--json`. We never scrape human-readable output.
 *   2. CLI errors are surfaced verbatim. We do not rephrase them, guess at
 *      causes, or map them onto our own error taxonomy — a wallet error that
 *      reaches a user half-translated is worse than no error at all.
 */

import { execFile } from 'node:child_process';

/** Raised when `baw` exits non-zero or emits an error envelope. */
export class BawError extends Error {
  /** The argv we ran, for reproduction in a bug report. */
  readonly argv: string[];
  /** Raw stderr/stdout from the CLI, unmodified. */
  readonly raw: string;
  readonly exitCode: number | null;

  constructor(argv: string[], raw: string, exitCode: number | null) {
    // The message is the CLI's own words. Ours is only the prefix that says
    // which command produced them.
    super(`\`baw ${argv.join(' ')}\` failed:\n${raw.trim()}`);
    this.name = 'BawError';
    this.argv = argv;
    this.raw = raw.trim();
    this.exitCode = exitCode;
  }
}

/** Raised when the `baw` binary is not on PATH at all. */
export class BawNotInstalledError extends Error {
  constructor() {
    super(
      'The `baw` CLI was not found on PATH.\n' +
        'Install it with:\n' +
        '  npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet\n' +
        'or run Skin in demo mode with `--demo`.',
    );
    this.name = 'BawNotInstalledError';
  }
}

export interface RunOptions {
  /** Milliseconds before the child process is killed. */
  timeoutMs?: number;
  /** Binary to invoke. Overridable for tests. */
  bin?: string;
}

/**
 * Run `baw <args...> --json` and return the parsed envelope.
 *
 * `execFile` (not `exec`) is used deliberately: arguments are passed as an
 * array and never interpolated into a shell string, so a market title
 * containing shell metacharacters cannot become command injection.
 */
export async function runBaw<T = unknown>(
  args: string[],
  opts: RunOptions = {},
): Promise<T> {
  const bin = opts.bin ?? 'baw';
  const argv = args.includes('--json') ? args : [...args, '--json'];

  const { stdout, stderr, code } = await spawn(bin, argv, opts.timeoutMs ?? 60_000);

  if (code !== 0) {
    if (isMissingBinary(stderr, code)) throw new BawNotInstalledError();
    throw new BawError(argv, stderr || stdout, code);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // A non-JSON body on a zero exit usually means the CLI printed a prompt or
    // a login notice. Hand the raw text back rather than inventing a reason.
    throw new BawError(argv, stdout || stderr, code);
  }

  // `baw` wraps payloads as { success: boolean, data: T } — but not on every
  // command and not on every version, so unwrap only when the shape matches.
  if (isEnvelope(parsed)) {
    if (parsed.success === false) {
      throw new BawError(argv, JSON.stringify(parsed, null, 2), code);
    }
    return parsed.data as T;
  }
  return parsed as T;
}

interface Envelope {
  success: boolean;
  data?: unknown;
}

function isEnvelope(v: unknown): v is Envelope {
  return typeof v === 'object' && v !== null && 'success' in v;
}

function isMissingBinary(stderr: string, code: number | null): boolean {
  return code === 127 || /ENOENT|command not found|not recognized/i.test(stderr);
}

function spawn(
  bin: string,
  argv: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile(
      bin,
      argv,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as NodeJS.ErrnoException).code === 'number'
            ? ((err as unknown as { code: number }).code)
            : err
              ? ((err as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 1)
              : 0;
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code });
      },
    );
  });
}

/** True when `baw` is resolvable on PATH. Used to pick a default mode. */
export async function bawAvailable(bin = 'baw'): Promise<boolean> {
  const { code } = await spawn(bin, ['--version'], 10_000);
  return code === 0;
}
