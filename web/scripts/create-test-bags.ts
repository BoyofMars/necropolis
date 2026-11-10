/**
 * Create the Proving Grounds test bags (idempotent).
 *  - Solana devnet: SPL mints, mint authority = Sexton, freeze authority = none
 *  - Base Sepolia: TestBag.sol ERC-20s, minter = Sexton
 * Writes public addresses to src/core/testnet-addresses.json.
 *
 *   npx tsx --env-file=.env.local scripts/create-test-bags.ts [sol|base|all]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import bs58 from "bs58";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { ALL_TEST_BAG_SPECS } from "../src/core/testnet";

const which = process.argv[2] ?? "all";
const outPath = join(process.cwd(), "src/core/testnet-addresses.json");
const deployed = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, string>;
const save = () => writeFileSync(outPath, JSON.stringify(deployed, null, 2) + "\n");

async function solana() {
  const conn = new Connection(process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const sexton = Keypair.fromSecretKey(bs58.decode(process.env.SEXTON_SOLANA_SECRET!));
  const bal = await conn.getBalance(sexton.publicKey);
  console.log(`sexton ${sexton.publicKey.toBase58()} has ${bal / 1e9} devnet SOL`);
  if (bal < 0.05e9) throw new Error("Fund the Sexton with devnet SOL first (faucet.solana.com).");
  for (const b of ALL_TEST_BAG_SPECS.filter((x) => x.chain === "sol-devnet")) {
    const key = `${b.chain}:${b.symbol}`;
    if (deployed[key]) {
      console.log(`= ${key} ${deployed[key]}`);
      continue;
    }
    const mint = await createMint(conn, sexton, sexton.publicKey, null, b.decimals);
    deployed[key] = mint.toBase58();
    save();
    console.log(`+ ${key} ${deployed[key]}`);
  }
}

async function base() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const solc = require("solc");
  const source = readFileSync(join(process.cwd(), "scripts/TestBag.sol"), "utf8");
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "TestBag.sol": { content: source } },
        settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
      }),
    ),
  );
  const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errors.length) throw new Error(JSON.stringify(errors));
  const c = out.contracts["TestBag.sol"].TestBag;
  const account = privateKeyToAccount(process.env.SEXTON_EVM_PRIVATE_KEY as Hex);
  const transport = http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");
  const pub = createPublicClient({ chain: baseSepolia, transport });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const bal = await pub.getBalance({ address: account.address });
  console.log(`sexton ${account.address} has ${Number(bal) / 1e18} Sepolia ETH`);
  if (bal < 1_000_000_000_000_000n / 1000n) throw new Error("Fund the Sexton with Base Sepolia ETH first.");
  for (const b of ALL_TEST_BAG_SPECS.filter((x) => x.chain === "base-sepolia")) {
    const key = `${b.chain}:${b.symbol}`;
    if (deployed[key]) {
      console.log(`= ${key} ${deployed[key]}`);
      continue;
    }
    const hash = await wallet.deployContract({ abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`, args: [b.name, b.symbol] });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    deployed[key] = receipt.contractAddress!.toLowerCase();
    save();
    console.log(`+ ${key} ${deployed[key]}`);
  }
}

(async () => {
  if (which === "sol" || which === "all") await solana().catch((e) => console.error(`solana: ${e.message}`));
  if (which === "base" || which === "all") await base().catch((e) => console.error(`base: ${e.message}`));
})();
