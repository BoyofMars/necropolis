import type { MetadataRoute } from "next";
import { BRAND } from "@/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} — ${BRAND.tagline}`,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: "/cemetery?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0b0a",
    theme_color: "#0c0b0a",
    categories: ["finance", "social"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Scan a wallet", url: "/scan" },
      { name: "Bury a bag", url: "/bury" },
      { name: "My graves", url: "/graves" },
    ],
  };
}
