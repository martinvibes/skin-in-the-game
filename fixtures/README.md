# fixtures

## `klines.example.json`

The shape the CLI expects from `--mcp-data`: the payload an MCP-authenticated
agent produces after calling the Binance MCP Server for candles.

```json
{
  "BTCUSDT": { "interval": "1m", "closes": [109380.2, 109412.5, "…"] },
  "ETHUSDT": { "interval": "1m", "closes": ["…"] }
}
```

Run against it without a wallet, a network, or an MCP session:

```bash
npm run skin -- scan --demo --mcp-data fixtures/klines.example.json
```

Four symbols × 200 one-minute closes. They are a synthetic random walk, not
recorded market data, generated with a seeded LCG so the file is byte-stable
and the volatility it yields is the same on every machine. Each series is
rescaled so its final close is exactly the demo spot — multiplying every price
by a constant is a shift in log space, so the log returns, and therefore the
realized volatility, are untouched.

The targeted annualised vols are BTC 52%, ETH 61%, BNB 58%, SOL 83%.

Two of the five demo markets have a strike equal to the current spot, and the
model prices both at exactly 50%. That is the cheapest available check that the
lognormal is wired up correctly: at the money, over any horizon, a zero-drift
walk is a coin flip.
