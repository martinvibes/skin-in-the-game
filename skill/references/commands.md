# Command reference

Everything the skill can run, and what to do with the output.

---

## `skin record`

The track record. Read-only; safe to run at any time.

```bash
skin record            # auto-detects: live if `baw` is installed, else demo
skin record --demo     # force the bundled fixtures
skin record --live     # force the wallet; fails loudly if `baw` is missing
skin record --json     # machine-readable
```

Prints, in this order: realized PnL, ROI, Brier score with its plain-English
reading, hit rate, the settled ledger, an equity sparkline, and the calibration
table.

**The order is the point.** PnL and Brier come first because they are the two
numbers an agent cannot flatter. Hit rate comes last because it is trivially
gamed by only betting on 95¢ near-certainties.

---

## `skin scan`

Form opinions. Touches no money.

```bash
skin scan
skin scan --limit 20              # how many markets to pull (default 12)
skin scan --mcp-data ./klines.json  # use data fetched through the MCP Server
skin scan --kelly 0.5             # half-Kelly instead of the default quarter
```

Every market gets a line. Either a conviction and a proposed stake, or one of
the five declines. Report both halves — the declines are evidence that the
sizing gate works.

---

## `skin stake`

**Spends real money.** Runs a scan, then places orders for whatever cleared.

```bash
skin stake --budget 6 --per-call 1.5
skin stake --yes                  # unattended; only when explicitly asked
```

| Flag | Default | Meaning |
|---|---|---|
| `--budget` | `6` | Total USDT this run may commit |
| `--per-call` | `1.5` | Ceiling on any single stake |
| `--kelly` | `0.25` | Kelly fraction applied to the full-Kelly number |
| `--min-order` | `1` | Venue minimum; below this the call is skipped |
| `--limit` | `12` | Markets to consider |

Prints a receipt per proposed stake, then blocks on a typed `stake`. Typing
`y` is not accepted — the word is required in full. On a non-TTY it refuses
outright unless `--yes` was passed.

Each placed order is journalled to `~/.skin/journal.jsonl` **before** the
outcome is known. That file is what makes the Brier score meaningful.

---

## `skin claim`

**Moves real money.** Redeems settled winnings.

```bash
skin claim
skin claim --yes
```

Lists every `PENDING_CLAIM` position with its payout, then blocks on a typed
`claim`. Redemption is one-way and irreversible.

Winnings are not swept automatically by the venue. An agent that never claims
slowly starves regardless of how good its calls are, so run this whenever
`skin record` shows an unclaimed balance.

---

## `skin positions`

Open positions with time-to-resolution. Read-only.

---

## `skin export`

Writes the whole record as JSON for the dashboard.

```bash
skin export --out web/public/record.json
skin export                        # to stdout
```

---

## `skin doctor`

Runs every read-only wallet call the agent makes and prints the keys Binance
actually returned next to the values that parsed out of them. Places no order
and redeems nothing.

```bash
skin doctor --live
skin doctor --live --deep          # also prices a quote; still no order
```

Run this once before the first live stake. A field that fails to parse shows as
`NULL` in red with the file to fix, which is the difference between a
five-second correction and an evening with a debugger while a market resolves.

---

## `skin mcp`

Serves the record to other agents over MCP, on stdio.

```bash
claude mcp add skin -- npx tsx src/cli/index.ts mcp --demo
```

Eight tools, all read-only: `skin_record`, `skin_calibration`, `skin_slips`,
`skin_positions`, `skin_unclaimed`, `skin_scan`, `skin_opinion`, `skin_propose`.

There is deliberately no `skin_stake` tool. `skin_propose` sizes a stake and
returns the command that would place it; a human has to run that command and
type the confirmation word. See [the README](../../README.md#skin-as-an-mcp-server).

---

## Global flags

| Flag | Meaning |
|---|---|
| `--demo` | Bundled fixtures. No wallet, no network, no money. |
| `--live` | Force the real wallet. Errors if `baw` is absent. |
| `--json` | Machine-readable output. |
| `--mcp-data <path>` | Klines fetched through the Binance MCP Server. |
| `--deep` | `doctor` only: also price a quote. Still places no order. |

Mode is printed as a banner on every command. If you cannot see which mode
produced a number, do not report the number.

---

## The `baw` commands underneath

For debugging, or to verify what the CLI did:

```bash
baw prediction market list --json
baw prediction market detail --marketTopicId <id> --json
baw prediction market last-trade-price --marketId <id> --json
baw prediction position list --tab ONGOING --json
baw prediction position list --tab PENDING_CLAIM --json
baw prediction position settled-history --filter all --json
baw prediction position pnl --json
baw prediction order history --json
baw prediction trade quote --binanceChainId 56 --tokenId <id> --marketTopicId <id> --side BUY --amount 1 --orderType MARKET --json
baw prediction trade place-order --quoteId <id> --slippageBps 1000 --json
baw prediction trade redeem --tokenIds <id> --json
```

`skin` composes these; it does not replace them. Every number it prints can be
traced back to one of these calls.
