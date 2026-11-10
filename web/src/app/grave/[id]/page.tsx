import type { Metadata } from "next";
import { GraveView } from "./GraveView";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const no = `Nº ${String(id).padStart(6, "0")}`;
  return {
    title: `Grave ${no}`,
    description: "A burial position: a dead token in a vault only NEAR can open, with a claim on its resurrection.",
    openGraph: { images: [`/api/og/grave/${id}`] },
    twitter: { card: "summary_large_image", images: [`/api/og/grave/${id}`] },
  };
}

export default async function GravePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GraveView id={Number(id)} />;
}
