// Dip-and-trend bot for CBBTC/USDC, long only, one position at a time.
//
// Idea, in plain terms: one-minute BTC prices are mostly noise (a typical
// minute moves about 7 bps, while a full round trip costs about 26 bps in
// fees, slippage and impact), so this bot does not trade every minute. It
// watches the market on a 30-minute clock and only buys in two situations
// that both have to clear a much larger move than the cost of trading:
//
//   1. Trend: the fast EMA (3 samples) of 30-minute closes crosses above
//      the slow EMA (8 samples). The trend has to be turning up on the
//      half-hour scale, not just ticking up for a minute.
//   2. Sharp dip: the price fell at least 1.5% over the last 30 minutes.
//      A fast drop like that usually snaps back at least partway, and the
//      bot buys the dip instead of chasing the fall.
//
// Either entry spends all of the cash on CBBTC. Every position is exited
// whole, on the first of: the position is worth 2% more than it cost
// (take profit), 1% less than it cost (stop loss), or the 30-minute trend
// crosses back down. The profit target is deliberately larger than the
// round-trip cost, and the stop is tighter than the target, so a trade that
// is wrong loses about half what a trade that is right gains.
//
// Everything is deterministic: the EMAs run in float64 on the closes the
// harness sends, there is no randomness, no wall clock and no network, so
// two runs on the same bars send the same orders. Orders are decided on a
// bar's close and fill at the next bar's open, with max_slippage_bps 100
// (1%) so a fill far past the close it was decided on is refused rather
// than filled at a bad price.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** One bar of the 30-minute clock: every 30th one-minute bar is sampled. */
const SAMPLE_EVERY = 30;
/** EMA spans, counted in 30-minute samples. */
const FAST_SPAN = 3;
const SLOW_SPAN = 8;
/** Buy the dip when the close fell this far over the last 30 minutes. */
const DIP_RETURN = -0.015;
/** Exit when the position is worth 102% of its cost (take profit). */
const TAKE_PROFIT_NUM = 102n;
/** Exit when the position is worth 99% of its cost (stop loss). */
const STOP_LOSS_NUM = 99n;
/** Refuse a fill more than 1% past the close the order was decided on. */
const MAX_SLIPPAGE_BPS = 100;

/** One EMA over the sampled closes: the mean of its first span, then the usual update. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

function stepEma(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) {
    e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
  }
}

const fast: Ema = { span: FAST_SPAN, warm: [], value: null };
const slow: Ema = { span: SLOW_SPAN, warm: [], value: null };
/** fast minus slow after the previous sampled bar, once both EMAs are set. */
let previousGap: number | null = null;
/** The last 31 one-minute closes, oldest first, for the 30-minute return. */
const recentCloses: number[] = [];
let barsSeen = 0;
/** True on a sampled bar where the fast EMA crossed above the slow one. */
let crossedUp = false;
/** True on a sampled bar where the fast EMA crossed below the slow one. */
let crossedDown = false;

function onSampledBar(close: number): void {
  stepEma(fast, close);
  stepEma(slow, close);
  crossedUp = false;
  crossedDown = false;
  if (fast.value === null || slow.value === null) {
    previousGap = null;
    return;
  }
  const gap = fast.value - slow.value;
  if (previousGap !== null) {
    if (gap > 0 && previousGap <= 0) crossedUp = true;
    if (gap < 0 && previousGap >= 0) crossedDown = true;
  }
  previousGap = gap;
}

await runBars({
  onBatch(state: BarsState, batch: { bars: Bar[] }) {
    const symbol = 'CBBTC';
    for (const bar of batch.bars) {
      if (bar.symbol !== symbol) continue;
      const close = Number(bar.c);
      recentCloses.push(close);
      if (recentCloses.length > SAMPLE_EVERY + 1) recentCloses.shift();
      barsSeen += 1;
      if (barsSeen % SAMPLE_EVERY === 1) onSampledBar(close);
    }
    // A cross is a signal for this bar only: it must not linger and
    // re-fire on the next twenty-nine bars.
    const up = crossedUp;
    const down = crossedDown;
    crossedUp = false;
    crossedDown = false;
    if (state.warmingUp) return [];

    const held = state.positions.get(symbol);
    if (held !== undefined) {
      const value = state.value(symbol, held.qty);
      if (value * 100n >= held.cost * TAKE_PROFIT_NUM || value * 100n <= held.cost * STOP_LOSS_NUM || down) {
        const order: SellInput = { side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [order];
      }
      return [];
    }

    const dipped =
      recentCloses.length > SAMPLE_EVERY &&
      recentCloses[recentCloses.length - 1]! / recentCloses[0]! - 1 <= DIP_RETURN;
    if (!up && !dipped) return [];

    const { caps, fees } = state.hello;
    const cash = state.cash;
    if (cash < BigInt(fees.min_notional_quote_units)) return [];
    let amount = cash;
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / 10000n;
    if (amount > byWeight) amount = byWeight;
    if (amount < BigInt(fees.min_notional_quote_units)) return [];
    const order: BuyInput = { side: 'buy', symbol, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [order];
  },
});
