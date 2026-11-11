import type { Metadata } from "next";
import { VerifyView } from "./VerifyView";

export const metadata: Metadata = {
  title: "Verify",
  description: "Every live claim Necropolis makes, re-checked in your browser from NEAR, Solana and Base RPCs. Nothing trusts our server.",
};

export default function VerifyPage() {
  return <VerifyView />;
}
