"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRAND } from "@/brand";
import { NETWORK } from "@/core/near";
import { shortAddress } from "@/core/chains";
import { useConnectSheet, useWallets } from "@/lib/wallets";
import { ThemeToggle } from "./ThemeToggle";
import { cx } from "./ui";

export function Mark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M8 27V14a8 8 0 0 1 16 0v13" fill="none" stroke="var(--bone)" strokeWidth="1.8" />
      <path d="M5 27.5h22" stroke="var(--bone-3)" strokeWidth="1.4" />
      <path d="M10.5 20h3l1.4-3.2 2.2 6.4 1.6-3.2h2.8" fill="none" stroke="var(--ember)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

const NAV = [
  { href: "/cemetery", label: "Cemetery" },
  { href: "/discover", label: "Discover" },
  { href: "/scan", label: "Scan" },
  { href: "/how", label: "How it works" },
  { href: "/bones", label: "$BONES" },
  { href: "/verify", label: "Verify" },
];

export function Header() {
  const path = usePathname();
  const w = useWallets();
  const { open } = useConnectSheet();
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-loam/85 pt-safe backdrop-blur-md">
      <div className="mx-auto flex h-[var(--header-h)] max-w-[1200px] items-center gap-4 px-4 sm:px-6 xl:gap-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label={`${BRAND.name} home`}>
          <Mark />
          <span className="font-display text-[1.45rem] font-semibold tracking-tight text-bone">{BRAND.name}</span>
        </Link>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                "whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm transition-colors xl:px-3",
                path.startsWith(n.href) ? "bg-loam-3 text-bone" : "text-bone-3 hover:text-bone",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {NETWORK === "testnet" && (
            <span
              className="hidden rounded-full border border-fading/40 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fading sm:inline"
              title="Burials run on Solana devnet, Base Sepolia and NEAR testnet"
            >
              Testnet
            </span>
          )}
          <Link
            href="/bury"
            className="hidden h-9 items-center whitespace-nowrap rounded-[10px] bg-ember px-4 text-sm font-semibold text-on-ember transition hover:bg-ember-bright md:inline-flex"
          >
            Bury a bag
          </Link>
          <ThemeToggle />
          <button
            onClick={() => open()}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line-strong px-3 text-sm text-bone hover:border-bone-4"
          >
            {w.any ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-alive" />
                <span className="max-w-[9rem] truncate font-mono text-xs">
                  {w.sol || w.evm ? shortAddress((w.sol ?? w.evm) as string, 4, 4) : w.near}
                </span>
                {[w.sol, w.evm, w.near].filter(Boolean).length > 1 && (
                  <span className="text-bone-3">+{[w.sol, w.evm, w.near].filter(Boolean).length - 1}</span>
                )}
              </>
            ) : (
              "Connect"
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

const TABS = [
  { href: "/cemetery", label: "Cemetery", icon: "M4 20V11a8 8 0 0 1 16 0v9M2 21h20" },
  { href: "/discover", label: "Discover", icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4-4" },
  { href: "/bury", label: "Bury", icon: "" },
  { href: "/graves", label: "My graves", icon: "M7 21V12a5 5 0 0 1 10 0v9M5 21h14M10 15h4" },
  { href: "/scan", label: "Scan", icon: "M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4M7 12h10" },
];

export function TabBar() {
  const path = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-loam/95 pb-safe backdrop-blur-md md:hidden"
      aria-label="Primary"
    >
      <div className="grid h-[var(--tabbar-h)] grid-cols-5">
        {TABS.map((t) => {
          const active = path.startsWith(t.href);
          if (t.href === "/bury") {
            return (
              <Link key={t.href} href={t.href} className="flex flex-col items-center justify-center" aria-label="Bury a bag">
                <span className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full border border-ember-bright/30 bg-ember text-on-ember shadow-[0_8px_30px_-6px_rgba(240,166,60,.6)]">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
                  </svg>
                </span>
                <span className="mt-1 text-[10px] font-semibold text-ember">Bury</span>
              </Link>
            );
          }
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cx("flex flex-col items-center justify-center gap-1 text-[10px] font-medium", active ? "text-bone" : "text-bone-4")}
              aria-current={active ? "page" : undefined}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <path d={t.icon} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
