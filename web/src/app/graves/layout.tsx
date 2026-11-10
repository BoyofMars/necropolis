import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My graves",
  description: "Your burial positions, owned by your own Solana or Base key.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
