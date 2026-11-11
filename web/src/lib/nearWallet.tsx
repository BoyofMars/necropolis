"use client";

/**
 * Optional NEAR wallet (HOT, Intear, MyNearWallet) via NEAR's wallet
 * selector. Nobody needs it to bury: Solana and Base users keep their own
 * wallets. It's for NEAR-native users who want to hold graves and $BONES in a
 * named NEAR account, act as a grave's keeper with a NEAR transaction, send
 * BONES with ft_transfer, and open a crypt with a NEP-413 signature.
 *
 * The selector loads on demand, so pages that never touch it stay light.
 */
import "@near-wallet-selector/modal-ui/styles.css";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { Buffer } from "buffer";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CONTRACT_ID, NETWORK } from "@/core/near";

const SELECTED_KEY = "near-wallet-selector:selectedWalletId";
const TGAS = 1_000_000_000_000n;

export interface Nep413 {
  accountId: string;
  publicKey: string;
  signature: string;
  /** base64 of the 32-byte nonce that was signed */
  nonce: string;
}

interface NearWalletCtx {
  accountId: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Call the Necropolis contract from the connected account; resolves to the tx hash. */
  call: (method: string, args: Record<string, unknown>, opts?: { deposit?: bigint; tgas?: number }) => Promise<string>;
  /** NEP-413 signature over `message`, addressed to the contract. */
  signMessage: (message: string) => Promise<Nep413>;
}

const Ctx = createContext<NearWalletCtx | null>(null);

export function useNearWallet(): NearWalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNearWallet outside NearWalletProvider");
  return c;
}

function previouslySignedIn(): boolean {
  try {
    return !!localStorage.getItem(SELECTED_KEY);
  } catch {
    return false;
  }
}

/** Panic text out of a failed NEAR outcome, if any. */
function failureOf(outcome: unknown): string | null {
  const s = JSON.stringify((outcome as { status?: unknown })?.status ?? "");
  if (!s.includes("Failure")) return null;
  return s.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? "NEAR rejected the transaction.";
}

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const selectorRef = useRef<{ selector: WalletSelector; modal: WalletSelectorModal } | null>(null);
  const loading = useRef<Promise<{ selector: WalletSelector; modal: WalletSelectorModal }> | null>(null);

  const load = useCallback(() => {
    if (selectorRef.current) return Promise.resolve(selectorRef.current);
    if (!loading.current) {
      loading.current = (async () => {
        // Meteor's SDK still imports near-api-js v5 APIs, which this app's v7 doesn't have.
        const [{ setupWalletSelector }, { setupModal }, { setupHereWallet }, { setupIntearWallet }, { setupMyNearWallet }] = await Promise.all([
          import("@near-wallet-selector/core"),
          import("@near-wallet-selector/modal-ui"),
          import("@near-wallet-selector/here-wallet"),
          import("@near-wallet-selector/intear-wallet"),
          import("@near-wallet-selector/my-near-wallet"),
        ]);
        const selector = await setupWalletSelector({
          network: NETWORK,
          modules: [setupHereWallet(), setupIntearWallet(), setupMyNearWallet()],
        });
        const modal = setupModal(selector, {
          contractId: CONTRACT_ID,
          theme: "auto",
          description: "Hold graves and $BONES in a NEAR account. Burying still happens from your Solana or Base wallet.",
        });
        selector.store.observable.subscribe((s) => setAccountId(s.accounts.find((a) => a.active)?.accountId ?? s.accounts[0]?.accountId ?? null));
        selectorRef.current = { selector, modal };
        return selectorRef.current;
      })();
    }
    return loading.current;
  }, []);

  // Restore a previous session without loading the selector for everyone else.
  useEffect(() => {
    if (previouslySignedIn()) load().catch(() => undefined);
  }, [load]);

  const value = useMemo<NearWalletCtx>(
    () => ({
      accountId,
      connect: async () => {
        const { modal } = await load();
        modal.show();
      },
      disconnect: async () => {
        const { selector } = await load();
        const w = await selector.wallet();
        await w.signOut();
        setAccountId(null);
      },
      call: async (method, args, opts) => {
        const { selector } = await load();
        const w = await selector.wallet();
        const { actionCreators } = await import("@near-js/transactions");
        const outcome = await w.signAndSendTransaction({
          receiverId: CONTRACT_ID,
          actions: [actionCreators.functionCall(method, args, BigInt(opts?.tgas ?? 100) * TGAS, opts?.deposit ?? 0n)],
        });
        const failed = failureOf(outcome);
        if (failed) throw new Error(failed);
        return (outcome as { transaction?: { hash?: string } } | void)?.transaction?.hash ?? "";
      },
      signMessage: async (message) => {
        const { selector } = await load();
        const w = await selector.wallet();
        if (!w.signMessage) throw new Error("This NEAR wallet can't sign messages. Try HOT or Intear.");
        const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
        const r = await w.signMessage({ message, recipient: CONTRACT_ID, nonce });
        if (!r) throw new Error("The wallet didn't return a signature.");
        return { accountId: r.accountId, publicKey: r.publicKey, signature: r.signature, nonce: nonce.toString("base64") };
      },
    }),
    [accountId, load],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
