import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The register of the dead",
  description: "Famous crashed memecoins on Solana and Base, examined with live data. Most aren't dead.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
