/**
 * Off-chain mirror of the contract's wallet-signature check (contract/src/auth.rs).
 * Relays run it first so forged or replayed requests never cost the Sexton
 * gas; the contract always checks again on its own.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { verifyMessage, type Hex } from "viem";
import { signerKind } from "@/lib/ownerAction";

function decodeSolanaSig(s: string): Uint8Array | null {
  try {
    const b = /^(0x)?[0-9a-fA-F]{128}$/.test(s) ? Buffer.from(s.replace(/^0x/, ""), "hex") : bs58.decode(s);
    return b.length === 64 ? new Uint8Array(b) : null;
  } catch {
    return null;
  }
}

/** Does `signature` sign `message` for this implicit NEAR account (64-hex ed25519 or 0x EVM)? */
export async function walletSignatureValid(accountId: string, message: string, signature: string): Promise<boolean> {
  const kind = signerKind(accountId);
  if (kind === "solana") {
    const sig = decodeSolanaSig(signature);
    if (!sig) return false;
    try {
      return ed25519.verify(sig, new TextEncoder().encode(message), Buffer.from(accountId, "hex"));
    } catch {
      return false;
    }
  }
  if (kind === "evm") {
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return false;
    return verifyMessage({ address: accountId as Hex, message, signature: signature as Hex }).catch(() => false);
  }
  return false;
}
