import type { Metadata } from "next";
import { Cemetery } from "./Cemetery";

export const metadata: Metadata = {
  title: "The cemetery",
  description: "Every grave, plot and resurrection on Bagyard, read live from NEAR.",
};

export default function CemeteryPage() {
  return <Cemetery />;
}
