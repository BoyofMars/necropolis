/**
 * The burial pipeline (server side).
 *
 *  prepare  → eligibility, appraisal, grave address (derived offline AND
 *             cross-checked against the MPC network), unsigned transaction
 *  submit   → (Solana) relay the user-signed, Sexton-fee-paid transaction
 *  confirm  → wait for origin-chain finality, then call `bury` on NEAR, where
 *             the MPC network verifies the deposit before the grave is minted
 *
 * Every step is idempotent: confirm can be called repeatedly and after a page
 * refresh; a deposit can only ever become one grave.
 */
import {
  Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createPublicClient, encodeFunctionData, erc20Abi, http, parseAbiItem, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { appraise, eligibility } from "@/core/appraisal";
import type { ChainId } from "@/core/chains";
import { CHAINS, normalizeToken } from "@/core/chains";
import { diagnose } from "@/core/death";
import { deriveAddress } from "@/core/derivation";
import { CONTRACT_ID, NETWORK, derivedPublicKey, gravePath, plotId, registry, type ContractChain } from "@/core/near";
import { getDossier } from "./dossier";
import { solanaRpcUrl } from "./providers";
import { callContractRaw, parseEvents, sextonSolana } from "./sexton";

export class BurialError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

function evmClient(chain: ChainId) {
  return chain === "base"
    ? createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) })
    : createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });
}

function solConn(chain: ChainId) {
  return new Connection(solanaRpcUrl(chain as "sol" | "sol-devnet"), "confirmed");
}

/** Grave address: derived offline, then confirmed with the MPC network. Refuses on mismatch. */
export async function graveAddress(chain: ChainId, path: string): Promise<string> {
  const family = CHAINS[chain].family;
  const offline = deriveAddress(family, NETWORK, CONTRACT_ID, path);
  const key = await derivedPublicKey(path, family === "solana" ? 1 : 0);
  let mpc: string;
  if (family === "solana") mpc = key.replace(/^ed25519:/, "");
  else {
    const { keccak_256 } = await import("@noble/hashes/sha3.js");
    const bs58 = (await import("bs58")).default;
    const raw = bs58.decode(key.replace(/^secp256k1:/, ""));
    const xy = raw.length === 65 ? raw.slice(1) : raw;
    mpc = `0x${Buffer.from(keccak_256(xy).slice(12)).toString("hex")}`;
  }
  if (mpc.toLowerCase() !== offline.toLowerCase()) {
    throw new BurialError("Grave address derivation mismatch. Refusing to continue.", "DERIVATION_MISMATCH", 500);
  }
  return offline;
}

export interface PrepareInput {
  chain: ChainId;
  token: string;
  owner: string;
  /** raw integer amount */
  amount: string;
}

