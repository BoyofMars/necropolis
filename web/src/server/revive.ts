/**
 * Testnet only: bring a test bag's real Raydium pool back to life, the way a
 * comeback looks on-chain. Buyers push the price up, then liquidity returns.
 * The Sexton funds it with tUSDC it mints on devnet. Nothing here is simulated:
 * the pool, swaps and deposits are real devnet transactions, and the coroner
 * never reports the resulting numbers. The NEAR MPC network reads them.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import BN from "bn.js";
import { revivalPlan, type ReviveTarget } from "@/core/revival";
import { solanaRpcUrl } from "./providers";
import { sextonSolana } from "./sexton";

export async function revivePool(poolId: string, quoteMint: string, target: ReviveTarget) {
  const { Raydium, TxVersion, Percent } = await import("@raydium-io/raydium-sdk-v2");
  const conn = new Connection(solanaRpcUrl("sol-devnet"), "confirmed");
  const sexton = sextonSolana();
  const raydium = await Raydium.load({
    owner: sexton,
    connection: conn,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
  });
  const load = () => raydium.cpmm.getPoolInfoFromRpc(poolId);
  let p = await load();
  const quoteIsA = p.poolInfo.mintA.address === quoteMint;
  const qDec = quoteIsA ? p.poolInfo.mintA.decimals : p.poolInfo.mintB.decimals;
  const tDec = quoteIsA ? p.poolInfo.mintB.decimals : p.poolInfo.mintA.decimals;
  const tokenMint = quoteIsA ? p.poolInfo.mintB.address : p.poolInfo.mintA.address;
  const state = () => {
    const q = Number((quoteIsA ? p.rpcData.baseReserve : p.rpcData.quoteReserve).toString()) / 10 ** qDec;
    const t = Number((quoteIsA ? p.rpcData.quoteReserve : p.rpcData.baseReserve).toString()) / 10 ** tDec;
    return { quoteUsd: q, tokenReserve: t, priceUsd: q / t };
  };
  const plan = revivalPlan(state(), target);
  const quoteAta = await getOrCreateAssociatedTokenAccount(conn, sexton, new PublicKey(quoteMint), sexton.publicKey);
  const need = BigInt(Math.ceil((plan.buyUsd + plan.depositUsd) * 1.05 * 10 ** qDec));
  if (quoteAta.amount < need) await mintTo(conn, sexton, new PublicKey(quoteMint), quoteAta.address, sexton, need - quoteAta.amount);

  const txs: string[] = [];
  if (plan.buyUsd > 0) {
    const amountIn = new BN(Math.floor(plan.buyUsd * 10 ** qDec).toString());
    const quote = raydium.cpmm.computeSwapAmount({ pool: p.computePoolInfo, amountIn, outputMint: tokenMint, slippage: 0.01 });
    const { execute } = await raydium.cpmm.swap({
      poolInfo: p.poolInfo,
      poolKeys: p.poolKeys,
      inputAmount: amountIn,
      swapResult: quote.swapResult,
      slippage: 0.01,
      baseIn: quoteIsA,
      txVersion: TxVersion.V0,
    });
    txs.push((await execute({ sendAndConfirm: true })).txId);
    p = await load();
  }
  const depositUsd = target.quoteUsd - state().quoteUsd;
  if (depositUsd > 1) {
    const { execute } = await raydium.cpmm.addLiquidity({
      poolInfo: p.poolInfo,
      poolKeys: p.poolKeys,
      inputAmount: new BN(Math.floor(depositUsd * 10 ** qDec).toString()),
      baseIn: quoteIsA,
      slippage: new Percent(1, 100),
      txVersion: TxVersion.V0,
    });
    txs.push((await execute({ sendAndConfirm: true })).txId);
    p = await load();
  }
  return { txs, before: plan, after: state() };
}
