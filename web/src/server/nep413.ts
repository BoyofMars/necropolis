/**
 * NEP-413 off-chain message signatures (what NEAR wallets' `signMessage` returns).
 *
 *   hash = sha256( borsh(u32 tag = 2^31 + 413) ‖ borsh({ message, nonce[32], recipient, callbackUrl: Option<string> }) )
 *
 * The signature alone proves the key; whether that key belongs to the account
 * (as a full-access key, right now) is a separate RPC check by the caller.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import bs58 from "bs58";

export const NEP413_TAG = 2 ** 31 + 413;

export interface Nep413 {
  accountId: string;
  /** "ed25519:<base58>" */
  publicKey: string;
  /** base64 (base58 accepted) */
  signature: string;
  /** base64 of the 32-byte nonce */
  nonce: string;
}

export function nep413Hash(message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string): Uint8Array {
  const enc = new TextEncoder();
  const u32 = (n: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  };
  const str = (s: string) => {
    const b = enc.encode(s);
    return [u32(b.length), b];
  };
  const parts = [u32(NEP413_TAG), ...str(message), nonce, ...str(recipient), ...(callbackUrl ? [new Uint8Array([1]), ...str(callbackUrl)] : [new Uint8Array([0])])];
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return sha256(out);
}

function decodeSig(s: string): Uint8Array | null {
  try {
    const b = Buffer.from(s, "base64");
    if (b.length === 64) return new Uint8Array(b);
  } catch {
    /* try base58 */
  }
  try {
    const b = bs58.decode(s);
    return b.length === 64 ? b : null;
  } catch {
    return null;
  }
}

/** Does `n` carry a valid ed25519 NEP-413 signature by `n.publicKey` over `message` for `recipient`? */
export function nep413SignatureValid(n: Nep413, message: string, recipient: string): boolean {
  if (!n || typeof n.publicKey !== "string" || !n.publicKey.startsWith("ed25519:")) return false;
  const nonce = Buffer.from(n.nonce ?? "", "base64");
  const sig = decodeSig(n.signature ?? "");
  if (nonce.length !== 32 || !sig) return false;
  try {
    return ed25519.verify(sig, nep413Hash(message, nonce, recipient), bs58.decode(n.publicKey.slice(8)));
  } catch {
    return false;
  }
}