export async function prepareBurial(input: PrepareInput) {
  const ref = normalizeToken(input.chain, input.token);
  const chain = ref.chain;
  const info = CHAINS[chain];
  if (info.network !== NETWORK) throw new BurialError(`Burials on ${info.name} are not open on this deployment.`, "WRONG_NETWORK");
  const owner = info.family === "evm" ? input.owner.toLowerCase() : input.owner;
  const amount = BigInt(input.amount);
  if (amount <= 0n) throw new BurialError("Choose an amount to bury.", "ZERO_AMOUNT");

  const dossier = await getDossier(chain, ref.address, { history: true, safety: true });
  const d = diagnose(dossier);
  const plot = await registry.plot(plotId(chain as ContractChain, ref.address)).catch(() => null);
  const el = eligibility(d, dossier, plot?.state.kind);
  if (!el.ok) throw new BurialError(el.reason, el.code);

  const nonce = Math.floor(Math.random() * 2 ** 31);
  const path = gravePath(chain as ContractChain, ref.address, owner, nonce);
  const grave = await graveAddress(chain, path);

  if (info.family === "solana") {
    const conn = solConn(chain);
    const mint = new PublicKey(ref.address);
    const ownerPk = new PublicKey(owner);
    const mintInfo = await conn.getAccountInfo(mint);
    if (!mintInfo) throw new BurialError("This mint does not exist on this network.", "NO_MINT");
    const program = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const decimals = mintInfo.data[44];
    const accounts = await conn.getParsedTokenAccountsByOwner(ownerPk, { mint });
    const source = accounts.value
      .map((a) => ({ pubkey: a.pubkey, amount: BigInt(a.account.data.parsed.info.tokenAmount.amount as string) }))
      .sort((a, b) => (b.amount > a.amount ? 1 : -1))[0];
    if (!source || source.amount < amount) throw new BurialError("You don't hold that many tokens.", "INSUFFICIENT_BALANCE");
    const gravePk = new PublicKey(grave);
    const graveAta = getAssociatedTokenAddressSync(mint, gravePk, true, program);
    const sexton = sextonSolana();
    const ixs: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(sexton.publicKey, graveAta, gravePk, mint, program),
      createTransferCheckedInstruction(source.pubkey, mint, graveAta, ownerPk, amount, decimals, [], program),
    ];
    const userAta = getAssociatedTokenAddressSync(mint, ownerPk, false, program);
    const burysAll = source.amount === amount && source.pubkey.equals(userAta);
    if (burysAll) ixs.push(createCloseAccountInstruction(source.pubkey, ownerPk, ownerPk, [], program));
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("finalized");
    const tx = new Transaction({ feePayer: sexton.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    tx.partialSign(sexton);
    const uiAmount = Number(amount) / 10 ** decimals;
    const ap = appraise(dossier, d, uiAmount, decimals, !plot);
    return {
      chain,
      token: ref.address,
      owner,
      nonce,
      path,
      graveAddress: grave,
      graveTokenAccount: graveAta.toBase58(),
      decimals,
      amount: amount.toString(),
      closesAccount: burysAll,
      solanaTx: tx.serialize({ requireAllSignatures: false }).toString("base64"),
      lastValidBlockHeight,
      appraisal: { valueUsd: ap.valueUsd, weightUsd: ap.weightUsd, priceUsd: ap.priceUsd, capUsd: ap.capUsd },
      eligibility: el,
      diagnosis: { condition: d.condition, deathScore: d.deathScore, headline: d.headline },
      opensPlot: !plot,
    };
  }

  // EVM (Base)
  const client = evmClient(chain);
  const [decimals, balance] = await Promise.all([
    client.readContract({ address: ref.address as Hex, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: ref.address as Hex, abi: erc20Abi, functionName: "balanceOf", args: [owner as Hex] }),
  ]);
  if (balance < amount) throw new BurialError("You don't hold that many tokens.", "INSUFFICIENT_BALANCE");
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [grave as Hex, amount] });
  const uiAmount = Number(amount) / 10 ** decimals;
  const ap = appraise(dossier, d, uiAmount, decimals, !plot);
  return {
    chain,
    token: ref.address,
    owner,
    nonce,
    path,
    graveAddress: grave,
    decimals,
    amount: amount.toString(),
    evmTx: { to: ref.address, data, chainId: info.evmChainId },
    appraisal: { valueUsd: ap.valueUsd, weightUsd: ap.weightUsd, priceUsd: ap.priceUsd, capUsd: ap.capUsd },
    eligibility: el,
    diagnosis: { condition: d.condition, deathScore: d.deathScore, headline: d.headline },
    opensPlot: !plot,
  };
}

/** Relay a user-signed Solana burial transaction (fee payer already signed). */
export async function submitSolana(chain: ChainId, txBase64: string): Promise<string> {
  const conn = solConn(chain);
  const raw = Buffer.from(txBase64, "base64");
  const tx = Transaction.from(raw);
  const sexton = sextonSolana();
  if (!tx.feePayer?.equals(sexton.publicKey)) throw new BurialError("Unexpected fee payer.", "BAD_TX");
  if (!tx.verifySignatures(true)) throw new BurialError("The transaction is missing a signature.", "UNSIGNED");
  return conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed" });
}

export interface ConfirmInput {
  chain: ChainId;
  token: string;
  owner: string;
  nonce: number;
  amount: string;
  tx: string;
  epitaph?: string;
}

export type ConfirmResult =
  | { stage: "finalizing"; detail: string }
  | { stage: "verifying"; detail: string }
  | { stage: "buried"; graveId: number; nearTx?: string }
  | { stage: "failed"; reason: string; nearTx?: string };

