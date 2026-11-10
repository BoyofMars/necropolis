import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Proof & verification",
  description: "Re-derive any grave address from NEAR's MPC root keys, in your browser.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
