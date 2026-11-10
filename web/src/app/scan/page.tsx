import type { Metadata } from "next";
import { Suspense } from "react";
import { Scanner } from "./Scanner";

export const metadata: Metadata = {
  title: "Scan a wallet",
  description: "Find the dead memecoins in any Solana or Base wallet, and see exactly why they're dead.",
};

export default function ScanPage() {
  return (
    <Suspense>
      <Scanner />
    </Suspense>
  );
}
