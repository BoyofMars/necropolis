/**
 * Offline chain-signature address derivation (NEAR MPC v3.x).
 *
 *   tweak = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:" + predecessor + "," + path)
 *   secp256k1:  child = root + tweak·G      (tweak read big-endian)
 *   ed25519:    child = root + (tweak mod ℓ)·B  (tweak read little-endian)
 *
 * Anyone can re-derive a grave address in the browser from the published MPC
 * root keys and confirm it matches what the contract and the MPC report.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha3_256, keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import bs58 from "bs58";

export const ROOT_KEYS = {
  testnet: {
    secp256k1:
      "secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3",
    ed25519: "ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2",
  },
  mainnet: {
    secp256k1:
      "secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya",
    ed25519: "ed25519:G9hwngxWNKdmqMCmU1Yt6LPhFpayJeKFxyAV1HqMNLtF",
  },
} as const;

const PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";

export function tweak(predecessor: string, path: string): Uint8Array {
  return sha3_256(new TextEncoder().encode(`${PREFIX}${predecessor},${path}`));
}

function beToBig(b: Uint8Array): bigint {
  return BigInt(`0x${bytesToHex(b)}`);
}
function leToBig(b: Uint8Array): bigint {
  return beToBig(Uint8Array.from(b).reverse());
}

/** Returns the derived EVM address (lowercase 0x) for a secp256k1 root key. */
export function deriveEvmAddress(rootKey: string, predecessor: string, path: string): string {
  const raw = bs58.decode(rootKey.replace(/^secp256k1:/, ""));
  const uncompressed = raw.length === 64 ? Uint8Array.from([4, ...raw]) : raw;
  const root = secp256k1.Point.fromBytes(uncompressed);
  const t = beToBig(tweak(predecessor, path));
  const child = root.add(secp256k1.Point.BASE.multiply(t));
  const xy = child.toBytes(false).slice(1);
  return `0x${bytesToHex(keccak_256(xy).slice(12))}`;
}

/** Returns the derived Solana address (base58) for an ed25519 root key. */
export function deriveSolanaAddress(rootKey: string, predecessor: string, path: string): string {
  const raw = bs58.decode(rootKey.replace(/^ed25519:/, ""));
  const root = ed25519.Point.fromBytes(raw);
  const n = ed25519.Point.CURVE().n;
  const t = leToBig(tweak(predecessor, path)) % n;
  const child = t === 0n ? root : root.add(ed25519.Point.BASE.multiply(t));
  return bs58.encode(child.toBytes());
}

export function deriveAddress(
  family: "solana" | "evm",
  network: "testnet" | "mainnet",
  predecessor: string,
  path: string,
): string {
  return family === "solana"
    ? deriveSolanaAddress(ROOT_KEYS[network].ed25519, predecessor, path)
    : deriveEvmAddress(ROOT_KEYS[network].secp256k1, predecessor, path);
}
