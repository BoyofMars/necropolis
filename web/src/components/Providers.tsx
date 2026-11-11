"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { NETWORK } from "@/core/near";
import { BurnerWalletAdapter } from "@/lib/burner";
import { PrefsProvider } from "@/lib/prefs";

const SOLANA_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? (NETWORK === "mainnet" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com");

export const wagmiConfig = createConfig({
  chains: NETWORK === "mainnet" ? [base] : [baseSepolia],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [base.id]: http(), [baseSepolia.id]: http() },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 } },
      }),
  );
  // Testnet only: a throwaway devnet wallet so anyone can try the whole flow without an extension.
  const [wallets] = useState(() => (NETWORK === "testnet" ? [new BurnerWalletAdapter()] : []));
  return (
    <QueryClientProvider client={qc}>
      <WagmiProvider config={wagmiConfig}>
        <ConnectionProvider endpoint={SOLANA_ENDPOINT}>
          <WalletProvider wallets={wallets} autoConnect>
            <PrefsProvider>{children}</PrefsProvider>
          </WalletProvider>
        </ConnectionProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
