import type { Metadata } from "next";
import { BonesView } from "./BonesView";

export const metadata: Metadata = {
  title: "$BONES",
  description: "The ossuary as a token: minted as coins die, burned as they rise, paid out at every resurrection. Rules and a log of every mint and burn, read live from NEAR.",
};

export default function BonesPage() {
  return <BonesView />;
}
