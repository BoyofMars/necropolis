/**
 * Ask the NEAR MPC network to read a Raydium CPMM pool on Solana devnet (pool
 * state, both vaults, the token's mint) in ONE foreign-chain request, and check
 * the payload hash it signs against our own borsh encoder. Prints a vector for
 * the contract's tests.
 *
 *   npx tsx --env-file=.env.local scripts/probe-mpc-market.ts [anchorTx]
 */
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { MPC_SIGNER } from "../src/core/near";
import { expectedPayloadHash, verifyArgs, type SvmAccountValue } from "../src/core/foreignTx";
import addresses from "../src/core/testnet-addresses.json";
import { sextonNear } from "../src/server/sexton";

const A = addresses as Record<string, string>;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

(async () => {
  const conn = new Connection(process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com", "finalized");
  const pool = new PublicKey(A["sol-devnet:NGMI:pool"]);
  const poolInfo = await conn.getAccountInfo(pool, "finalized");
  if (!poolInfo) throw new Error("pool not found");
  const d = poolInfo.data;
  const vaultA = new PublicKey(d.subarray(72, 104));
  const vaultB = new PublicKey(d.subarray(104, 136));
  const mintA = new PublicKey(d.subarray(168, 200));
  const keys = [pool, vaultA, vaultB, mintA];
  const infos = await conn.getMultipleAccountsInfo(keys, "finalized");
  const values: SvmAccountValue[] = infos.map((i) => ({ ownerHex: hex(i!.owner.toBytes()), dataHex: hex(i!.data) }));
  console.log("accounts", keys.map((k) => k.toBase58()).join(" "), "sizes", infos.map((i) => i!.data.length).join("/"));

  const anchor = process.argv[2] ?? (await conn.getSignaturesForAddress(pool, { limit: 1 }, "finalized"))[0].signature;
  const req = { chain: "Solana" as const, txSignatureHex: hex(bs58.decode(anchor)), accountsHex: keys.map((k) => hex(k.toBytes())), finality: "Finalized" as const };
  const ours = expectedPayloadHash(req, values);
  console.log("anchor", anchor, "\nour hash", ours);

  const t0 = Date.now();
  const res = await sextonNear().callFunctionRaw({
    contractId: MPC_SIGNER,
    methodName: "verify_foreign_transaction",
    args: verifyArgs(req, ours),
    gas: 300n * 1_000_000_000_000n,
    deposit: 1n,
  });
  const r = res as unknown as { transaction?: { hash?: string }; status?: { SuccessValue?: string; Failure?: unknown } };
  const value = r.status?.SuccessValue ? JSON.parse(Buffer.from(r.status.SuccessValue, "base64").toString()) : null;
  console.log(`MPC answered in ${((Date.now() - t0) / 1000).toFixed(1)}s`, "near tx", r.transaction?.hash);
  console.log("status", r.status?.Failure ? JSON.stringify(r.status.Failure).slice(0, 400) : "ok", value ? JSON.stringify(value).slice(0, 300) : "");
  console.log(JSON.stringify({ vector: { anchor: hex(bs58.decode(anchor)), keys: req.accountsHex, values, hash: ours } }));
})().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
