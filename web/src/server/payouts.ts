/**
 * Turn MPC signatures stored on NEAR into broadcast transactions.
 *
 * The contract built every byte that was signed. This module only assembles
 * signed transactions and sends them. Signatures are public contract state, so
 * anyone could do the same; the Sexton just does it for convenience.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { createPublicClient, createWalletClient, http, parseTransaction, serializeTransaction, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { ChainId } from "@/core/chains";
import { CHAINS } from "@/core/chains";
import { registry, type SignedPayoutJson } from "@/core/near";
import { BurialError } from "./burial";
import { solanaRpcUrl } from "./providers";
import { callContractRaw, parseEvents, sextonEvm, sextonSolana } from "./sexton";

const viemChain = (c: ChainId) => (c === "base" ? base : baseSepolia);
const evmRpc = (c: ChainId) => (c === "base" ? process.env.BASE_RPC_URL : process.env.BASE_SEPOLIA_RPC_URL);

function compactU16(n: number): number[] {
  const out: number[] = [];
  let v = n;
  for (;;) {
    let b = v & 0x7f;
    v >>= 7;
    if (v) b |= 0x80;
    out.push(b);
    if (!v) break;
  }
  return out;
}

/** Assemble a Solana legacy tx: [fee payer sig, ...MPC sigs] + message. */
export function assembleSolana(messageHex: string, mpcSignatures: number[][]): Buffer {
  const msg = Buffer.from(messageHex, "hex");
  const sexton = sextonSolana();
  const feePayerSig = ed25519.sign(msg, sexton.secretKey.slice(0, 32));
  const sigs = [Buffer.from(feePayerSig), ...mpcSignatures.map((s) => Buffer.from(s))];
  const numRequired = msg[0];
  if (sigs.length !== numRequired) throw new BurialError(`Expected ${numRequired} signatures, have ${sigs.length}.`, "SIG_COUNT", 500);
  return Buffer.concat([Buffer.from(compactU16(sigs.length)), ...sigs, msg]);
}

function parseMpcSig(json: string): { scheme: string; signature?: number[]; big_r?: { affine_point: string }; s?: { scalar: string }; recovery_id?: number } {
  const v = JSON.parse(json);
  return typeof v === "string" ? JSON.parse(v) : v;
}

export async function broadcastPayout(p: SignedPayoutJson): Promise<string[]> {
  if (!p.signed_at || p.signatures.length === 0) throw new BurialError("This payout has not been signed yet.", "UNSIGNED", 409);
  const chain = p.chain as ChainId;
  if (CHAINS[chain].family === "solana") {
    const sigs = p.signatures.map((s) => parseMpcSig(s).signature as number[]);
    const raw = assembleSolana(p.unsigned[0], sigs);
    const conn = new Connection(solanaRpcUrl(chain as "sol" | "sol-devnet"), "confirmed");
    const sig = await conn.sendRawTransaction(raw, { skipPreflight: false });
    return [sig];
  }
  const client = createPublicClient({ chain: viemChain(chain), transport: http(evmRpc(chain)) });
  const hashes: string[] = [];
  for (let i = 0; i < p.unsigned.length; i++) {
    const tx = parseTransaction(`0x${p.unsigned[i]}` as Hex);
    const s = parseMpcSig(p.signatures[i]);
    const point = s.big_r!.affine_point;
    const signed = serializeTransaction(tx, {
      r: `0x${point.slice(2)}` as Hex,
      s: `0x${s.s!.scalar}` as Hex,
      yParity: s.recovery_id as 0 | 1,
    });
    try {
      hashes.push(await client.sendRawTransaction({ serializedTransaction: signed }));
    } catch (e) {
      const m = (e as Error).message;
      if (/nonce too low|already known/i.test(m)) hashes.push("already-broadcast");
      else throw e;
    }
  }
  return hashes;
}

/** Make sure an EVM grave/ossuary address can pay gas for its payout transactions. */
async function fundGas(chain: ChainId, address: string, txs: number, gasLimit: bigint, maxFee: bigint) {
  const client = createPublicClient({ chain: viemChain(chain), transport: http(evmRpc(chain)) });
  const need = gasLimit * maxFee * BigInt(txs);
  const have = await client.getBalance({ address: address as Hex });
  if (have >= need) return;
  const wallet = createWalletClient({ account: sextonEvm(), chain: viemChain(chain), transport: http(evmRpc(chain)) });
  const hash = await wallet.sendTransaction({ to: address as Hex, value: need - have });
  await client.waitForTransactionReceipt({ hash });
}

async function evmGas(chain: ChainId) {
  const client = createPublicClient({ chain: viemChain(chain), transport: http(evmRpc(chain)) });
  const fees = await client.estimateFeesPerGas();
  const maxFee = (fees.maxFeePerGas ?? 1_000_000_000n) * 2n;
  const prio = fees.maxPriorityFeePerGas ?? 1_000_000n;
  return { max_fee_per_gas: maxFee.toString(), max_priority_fee_per_gas: prio.toString(), gas_limit: "90000", maxFee };
}

async function solanaFee(chain: ChainId) {
  const conn = new Connection(solanaRpcUrl(chain as "sol" | "sol-devnet"), "confirmed");
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  return { fee_payer: sextonSolana().publicKey.toBase58(), blockhash };
}

/**
 * Read the payout the call we just made signed. Public RPC is load balanced and
 * a node can lag the one that executed our transaction by a block or two, so a
 * single read may return the pre-callback record or an older signature (Solana
 * re-raises re-sign with a fresh blockhash). Wait for a signed record newer
 * than the one that existed before the call.
 */
