/**
 * A throwaway Solana devnet wallet, kept in this browser. Testnet only.
 *
 * It lets anyone try the whole product (claim test bags, bury, own a grave,
 * sign owner actions, light a candle, open the crypt) without installing a
 * wallet or switching one to devnet. The key never leaves the browser; the
 * Sexton pays every fee, so it never needs SOL.
 */
import {
  BaseMessageSignerWalletAdapter,
  WalletNotConnectedError,
  WalletReadyState,
  isVersionedTransaction,
  type TransactionOrVersionedTransaction,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Keypair, type PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export const BurnerWalletName = "Throwaway devnet wallet" as WalletName<"Throwaway devnet wallet">;
const STORE = "necropolis:burner:v1";

const ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23c2410c'/%3E%3Cpath d='M16 6c3 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3-1-5 0-7z' fill='%23fff7ed'/%3E%3C/svg%3E";

function stored(): string | null {
  try {
    return localStorage.getItem(STORE);
  } catch {
    return null;
  }
}

/** The throwaway key for this browser, creating it on first use. */
export function burnerKeypair(create: boolean): Keypair | null {
  const s = stored();
  if (s) {
    try {
      return Keypair.fromSecretKey(bs58.decode(s));
    } catch {
      /* corrupted: make a new one below */
    }
  }
  if (!create) return null;
  const k = Keypair.generate();
  try {
    localStorage.setItem(STORE, bs58.encode(k.secretKey));
  } catch {
    /* private mode: the key lives for this page only */
  }
  return k;
}

/** The secret key in the base58 form Phantom and Solflare import. */
export function exportBurnerSecret(): string | null {
  return stored();
}

export class BurnerWalletAdapter extends BaseMessageSignerWalletAdapter {
  name = BurnerWalletName;
  url = "https://necropolis-wine.vercel.app";
  icon = ICON;
  readonly supportedTransactionVersions = new Set(["legacy", 0] as const);
  private kp: Keypair | null = null;

  get connecting() {
    return false;
  }
  get publicKey(): PublicKey | null {
    return this.kp?.publicKey ?? null;
  }
  get readyState() {
    return typeof window === "undefined" ? WalletReadyState.Unsupported : WalletReadyState.Loadable;
  }

  async connect() {
    this.kp = burnerKeypair(true);
    if (!this.kp) throw new WalletNotConnectedError();
    this.emit("connect", this.kp.publicKey);
  }

  async disconnect() {
    this.kp = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(tx: T): Promise<T> {
    if (!this.kp) throw new WalletNotConnectedError();
    if (isVersionedTransaction(tx)) tx.sign([this.kp]);
    else tx.partialSign(this.kp);
    return tx;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.kp) throw new WalletNotConnectedError();
    return ed25519.sign(message, this.kp.secretKey.slice(0, 32));
  }
}
