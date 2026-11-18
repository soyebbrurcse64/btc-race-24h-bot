# Dip-and-trend BTC bot

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/soyebbrurcse64/btc-race-24h-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/soyebbrurcse64/btc-race-24h-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)

A long-only bot that trades Coinbase Wrapped BTC (CBBTC) against USDC,
minute by minute, in make.fun's `bars-replay/v1` replay, for the bounty
"Race a BTC trading bot live for 24 hours".

## Strategy

One-minute BTC prices are mostly noise: a typical minute moves about
7 bps, while a full round trip costs about 26 bps in fees, slippage and
price impact. So this bot does not trade every minute. It watches the
market on a 30-minute clock and buys only in two situations:

1. **Trend** — the fast EMA (3 samples) of 30-minute closes crosses above
   the slow EMA (8 samples).
2. **Sharp dip** — the price fell at least 1.5% over the last 30 minutes.

Either entry spends all of the cash on CBBTC. Every position is sold in
full on the first of: it is worth 2% more than it cost (take profit),
1% less than it cost (stop loss), or the 30-minute trend crosses back
down. The profit target is larger than the round-trip cost and the stop
is tighter than the target.

## Layout

- `main.ts` — the bot. It speaks `agent-fun/bars-replay/v1` through the
  kit's SDK shim in `vendor/makefun-bars.ts` (a byte-identical copy of the
  kit's shim).
- `vendor/makefun-bars.ts` — the kit's SDK shim, copied unchanged.
- `LICENSE` — MIT.

## Results on the dev window

Graded locally with the kit's own grader
(`node cli/makefun.mjs grade-local --kit <kit> --bot <this repo> --driver process`):

- Net PnL: **+$14.57 USDC** on the 24-hour dev window (starting from
  $1,000), which clears the dev gate (net PnL above $0).
- Trades: 4 fills (2 round trips), max drawdown 1.5%.

The dev window is one 24-hour sample, and the race window is a different,
unseen 24 hours, so this result is not a promise about the race — it is
the honest local grade on the published dev data. The house baselines all
lost money on the same dev window (buy-and-hold −$31.63, momentum −$23.87,
RSI-Bollinger −$39.92, ADX-momentum −$75.57, EMA-cross −$148.17).
