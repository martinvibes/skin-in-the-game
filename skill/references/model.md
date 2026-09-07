# The model

How a conviction becomes a number, and how a number becomes a stake.

There is no language model anywhere in this path. Every figure below is
computed, and can be recomputed from the same inputs by anyone who wants to
check it. That is deliberate: a Brier score is only meaningful if the
probability that produced it came from something stable.

---

## 1. Pricing the claim

Most Binance prediction markets resolve on a price threshold — *will BTC be
above $110,000 at 14:00?* That is a barrier question, and there is a standard
answer to it.

Assume the underlying follows geometric Brownian motion with **zero drift**:

```
P(S_T > K) = Φ(d₂)

           ln(S/K) + (μ − σ²/2)·T
      d₂ = ────────────────────────      with μ = 0
                   σ·√T
```

Zero drift is the honest assumption, not a lazy one. Over a five-minute or
one-hour horizon, any drift term you could estimate is swamped by noise, and
assuming one is how forecasters talk themselves into positions. Setting μ = 0
makes the price a martingale: the model's only real input is volatility.

`Φ` is the standard normal CDF, implemented from an Abramowitz–Stegun `erf`
approximation — accurate to ~1.5×10⁻⁷, far inside the noise floor of anything
this is used for.

## 2. Volatility

Realized volatility from log returns of recent 1-minute klines:

```
rᵢ = ln(Pᵢ / Pᵢ₋₁)
σ  = stdev(r) · √(minutes per year)
```

If fewer than 10 returns are available, `realizedVolatility` returns **null**
and the market is declined with `no-price` rather than priced off a guess. A
model that always produces an answer is a model that is sometimes lying.

## 3. Edge

```
edge = conviction − marketPrice
```

An outcome token trading at 0.62 *is* the market's probability estimate — the
venue quotes belief directly, which is why prediction markets are the cleanest
possible place to score a forecaster. The agent only acts when it disagrees by
more than `MIN_EDGE = 0.04`. Below that the disagreement is inside the model's
own error and betting on it is noise-trading.

## 4. Sizing — Kelly

For a binary outcome token bought at cost `c` with true probability `p`, the
payout is $1 per share, so the odds are:

```
b  = (1 − c) / c
f* = (b·p − q) / b  =  p − (1 − p)·c/(1 − c)          where q = 1 − p
```

`f*` is the fraction of bankroll that maximises the expected log of wealth. It
is zero exactly at `p = c` — when the agent agrees with the market, Kelly tells
it to bet nothing, with no extra rule needed.

**Quarter-Kelly by default.** Full Kelly is optimal only if `p` is exactly
right, and it is not: it is a model output. Kelly is famously brutal under
overestimated edge — the drawdowns compound faster than the growth. A quarter
gives up a little growth for a lot of ruin-avoidance, which is the correct
trade when the edge estimate is the least reliable term in the equation.

## 5. The ceilings

The final stake is the **minimum** of four numbers, and the CLI names which one
bound on every receipt:

| Ceiling | Why |
|---|---|
| Quarter-Kelly stake | The model's own recommendation |
| `--per-call` | No single call can dominate the record |
| Run headroom | `--budget` minus what this run already spent |
| Wallet daily remaining | Set in the Binance app; the agent cannot raise it |

If the winner is below `--min-order`, the call is declined `below-minimum`
rather than rounded up. Rounding a stake up to meet a venue minimum is
inventing conviction the model did not have.

## 6. Conviction bounds

Convictions are clamped to `[0.02, 0.98]`. Past those, the model's own
approximation error is larger than the edge it claims, so the claim is not
worth acting on. A model that says 99.7% is not being confident, it is being
wrong about itself.

---

## Scoring

### Brier score

```
BS = (1/N) · Σ (conviction − actual)²        actual ∈ {0, 1}
```

`0` is perfect. `0.25` is what you score by always saying "50%". Above `0.30`
is worse than a coin flip.

Brier is **strictly proper**: it is minimised only by reporting your true
belief. You cannot improve it by sounding more confident, and you cannot
improve it by hedging everything to 50%. That property is the whole reason it
is the scoreboard here.

It is computed only over calls that were journalled *before* resolution, and
returns `null` — never `0` — when there is nothing to score. Zero would read as
a perfect score.

### Calibration

Convictions are bucketed and each bucket's mean conviction is compared with the
frequency that actually occurred. A well-calibrated forecaster's points sit on
the diagonal: the things it called 70% happen about 70% of the time.

This is the number a hit rate cannot give you. An agent that only bets on
95¢ favourites can post a 90% hit rate while being badly calibrated and
losing money; an agent at 55% can be well calibrated and profitable.

Empty buckets are omitted rather than plotted at zero.

---

## Reading the source

| Concern | File |
|---|---|
| `erf`, `Φ`, `P(S>K)`, title parsing | [`src/engine/analyst.ts`](../../src/engine/analyst.ts) |
| Kelly, edge, the four ceilings | [`src/engine/sizing.ts`](../../src/engine/sizing.ts) |
| Brier, calibration, equity curve | [`src/engine/record.ts`](../../src/engine/record.ts) |
| Realized volatility | [`src/adapters/marketdata.ts`](../../src/adapters/marketdata.ts) |
| The tamper-evident journal | [`src/engine/journal.ts`](../../src/engine/journal.ts) |

All four engine modules are pure and total: no I/O, no clock, no randomness.
That is what makes the 49 unit tests worth anything.
