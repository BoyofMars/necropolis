import type { Metadata } from "next";
import { CryptView } from "./CryptView";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `The crypt of grave Nº ${String(id).padStart(6, "0")}`,
    description: "Only the grave's current holder can open its crypt. Sell the grave and the door closes behind you.",
    robots: { index: false },
  };
}

export default async function CryptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CryptView id={Number(id)} />;
}
