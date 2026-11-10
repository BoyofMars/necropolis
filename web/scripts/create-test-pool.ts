/**
 * Give one test bag a real market: a Raydium CPMM pool on Solana devnet,
 * $NGMI against tUSDC (a devnet stablecoin minted by the Sexton). Idempotent.
 *
 * The pool opens at $NGMI's simulated floor price with about $600 of
 * liquidity, so the token is as dead on-chain as its story says. From then on
 * its liquidity, price and market cap are read straight from this pool by the
 * NEAR MPC network, not reported by the coroner.
 *
 *   npx tsx --env-file=.env.local scripts/create-test-pool.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { DEVNET_PROGRAM_ID, Raydium, TxVersion, getCpmmPdaAmmConfigId } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import bs58 from "bs58";

const outPath = join(process.cwd(), "src/core/testnet-addresses.json");
const deployed = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, string>;
const save = () => writeFileSync(outPath, JSON.stringify(deployed, null, 2) + "\n");

const QUOTE_USD = 300; // quote side of the dead pool: total liquidity ≈ $600
const NGMI_PRICE = 0.00031 * 0.002; // NGMI's simulated floor (ATH $0.00031, flatline at 0.2%)

(async () => {
  const conn = new Connection(process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const sexton = Keypair.fromSecretKey(bs58.decode(process.env.SEXTON_SOLANA_SECRET!));
  console.log(`sexton ${sexton.publicKey.toBase58()} has ${(await conn.getBalance(sexton.publicKey)) / 1e9} devnet SOL`);

  // 1. tUSDC: a 6-decimal devnet stablecoin, priced at $1 by definition on testnet.
  if (!deployed["sol-devnet:tUSDC"]) {
    const m = await createMint(conn, sexton, sexton.publicKey, null, 6);
    deployed["sol-devnet:tUSDC"] = m.toBase58();
    save();
    console.log(`+ tUSDC ${m.toBase58()}`);
  }
  const tusdc = new PublicKey(deployed["sol-devnet:tUSDC"]);
  const ngmi = new PublicKey(deployed["sol-devnet:NGMI"]);

  if (deployed["sol-devnet:NGMI:pool"]) {
    console.log(`= pool ${deployed["sol-devnet:NGMI:pool"]}`);
    return;
  }

  // 2. Seed the Sexton with both sides.
  const quoteRaw = BigInt(QUOTE_USD) * 10n ** 6n;
  const ngmiRaw = BigInt(Math.round(QUOTE_USD / NGMI_PRICE)) * 10n ** 6n;
  for (const [mint, amount] of [
    [tusdc, quoteRaw],
    [ngmi, ngmiRaw],
  ] as const) {
    const ata = await getOrCreateAssociatedTokenAccount(conn, sexton, mint, sexton.publicKey);
    if (ata.amount < amount) await mintTo(conn, sexton, mint, ata.address, sexton, amount - ata.amount);
  }

  // 3. Create the CPMM pool with devnet program ids. Published fee-config ids
  //    are mainnet PDAs, so re-derive them from the devnet program.
  const raydium = await Raydium.load({ owner: sexton, connection: conn, cluster: "devnet", disableFeatureCheck: true, disableLoadToken: true, blockhashCommitment: "finalized" });
  const configs = await raydium.api.getCpmmConfigs();
  const feeConfig = { ...configs[0], id: getCpmmPdaAmmConfigId(DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM, configs[0].index).publicKey.toBase58() };
  const { execute, extInfo } = await raydium.cpmm.createPool({
    programId: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
    poolFeeAccount: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC,
    mintA: { address: ngmi.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(), decimals: 6 },
    mintB: { address: tusdc.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(), decimals: 6 },
    mintAAmount: new BN(ngmiRaw.toString()),
    mintBAmount: new BN(quoteRaw.toString()),
    startTime: new BN(0),
    feeConfig,
    associatedOnly: false,
    ownerInfo: { useSOLBalance: true },
    txVersion: TxVersion.V0,
  });
  const { txId } = await execute({ sendAndConfirm: true });
  const a = extInfo.address;
  deployed["sol-devnet:NGMI:pool"] = a.poolId.toBase58();
  save();
  console.log(JSON.stringify({ txId, pool: a.poolId.toBase58(), vaultA: a.vaultA.toBase58(), vaultB: a.vaultB.toBase58(), mintA: a.mintA.address, mintB: a.mintB.address, feeConfig: feeConfig.id }, null, 2));
})().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
