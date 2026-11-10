/**
 * Testnet Séance: walk a testnet plot through the resurrection rite on
 * compressed timers. Disabled on mainnet. The contract applies every rule.
 *
 * Two kinds of plot:
 *  - Simulated market: the coroner reports *simulated* recovery vitals.
 *  - Real pool (e.g. $NGMI/tUSDC on Raydium devnet): the first reading binds
 *    the pool while it's still dead. Then the séance revives it with real
 *    trades (buys, then returning liquidity). From then on liquidity, price
 *    and market cap are read from Solana by the NEAR MPC network. The coroner
 *    reports only volume and trader counts, which are simulated on testnet.
 */
import type { ContractChain } from "@/core/near";
import { NETWORK, registry } from "@/core/near";
import { falseDawnObservation, seanceObservation } from "@/core/testnet";
import { BurialError } from "@/server/burial";
import { knownPool, observeMarket, readPoolAccounts } from "@/server/market";
import { body, fail, ok } from "@/server/respond";
import { revivePool } from "@/server/revive";
import { callContractRaw, parseEvents } from "@/server/sexton";

export const maxDuration = 60;
const MIN_SPACING_S = 55;
/** What "back from the dead" means for a test pool: $0.0006 a token, $120k of liquidity. */
const REVIVE_TARGET = { priceUsd: 0.0006, quoteUsd: 60_000 };

function quoteReserveUsd(vaultBase64: string): number {
  const d = Buffer.from(vaultBase64, "base64");
  return Number(d.readBigUInt64LE(64)) / 1e6;
}

export async function POST(req: Request) {
  try {
    if (NETWORK !== "testnet") throw new BurialError("The séance only runs on testnet.", "MAINNET");
    const { plotId, mode } = await body<{ plotId: string; mode: "revive" | "false-dawn" }>(req);
    const plot = await registry.plot(plotId);
    if (!plot) throw new BurialError("Plot not found.", "NOT_FOUND", 404);
    if (!plot.chain.endsWith("devnet") && !plot.chain.endsWith("sepolia")) throw new BurialError("Testnet plots only.", "MAINNET");
    if (plot.state.kind === "RISEN") return ok({ state: plot.state, skipped: "already risen" });
    const now = Math.floor(Date.now() / 1000);
    const last = plot.last_observation ? Number(plot.last_observation.t) : 0;
    if (now - last < MIN_SPACING_S) {
      return ok({ state: plot.state, skipped: `next observation in ${MIN_SPACING_S - (now - last)}s`, waitSeconds: MIN_SPACING_S - (now - last) });
    }
    const step = plot.state.kind === "STIRRING" ? plot.state.count : 0;
    const observation = mode === "false-dawn" ? falseDawnObservation(now) : seanceObservation(Number(plot.baseline_mcap_usd), step, now);

    const binding = await registry.poolBinding(plotId);
    const pool = binding?.pool ?? knownPool(plot.chain as ContractChain, plot.symbol);
    if (pool) {
      // Bound and still dead: revive the real pool before the next reading.
      if (binding && mode === "revive") {
        const { accounts, quoteMint } = await readPoolAccounts(plot.chain as ContractChain, pool, plot.token);
        if (quoteReserveUsd(accounts[2].data) < REVIVE_TARGET.quoteUsd * 0.9) {
          const r = await revivePool(pool, quoteMint, REVIVE_TARGET);
          return ok({ state: plot.state, revived: r.txs, pool: r.after, waitSeconds: 20, transition: "PoolRevived" });
        }
      }
      const m = await observeMarket(plotId, plot.chain as ContractChain, plot.token, pool, observation);
      const after = await registry.plot(plotId);
      const verified = m.events.find((e) => e.event === "market_verified")?.data;
      return ok({
        state: after?.state,
        transition: m.events.find((e) => e.event === "observation")?.data.transition ?? (m.verified ? undefined : "MarketUnverified"),
        risen: m.events.some((e) => e.event === "risen"),
        bound: m.events.some((e) => e.event === "pool_bound"),
        market: verified ?? null,
        nearTx: m.nearTx,
      });
    }

    const res = await callContractRaw("observe", { plot_id: plotId, observation }, 50);
    const ev = parseEvents(res.logs);
    const after = await registry.plot(plotId);
    return ok({
      state: after?.state,
      transition: ev.find((e) => e.event === "observation")?.data.transition,
      risen: ev.some((e) => e.event === "risen"),
      nearTx: res.hash,
      observation,
    });
  } catch (e) {
    return fail(e);
  }
}
