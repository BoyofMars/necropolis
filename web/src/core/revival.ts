/**
 * How a dead constant-product pool comes back: buyers push the price to the
 * target, then liquidity returns at that price. Pure maths for the testnet
 * séance (server/revive.ts executes it on Raydium devnet).
 */
export interface ReviveTarget {
  /** USD per whole token after the buying */
  priceUsd: number;
  /** stablecoin reserve after liquidity returns (liquidity ≈ 2× this) */
  quoteUsd: number;
}

export interface PoolState {
  priceUsd: number;
  quoteUsd: number;
  tokenReserve: number;
}

/** Stable to swap in (fee grossed up), then to deposit, in whole units. */
export function revivalPlan(s: PoolState, target: ReviveTarget, feeRate = 0.0025) {
  const k = s.quoteUsd * s.tokenReserve;
  const quoteAfterBuy = s.priceUsd >= target.priceUsd ? s.quoteUsd : Math.sqrt(k * target.priceUsd);
  const buyUsd = Math.max(0, (quoteAfterBuy - s.quoteUsd) / (1 - feeRate));
  const depositUsd = Math.max(0, target.quoteUsd - quoteAfterBuy);
  return { buyUsd, depositUsd, tokensForDeposit: depositUsd / Math.max(target.priceUsd, s.priceUsd) };
}
