import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

export default function Offline() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow">No signal</p>
      <h1 className="mt-3 font-display text-5xl text-bone">The cemetery is quiet.</h1>
      <p className="mt-4 text-bone-2">
        You&rsquo;re offline. Graves live on NEAR and their tokens on Solana and Base, so they&rsquo;re safe; reconnect to see them.
      </p>
    </div>
  );
}
