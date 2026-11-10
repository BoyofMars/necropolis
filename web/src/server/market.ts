/**
 * The coroner's side of MPC-read markets.
 *
 * For a plot bound to a Raydium CPMM pool, the coroner doesn't report
 * liquidity, price or market cap. It hands the contract its copies of four
 * Solana accounts (pool, both vaults, the token's mint) and an anchor
 * transaction. The contract computes the numbers and asks the NEAR MPC network
 * to read the same accounts. If the MPC network sees a different state (the
 * pool traded in between, or the copies were wrong), nothing is applied.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import type { ContractChain } from "@/core/near";
import addresses from "@/core/testnet-addresses.json";
import { solanaRpcUrl } from "./providers";
import { callContractRaw, parseEvents } from "./sexton";

/** Raydium CPMM PoolState offsets (see contract/src/market.rs). */
const OFF = { vaultA: 72, vaultB: 104, mintA: 168, mintB: 200 };

/** Testnet pools created by scripts/create-test-pool.ts, keyed by plot id. */
export function knownPool(chain: ContractChain, symbol: string): string | null {
  return (addresses as Record<string, string>)[`${chain}:${symbol}:pool`] ?? null;
}

function conn(chain: ContractChain) {
  return new Connection(solanaRpcUrl(chain as "sol" | "sol-devnet"), "finalized");
}

/** Read the four accounts at `finalized`, the commitment the MPC network reads at. */
export async function readPoolAccounts(chain: ContractChain, pool: string, token: string) {
  const c = conn(chain);
  const poolKey = new PublicKey(pool);
  const info = await c.getAccountInfo(poolKey, "finalized");
  if (!info) throw new Error("pool account not found");
  const d = info.data;
  const key = (at: number) => new PublicKey(d.subarray(at, at + 32));
  const tokenKey = new PublicKey(token);
  const tokenIsA = key(OFF.mintA).equals(tokenKey);
  if (!tokenIsA && !key(OFF.mintB).equals(tokenKey)) throw new Error("pool does not trade this token");
  const keys = [poolKey, key(tokenIsA ? OFF.vaultA : OFF.vaultB), key(tokenIsA ? OFF.vaultB : OFF.vaultA), tokenKey];
  const { value } = await c.getMultipleAccountsInfoAndContext(keys, "finalized");
  return {
    keys: keys.map((k) => k.toBase58()),
    accounts: value.map((a, i) => {
      if (!a) throw new Error(`account ${keys[i].toBase58()} not found`);
      return { owner: a.owner.toBase58(), data: Buffer.from(a.data).toString("base64") };
    }),
    quoteMint: key(tokenIsA ? OFF.mintB : OFF.mintA).toBase58(),
  };
}

/** Any finalized, successful transaction that touched the pool: the MPC request's anchor. */
async function anchorTx(chain: ContractChain, pool: string): Promise<string> {
  const sigs = await conn(chain).getSignaturesForAddress(new PublicKey(pool), { limit: 20 }, "finalized");
  const ok = sigs.find((s) => !s.err);
  if (!ok) throw new Error("no finalized transaction touches this pool yet");
  return ok.signature;
}

export interface MarketObservation {
  t: string;
  price_usd_e18: string;
  market_cap_usd: string;
  liquidity_usd: string;
  volume_24h_usd: string;
  traders_24h: number;
  flagged_share_bps: number;
  sources: number;
}

/**
 * Submit an MPC-verified market reading. Liquidity, price and market cap in
 * `observation` are ignored by the contract. Retries once if the pool moved
 * between our read and the MPC network's.
 */
export async function observeMarket(plotId: string, chain: ContractChain, token: string, pool: string, observation: MarketObservation) {
  let last: { nearTx: string; verified: boolean; events: ReturnType<typeof parseEvents> } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const [{ accounts }, anchor] = await Promise.all([readPoolAccounts(chain, pool, token), anchorTx(chain, pool)]);
    const res = await callContractRaw("observe_market", { plot_id: plotId, observation, pool, anchor_tx: anchor, accounts }, 300);
    const events = parseEvents(res.logs);
    if (res.failure) {
      const m = JSON.stringify(res.failure);
      throw new Error(m.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? "NEAR rejected the market reading");
    }
    last = { nearTx: res.hash, verified: events.some((e) => e.event === "market_verified"), events };
    if (last.verified) break;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return last!;
}
