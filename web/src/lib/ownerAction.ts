import bs58 from "bs58";
import { CHAINS, type ChainId } from "@/core/chains";
import { actionMessage, registry } from "@/core/near";

export type OwnerAction = "set_epitaph" | "transfer_grave" | "set_payout_address" | "exhume_bones";

/** Field name in the signed message, exactly as the contract writes it. */
const MSG_FIELD: Record<OwnerAction, string> = { set_epitaph: "epitaph", transfer_grave: "receiver", set_payout_address: "address", exhume_bones: "amount" };

/** The contract method's argument name for each action's value. */
export const CONTRACT_ARG: Record<OwnerAction, string> = {
  set_epitaph: "epitaph",
  transfer_grave: "receiver_id",
  set_payout_address: "address",
  exhume_bones: "amount",
};

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function solanaKey(v: string): Uint8Array | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return null;
  try {
    const k = bs58.decode(v);
    return k.length === 32 ? k : null;
  } catch {
    return null;
  }
}

/** Which wallet can sign for a NEAR owner id: a 64-hex implicit (Solana key) or 0x eth-implicit. */
export function signerKind(ownerId: string): "solana" | "evm" | "near" {
  if (/^[0-9a-f]{64}$/.test(ownerId)) return "solana";
  if (/^0x[0-9a-f]{40}$/.test(ownerId)) return "evm";
  return "near";
}

/**
 * A grave can be transferred to a Solana key, an EVM address or a named NEAR
 * account. Wallet addresses become NEAR implicit accounts (hex ed25519 key, or
 * a NEP-518 0x account), so the receiver controls it with the wallet they have.
 */
export function receiverAccountId(input: string): { accountId: string; kind: "solana" | "evm" | "near" } {
  const v = input.trim();
  const k = solanaKey(v);
  if (k) return { accountId: hex(k), kind: "solana" };
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return { accountId: v.toLowerCase(), kind: "evm" };
  if (/^[0-9a-f]{64}$/.test(v)) return { accountId: v, kind: "solana" };
  const named = v.toLowerCase();
  if (named.length >= 2 && named.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(named)) return { accountId: named, kind: "near" };
  throw new Error("Enter a Solana address, an EVM address or a NEAR account.");
}

/** The contract stores payout addresses canonically; sign that exact form. */
export function canonicalPayout(chain: ChainId, input: string): string {
  const v = input.trim();
  if (CHAINS[chain].family === "solana") {
    const k = solanaKey(v);
    if (!k) throw new Error("That isn't a Solana address.");
    return bs58.encode(k);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error("That isn't an EVM address.");
  return v.toLowerCase();
}

export async function prepareOwnerAction(ownerId: string, action: OwnerAction, graveId: number, value: string) {
  const nonce = Number(await registry.nonce(ownerId));
  const message = actionMessage(action, graveId, [[MSG_FIELD[action], value]], nonce);
  return { nonce, message };
}

export const encodeSolanaSignature = (sig: Uint8Array) => bs58.encode(sig);
