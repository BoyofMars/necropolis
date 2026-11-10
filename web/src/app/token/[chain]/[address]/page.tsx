import type { Metadata } from "next";
import { CHAINS, isChainId } from "@/core/chains";
import { Autopsy } from "./Autopsy";

export async function generateMetadata({ params }: { params: Promise<{ chain: string; address: string }> }): Promise<Metadata> {
  const { chain, address } = await params;
  const name = isChainId(chain) ? CHAINS[chain].name : chain;
  return {
    title: `Autopsy · ${address.slice(0, 6)}… on ${name}`,
    description: "Vital signs, cause of death and burial status for this token.",
    openGraph: { images: [`/api/og/token/${chain}/${address}`] },
  };
}

export default async function TokenPage({ params }: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await params;
  return <Autopsy chain={chain} address={decodeURIComponent(address)} />;
}
