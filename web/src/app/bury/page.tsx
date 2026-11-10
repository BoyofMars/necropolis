import type { Metadata } from "next";
import { Suspense } from "react";
import { BurialFlow } from "./BurialFlow";

export const metadata: Metadata = {
  title: "Bury a bag",
  description: "Send a dead token to its own grave on its native chain. Verified by NEAR, no bridge.",
};

export default function BuryPage() {
  return (
    <Suspense>
      <BurialFlow />
    </Suspense>
  );
}
