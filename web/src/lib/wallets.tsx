"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useAccount, useConnect, useConnectors, useDisconnect } from "wagmi";
import { Sheet } from "@/components/Sheet";
import { Button, Mono, cx } from "@/components/ui";
import { shortAddress, type ChainId } from "@/core/chains";
import { NETWORK } from "@/core/near";

export const SOL_CHAIN: ChainId = NETWORK === "mainnet" ? "sol" : "sol-devnet";
export const EVM_CHAIN: ChainId = NETWORK === "mainnet" ? "base" : "base-sepolia";

/** Unified view of the user's origin-chain wallets. NEAR stays invisible. */
export function useWallets() {
  const sol = useWallet();
  const evm = useAccount();
  return useMemo(
    () => ({
      sol: sol.publicKey ? sol.publicKey.toBase58() : null,
      evm: evm.address ? evm.address.toLowerCase() : null,
      solWallet: sol,
      evmChainId: evm.chainId,
      any: !!sol.publicKey || !!evm.address,
    }),
    [sol, evm.address, evm.chainId],
  );
}

const ConnectCtx = createContext<{ open: (family?: "solana" | "evm") => void } | null>(null);

export function useConnectSheet() {
  const c = useContext(ConnectCtx);
  if (!c) throw new Error("useConnectSheet outside ConnectProvider");
  return c;
}

export function ConnectProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<false | "solana" | "evm" | "both">(false);
  return (
    <ConnectCtx.Provider value={{ open: (f) => setOpen(f ?? "both") }}>
      {children}
      <Sheet open={open !== false} onClose={() => setOpen(false)} title="Connect a wallet">
        <ConnectBody focus={open === false ? "both" : open} onDone={() => setOpen(false)} />
      </Sheet>
    </ConnectCtx.Provider>
  );
}

function ConnectBody({ focus, onDone }: { focus: "solana" | "evm" | "both"; onDone: () => void }) {
  const sol = useWallet();
  const evm = useAccount();
  const connectors = useConnectors();
  const { mutateAsync: connectEvm, isPending: evmPending } = useConnect();
  const { mutate: disconnectEvm } = useDisconnect();
  const [err, setErr] = useState<string | null>(null);
  const solWallets = sol.wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);

  return (
    <div className="space-y-6">
      <p className="text-sm text-bone-2">
        Use the wallet you already hold the bag in. You never need a NEAR wallet: NEAR verifies your burial and your
        signatures behind the scenes.
      </p>
      {(focus === "both" || focus === "solana") && (
        <section>
          <div className="eyebrow mb-2">Solana {NETWORK === "testnet" && "· devnet"}</div>
          {sol.publicKey ? (
            <div className="flex items-center justify-between rounded-[10px] border border-line bg-loam-2 px-4 py-3">
              <div>
                <div className="text-sm text-bone">{sol.wallet?.adapter.name}</div>
                <Mono>{shortAddress(sol.publicKey.toBase58(), 6, 6)}</Mono>
              </div>
              <Button variant="quiet" size="sm" onClick={() => sol.disconnect()}>
                Disconnect
              </Button>
            </div>
          ) : solWallets.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-line-strong px-4 py-3 text-sm text-bone-3">
              No Solana wallet detected. Install{" "}
              <a className="text-ember underline-offset-2 hover:underline" href="https://phantom.com" target="_blank" rel="noreferrer">
                Phantom
              </a>{" "}
              or Solflare, or paste an address on the Scan page to look without connecting.
            </div>
          ) : (
            <div className="grid gap-2">
              {solWallets.map((w) => (
                <button
                  key={w.adapter.name}
                  className="flex h-12 items-center gap-3 rounded-[10px] border border-line bg-loam-2 px-4 text-left text-sm text-bone transition hover:border-bone-4 hover:bg-loam-3"
                  onClick={async () => {
                    setErr(null);
                    try {
                      sol.select(w.adapter.name);
                      await w.adapter.connect();
                      onDone();
                    } catch (e) {
                      setErr((e as Error).message || "The wallet refused the connection.");
                    }
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.adapter.icon} alt="" width={22} height={22} className="rounded" />
                  {w.adapter.name}
                </button>
              ))}
            </div>
          )}
          {NETWORK === "testnet" && (
            <p className="mt-2 text-xs text-bone-4">
              Phantom: Settings → Developer settings → Testnet mode, network Solana Devnet.
            </p>
          )}
        </section>
      )}
      {(focus === "both" || focus === "evm") && (
        <section>
          <div className="eyebrow mb-2">Base {NETWORK === "testnet" && "· Sepolia"}</div>
          {evm.address ? (
            <div className="flex items-center justify-between rounded-[10px] border border-line bg-loam-2 px-4 py-3">
              <div>
                <div className="text-sm text-bone">{evm.connector?.name ?? "Browser wallet"}</div>
                <Mono>{shortAddress(evm.address, 6, 6)}</Mono>
              </div>
              <Button variant="quiet" size="sm" onClick={() => disconnectEvm()}>
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="grid gap-2">
              {connectors.length === 0 && <div className="text-sm text-bone-3">No browser wallet detected.</div>}
              {connectors.map((c) => (
                <button
                  key={c.uid}
                  disabled={evmPending}
                  className={cx(
                    "flex h-12 items-center gap-3 rounded-[10px] border border-line bg-loam-2 px-4 text-left text-sm text-bone transition hover:border-bone-4 hover:bg-loam-3",
                    evmPending && "opacity-60",
                  )}
                  onClick={async () => {
                    setErr(null);
                    try {
                      await connectEvm({ connector: c });
                      onDone();
                    } catch (e) {
                      setErr((e as Error).message?.split("\n")[0] || "The wallet refused the connection.");
                    }
                  }}
                >
                  {c.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.icon} alt="" width={22} height={22} className="rounded" />
                  ) : (
                    <span className="h-[22px] w-[22px] rounded bg-loam-4" />
                  )}
                  {c.name === "Injected" ? "Browser wallet" : c.name}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      {err && <p className="text-sm text-danger">{err}</p>}
    </div>
  );
}
