/**
 * Proving Grounds faucet (testnet only): mints test bags to a wallet so anyone
 * can try a real burial. Rate-limited per wallet by on-chain balance: if you
 * already hold a test bag, you don't get more of it.
 */
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createWalletClient, createPublicClient, http, parseAbi, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { isEvmAddress, isSolanaAddress } from "@/core/chains";
import { NETWORK } from "@/core/near";
import { TEST_BAGS } from "@/core/testnet";
import { BurialError } from "@/server/burial";
import { solanaRpcUrl } from "@/server/providers";
import { body, fail, ok } from "@/server/respond";
import { sextonEvm, sextonSolana } from "@/server/sexton";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    if (NETWORK !== "testnet") throw new BurialError("The faucet only exists on testnet.", "MAINNET");
    const { sol, evm } = await body<{ sol?: string | null; evm?: string | null }>(req);
    const sent: { chain: string; symbol: string; tx: string }[] = [];
    if (sol && isSolanaAddress(sol)) sent.push(...(await solanaBags(sol)));
    if (evm && isEvmAddress(evm)) sent.push(...(await baseBags(evm.toLowerCase())));
    if (sent.length === 0) throw new BurialError("Nothing to send: you already hold the test bags, or none are deployed for your wallet's chain.", "NOTHING");
    return ok({ sent });
  } catch (e) {
    return fail(e);
  }
}

async function solanaBags(owner: string) {
  const bags = TEST_BAGS.filter((b) => b.chain === "sol-devnet");
  if (bags.length === 0) return [];
  const conn = new Connection(solanaRpcUrl("sol-devnet"), "confirmed");
  const sexton = sextonSolana();
  const ownerPk = new PublicKey(owner);
  const tx = new Transaction();
  const symbols: string[] = [];
  for (const b of bags) {
    const mint = new PublicKey(b.address);
    const ata = getAssociatedTokenAddressSync(mint, ownerPk, false, TOKEN_PROGRAM_ID);
    const bal = await conn.getTokenAccountBalance(ata).catch(() => null);
    if (bal && BigInt(bal.value.amount) > 0n) continue;
    tx.add(createAssociatedTokenAccountIdempotentInstruction(sexton.publicKey, ata, ownerPk, mint, TOKEN_PROGRAM_ID));
    tx.add(createMintToInstruction(mint, ata, sexton.publicKey, BigInt(b.faucetAmount) * 10n ** BigInt(b.decimals), [], TOKEN_PROGRAM_ID));
    symbols.push(b.symbol);
  }
  if (symbols.length === 0) return [];
  const sig = await conn.sendTransaction(tx, [sexton]);
  await conn.confirmTransaction(sig, "confirmed");
  return symbols.map((s) => ({ chain: "sol-devnet", symbol: s, tx: sig }));
}

const ERC20_MINT = parseAbi(["function mint(address to, uint256 amount)", "function balanceOf(address) view returns (uint256)"]);

async function baseBags(owner: string) {
  const bags = TEST_BAGS.filter((b) => b.chain === "base-sepolia");
  if (bags.length === 0) return [];
  const rpc = http(process.env.BASE_SEPOLIA_RPC_URL);
  const pub = createPublicClient({ chain: baseSepolia, transport: rpc });
  const wallet = createWalletClient({ account: sextonEvm(), chain: baseSepolia, transport: rpc });
  const out: { chain: string; symbol: string; tx: string }[] = [];
  for (const b of bags) {
    const bal = await pub.readContract({ address: b.address as Hex, abi: ERC20_MINT, functionName: "balanceOf", args: [owner as Hex] });
    if (bal > 0n) continue;
    const hash = await wallet.writeContract({
      address: b.address as Hex,
      abi: ERC20_MINT,
      functionName: "mint",
      args: [owner as Hex, BigInt(b.faucetAmount) * 10n ** BigInt(b.decimals)],
    });
    await pub.waitForTransactionReceipt({ hash });
    out.push({ chain: "base-sepolia", symbol: b.symbol, tx: hash });
  }
  return out;
}
