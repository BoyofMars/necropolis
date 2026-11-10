import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CHAINS, detectFamily, isChainId, shortAddress } from "@/core/chains";
import { ObituaryView } from "./ObituaryView";

type Params = Promise<{ chain: string; address: string }>;

function valid(chain: string, address: string) {
  return isChainId(chain) && detectFamily(address) === CHAINS[chain].family;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { chain, address: raw } = await params;
  const address = decodeURIComponent(raw);
  if (!valid(chain, address)) return { title: "Obituary" };
  const title = `The obituary of ${shortAddress(address, 4, 4)}`;
  const image = `/api/og/obituary/${chain}/${encodeURIComponent(address)}`;
  return {
    title,
    description: `Which coins died in this ${CHAINS[chain as keyof typeof CHAINS].name} wallet, and what's left of them. Who died in yours?`,
    openGraph: { title, images: [image] },
    twitter: { card: "summary_large_image", title, images: [image] },
  };
}

export default async function ObituaryPage({ params }: { params: Params }) {
  const { chain, address: raw } = await params;
  const address = decodeURIComponent(raw);
  if (!valid(chain, address)) notFound();
  return <ObituaryView chain={chain as keyof typeof CHAINS} address={address} />;
}