async function freshlySigned(key: string, before: SignedPayoutJson | null): Promise<SignedPayoutJson> {
  for (let i = 0; i < 12; i++) {
    const p = await registry.payout(key);
    if (p?.signed_at && p.signatures.length === p.unsigned.length && p.signed_at !== before?.signed_at) return p;
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new BurialError("NEAR signed the payout but the record is not visible yet. Try again in a moment.", "LAGGING", 503);
}

/** Request MPC signatures for a raise and broadcast the result. */
export async function raiseGrave(graveId: number) {
  const g = await registry.grave(graveId);
  if (!g) throw new BurialError("Grave not found.", "NOT_FOUND", 404);
  const plot = await registry.plot(g.plot_id);
  if (plot?.state.kind !== "RISEN") throw new BurialError("This grave's plot has not risen.", "NOT_RISEN", 409);
  const existing = await registry.payout(`raise:${graveId}`);
  if (existing?.signed_at && CHAINS[g.chain as ChainId].family === "evm") {
    // EVM signatures stay valid (fixed nonces): just rebroadcast.
    return { graveId, txs: await broadcastPayout(existing), payout: existing };
  }
  const chain = g.chain as ChainId;
  let args: Record<string, unknown>;
  if (CHAINS[chain].family === "solana") {
    args = { grave_id: graveId, solana: await solanaFee(chain), evm: null };
  } else {
    const gas = await evmGas(chain);
    await fundGas(chain, g.grave_address, 2, 90_000n, gas.maxFee);
    args = { grave_id: graveId, solana: null, evm: { max_fee_per_gas: gas.max_fee_per_gas, max_priority_fee_per_gas: gas.max_priority_fee_per_gas, gas_limit: gas.gas_limit } };
  }
  const res = await callContractRaw("raise_grave", args);
  const ev = parseEvents(res.logs);
  if (!ev.some((e) => e.event === "payout_signed")) {
    throw new BurialError("The MPC network did not sign the payout. Try again.", "SIGN_FAILED", 502);
  }
  const payout = await freshlySigned(`raise:${graveId}`, existing);
  const txs = await broadcastPayout(payout);
  return { graveId, txs, payout, nearTx: res.hash };
}

export async function claimShare(graveId: number, eventId: number) {
  const ev = (await registry.events()).find((e) => e.id === eventId);
  if (!ev) throw new BurialError("Resurrection event not found.", "NOT_FOUND", 404);
  const chain = ev.chain as ChainId;
  const args: Record<string, unknown> = { grave_id: graveId, event_id: eventId, recipient: null, auth: null, solana: null, evm: null };
  if (CHAINS[chain].family === "solana") args.solana = await solanaFee(chain);
  else {
    const gas = await evmGas(chain);
    const ossuary = await registry.ossuary(ev.chain);
    if (ossuary) await fundGas(chain, ossuary, 1, 90_000n, gas.maxFee);
    args.evm = { max_fee_per_gas: gas.max_fee_per_gas, max_priority_fee_per_gas: gas.max_priority_fee_per_gas, gas_limit: gas.gas_limit };
  }
  const key = `share:${graveId}:${eventId}`;
  const before = await registry.payout(key);
  const res = await callContractRaw("claim_share", args);
  if (!parseEvents(res.logs).some((e) => e.event === "payout_signed")) {
    throw new BurialError("The MPC network did not sign the claim. Try again.", "SIGN_FAILED", 502);
  }
  const payout = await freshlySigned(key, before);
  return { txs: await broadcastPayout(payout), payout, nearTx: res.hash };
}

/** Pay a $BONES holder their share of a rising, to their own key on the risen chain. */
export async function claimBones(eventId: number, holder: string) {
  const ev = (await registry.events()).find((e) => e.id === eventId);
  if (!ev) throw new BurialError("Resurrection event not found.", "NOT_FOUND", 404);
  const chain = ev.chain as ChainId;
  const args: Record<string, unknown> = { event_id: eventId, holder, recipient: null, auth: null, solana: null, evm: null };
  if (CHAINS[chain].family === "solana") args.solana = await solanaFee(chain);
  else {
    const gas = await evmGas(chain);
    const ossuary = await registry.ossuary(ev.chain);
    if (ossuary) await fundGas(chain, ossuary, 1, 90_000n, gas.maxFee);
    args.evm = { max_fee_per_gas: gas.max_fee_per_gas, max_priority_fee_per_gas: gas.max_priority_fee_per_gas, gas_limit: gas.gas_limit };
  }
  const key = `bones:${eventId}:${holder}`;
  const before = await registry.payout(key);
  const res = await callContractRaw("claim_bones", args);
  if (res.failure) {
    const m = JSON.stringify(res.failure);
    throw new BurialError(m.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? "NEAR rejected the claim.", "REJECTED", 400);
  }
  if (!parseEvents(res.logs).some((e) => e.event === "payout_signed")) {
    throw new BurialError("The MPC network did not sign the claim. Try again.", "SIGN_FAILED", 502);
  }
  const payout = await freshlySigned(key, before);
  return { txs: await broadcastPayout(payout), payout, nearTx: res.hash };
}

export function explorerFor(chain: ChainId, sig: string) {
  return CHAINS[chain].explorer.tx(sig);
}

export const _test = { compactU16, PublicKey, bs58 };
