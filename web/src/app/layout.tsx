import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { BRAND } from "@/brand";
import { Providers } from "@/components/Providers";
import { ServiceWorker } from "@/components/ServiceWorker";
import { Footer, Header, TabBar } from "@/components/Shell";
import { ConnectProvider } from "@/lib/wallets";
import "./globals.css";

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});
const ui = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const data = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-data", display: "swap" });

/** Absolute base for OG/share URLs. Tolerates stray whitespace/BOMs in env values. */
function siteUrl(): URL {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/[^\x21-\x7e]/g, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
  for (const c of [raw, vercel, "http://localhost:3000"]) {
    try {
      if (c) return new URL(c);
    } catch {
      /* try next */
    }
  }
  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: `${BRAND.name} — ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  applicationName: BRAND.name,
  openGraph: { type: "website", siteName: BRAND.name, title: `${BRAND.name} — ${BRAND.tagline}`, description: BRAND.description },
  twitter: { card: "summary_large_image", title: `${BRAND.name} — ${BRAND.tagline}`, description: BRAND.description },
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/api/icon/180" },
};

export const viewport: Viewport = {
  themeColor: "#0c0b0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${data.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only z-[100] rounded bg-ember px-3 py-2 text-[#1a1206] focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to content
        </a>
        <Providers>
          <ConnectProvider>
            <Header />
            <main id="main" className="relative z-10 min-h-[70dvh]">
              {children}
            </main>
            <Footer />
            <TabBar />
            <ServiceWorker />
          </ConnectProvider>
        </Providers>
      </body>
    </html>
  );
}