export async function confirmBurial(input: ConfirmInput): Promise<ConfirmResult> {
  const ref = normalizeToken(input.chain, input.token);
  const chain = ref.chain;
  const info = CHAINS[chain];
  const owner = info.family === "evm" ? input.owner.toLowerCase() : input.owner;
  const path = gravePath(chain as ContractChain, ref.address, owner, input.nonce);

  const existing = await registry.graveIdForPath(path);
  if (existing !== null && existing !== undefined) return { stage: "buried", graveId: existing };

  const grave = await graveAddress(chain, path);
  let deposit: Record<string, unknown>;
  let rawAmount: bigint;
  let decimals: number;

  if (info.family === "solana") {
    const conn = solConn(chain);
    const st = await conn.getSignatureStatus(input.tx, { searchTransactionHistory: true });
    const s = st.value;
    if (!s) return { stage: "finalizing", detail: "Waiting for Solana to see the transaction…" };
    if (s.err) return { stage: "failed", reason: `The Solana transaction failed: ${JSON.stringify(s.err)}` };
    if (s.confirmationStatus !== "finalized") return { stage: "finalizing", detail: "Waiting for Solana finality (≈13 s)…" };
    const mint = new PublicKey(ref.address);
    const mintInfo = await conn.getAccountInfo(mint, "finalized");
    const program = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    decimals = mintInfo?.data[44] ?? 0;
    const ata = getAssociatedTokenAddressSync(mint, new PublicKey(grave), true, program);
    const acc = await conn.getAccountInfo(ata, "finalized");
    if (!acc) return { stage: "failed", reason: "The grave's token account does not exist. Nothing was buried." };
    rawAmount = acc.data.readBigUInt64LE(64);
    deposit = {
      kind: "solana",
      tx_signature: input.tx,
      token_account: ata.toBase58(),
      account_program: acc.owner.toBase58(),
      account_data_hex: Buffer.from(acc.data).toString("hex"),
    };
  } else {
    const client = evmClient(chain);
    const receipt = await client.getTransactionReceipt({ hash: input.tx as Hex }).catch(() => null);
    if (!receipt) return { stage: "finalizing", detail: "Waiting for Base to include the transaction…" };
    if (receipt.status !== "success") return { stage: "failed", reason: "The Base transaction reverted." };
    const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
    const log = receipt.logs.find(
      (l) =>
        l.address.toLowerCase() === ref.address &&
        l.topics.length === 3 &&
        `0x${l.topics[2]!.slice(26)}`.toLowerCase() === grave.toLowerCase(),
    );
    if (!log) return { stage: "failed", reason: "No transfer to the grave address was found in that transaction." };
    void transfer;
    const safe = await client.getBlock({ blockTag: "safe" });
    if (receipt.blockNumber > safe.number) {
      return { stage: "finalizing", detail: `Waiting for Base to post this block to Ethereum (${Number(receipt.blockNumber - safe.number)} blocks to go)…` };
    }
    decimals = await client.readContract({ address: ref.address as Hex, abi: erc20Abi, functionName: "decimals" });
    rawAmount = BigInt(log.data);
    deposit = {
      kind: "evm",
      log: {
        removed: false,
        log_index: String(log.logIndex),
        transaction_index: String(log.transactionIndex),
        transaction_hash: log.transactionHash,
        block_hash: log.blockHash,
        block_number: String(log.blockNumber),
        address: log.address.toLowerCase(),
        data: log.data,
        topics: log.topics,
      },
    };
  }

  const pending = await registry.graveIdForPath(path);
  if (pending !== null && pending !== undefined) return { stage: "buried", graveId: pending };

  const dossier = await getDossier(chain, ref.address, { history: true, safety: false });
  const d = diagnose(dossier);
  const plot = await registry.plot(plotId(chain as ContractChain, ref.address)).catch(() => null);
  const ap = appraise(dossier, d, Number(rawAmount) / 10 ** decimals, decimals, !plot);
  const epitaph = input.epitaph?.trim().slice(0, 140) || null;
  try {
    const res = await callContractRaw("bury", {
      args: {
        chain,
        token: ref.address,
        origin_owner: owner,
        nonce: input.nonce,
        deposit,
        appraisal: ap.json,
        epitaph,
      },
    });
    const events = parseEvents(res.logs);
    const burial = events.find((e) => e.event === "burial");
    if (burial) return { stage: "buried", graveId: Number(burial.data.grave_id), nearTx: res.hash };
    const failed = events.find((e) => e.event === "burial_failed");
    if (failed) return { stage: "failed", reason: String(failed.data.reason), nearTx: res.hash };
    const again = await registry.graveIdForPath(path);
    if (again !== null && again !== undefined) return { stage: "buried", graveId: again, nearTx: res.hash };
    return { stage: "failed", reason: "NEAR did not register the burial.", nearTx: res.hash };
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("already registered") || msg.includes("already been used")) {
      return { stage: "verifying", detail: "NEAR is already verifying this burial…" };
    }
    return { stage: "failed", reason: `NEAR registration failed: ${msg.slice(0, 240)}` };
  }
}
