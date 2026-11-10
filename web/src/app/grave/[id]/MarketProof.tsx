"use client";

import { CHAINS, shortAddress, type ChainId } from "@/core/chains";
import { MPC_SIGNER, nearAccountUrl, type MarketReadingJson, type PoolBindingJson } from "@/core/near";
import { ago, usd } from "@/lib/format";

/** Rite checks whose numbers come from the MPC-read pool, not the coroner. */
export const MPC_READ_CHECKS = new Set(["liquidity", "marketCap"]);

/**
 * Provenance for a plot whose market the NEAR MPC network reads from Solana:
 * which pool, what it read, and the payload hash the MPC network signed.
 */
export function MarketProof({ chain, binding, reading }: { chain: ChainId; binding: PoolBindingJson; reading: MarketReadingJson | null }) {
  const ch = CHAINS[chain];
  const price = reading ? Number(BigInt(reading.price_usd_e18)) / 1e18 : 0;
  return (
    <div className="mt-6 rounded-[14px] border border-alive/30 bg-loam/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-alive">
          <span className="inline-block h-2 w-2 rounded-full bg-alive" aria-hidden />
          Market read by NEAR MPC
        </div>
        {reading && <span className="text-xs text-bone-4">last read {ago(reading.at)}</span>}
      </div>
      <p className="mt-1.5 max-w-xl text-xs text-bone-3">
        Liquidity, price and market cap don&rsquo;t come from the coroner. NEAR&rsquo;s MPC network reads this Raydium pool, its vaults and the
        token&rsquo;s mint straight from {ch.name}, and the contract computes the numbers itself. Volume and trader counts are still reported by the
        coroner{chain.endsWith("devnet") ? " (simulated on testnet)" : ""}.
      </p>
      {reading && (
        <dl className="mt-4 grid grid-cols-3 gap-3">
          {[
            ["Liquidity", usd(Number(reading.liquidity_usd))],
            ["Price", price > 0 && price < 0.01 ? `$${price.toPrecision(3)}` : usd(price, { precise: true })],
            ["Market cap", usd(Number(reading.market_cap_usd))],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="eyebrow">{k}</dt>
              <dd className="mt-0.5 text-base font-semibold tabular text-bone">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <dl className="mt-4 space-y-1.5 text-xs">
        {[
          ["Pool", <a key="p" className="font-mono text-ember hover:underline" href={ch.explorer.address(binding.pool)} target="_blank" rel="noreferrer">{shortAddress(binding.pool, 6, 6)} ↗</a>],
          ["Quote", <a key="q" className="font-mono text-ember hover:underline" href={ch.explorer.address(binding.quote_mint)} target="_blank" rel="noreferrer">{shortAddress(binding.quote_mint, 6, 6)} ↗</a>],
          ...(reading
            ? [
                ["Anchor tx", <a key="a" className="font-mono text-ember hover:underline" href={ch.explorer.tx(reading.anchor_tx)} target="_blank" rel="noreferrer">{shortAddress(reading.anchor_tx, 6, 6)} ↗</a>],
                ["MPC payload", <span key="h" className="break-all font-mono text-bone-2">sha256 {reading.proof_hash}</span>],
              ]
            : []),
          ["Signer", <a key="s" className="font-mono text-ember hover:underline" href={nearAccountUrl(MPC_SIGNER)} target="_blank" rel="noreferrer">{MPC_SIGNER} ↗</a>],
        ].map(([k, v]) => (
          <div key={k as string} className="grid grid-cols-[92px_1fr] gap-2">
            <dt className="text-bone-4">{k}</dt>
            <dd className="min-w-0">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
