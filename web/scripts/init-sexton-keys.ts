/**
 * One-time: generate the Sexton's Solana + EVM keys and write web/.env.local.
 * Prints only PUBLIC addresses. Never commit .env.local (it is gitignored).
 *
 *   npx tsx scripts/init-sexton-keys.ts <near-account-id> <path-to-near-credentials-json>
 */
import { Keypair } from "@solana/web3.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import bs58 from "bs58";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [nearAccount, credPath] = process.argv.slice(2);
if (!nearAccount || !credPath) {
  console.error("usage: tsx scripts/init-sexton-keys.ts <near-account> <near-credentials.json>");
  process.exit(1);
}
const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  console.error(".env.local already exists — refusing to overwrite keys.");
  process.exit(1);
}
const cred = JSON.parse(readFileSync(credPath, "utf8")) as { private_key: string; public_key: string };
const sol = Keypair.generate();
const evmKey = generatePrivateKey();
const evm = privateKeyToAccount(evmKey);

const env = [
  "# Bagyard server secrets — DO NOT COMMIT",
  "NEXT_PUBLIC_NETWORK=testnet",
  "NEXT_PUBLIC_CONTRACT_ID=bagyard.testnet",
  "NEXT_PUBLIC_MPC_SIGNER=v1.signer-prod.testnet",
  "NEAR_RPC_URL=https://test.rpc.fastnear.com",
  `SEXTON_NEAR_ACCOUNT=${nearAccount}`,
  `SEXTON_NEAR_PRIVATE_KEY=${cred.private_key}`,
  `SEXTON_SOLANA_SECRET=${bs58.encode(sol.secretKey)}`,
  `SEXTON_EVM_PRIVATE_KEY=${evmKey}`,
  "SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com",
  "BASE_SEPOLIA_RPC_URL=https://sepolia.base.org",
  "",
].join("\n");
writeFileSync(envPath, env, { mode: 0o600 });
console.log(JSON.stringify({ sextonSolana: sol.publicKey.toBase58(), sextonEvm: evm.address, near: nearAccount }, null, 2));
