"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { BRAND } from "@/brand";
import { CONTRACT_ID, MPC_SIGNER, NETWORK, nearAccountUrl, registry } from "@/core/near";
import { ago, graveNo } from "@/lib/format";
import { Pulse } from "./Pulse";
import { Mark } from "./Shell";
import { ButtonLink } from "./ui";

/** One lonely heartbeat on an otherwise flat line. */
const SINGLE_BEAT = Array.from({ length: 64 }, (_, i) => (i === 49 ? 0.75 : 0));

async function loadLive() {
  const [stats, latest] = await Promise.all([registry.stats(), registry.graves(0, 1, true)]);
  const g = latest[0] ?? null;
  const plot = g ? await registry.plot(g.plot_id).catch(() => null) : null;
  return { stats, latest: g ? { id: g.id, symbol: plot?.symbol ?? "?", at: g.buried_at, risen: plot?.state.kind === "RISEN" } : null };
}

/** Deterministic headstone horizon. One stone glows: the grave that rose. */
function Horizon() {
  const stones: { x: number; w: number; h: number; arch: boolean }[] = [];
  let seed = 11;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let x = 6; x < 1200; ) {
    const w = 12 + Math.round(r() * 10);
    const h = 16 + Math.round(r() * 34);
    stones.push({ x, w, h, arch: r() > 0.22 });
    x += w + 8 + Math.round(r() * 22);
  }
  const glow = Math.floor(stones.length * 0.68);
  const base = 92;
  const shape = (s: (typeof stones)[number]) =>
    s.arch
      ? `M${s.x} ${base} V${base - s.h + s.w / 2} A${s.w / 2} ${s.w / 2} 0 0 1 ${s.x + s.w} ${base - s.h + s.w / 2} V${base} Z`
      : `M${s.x} ${base} V${base - s.h} H${s.x + s.w} V${base} Z`;
  return (
    <svg viewBox="0 0 1200 96" preserveAspectRatio="xMidYMax slice" className="block h-20 w-full sm:h-24" aria-hidden>
      <defs>
        <filter id="footer-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      {stones.map((s, i) =>
        i === glow ? (
          <g key={i}>
            <path d={shape(s)} fill="var(--ember)" opacity="0.45" filter="url(#footer-glow)" />
            <path d={shape(s)} fill="var(--loam-2)" stroke="var(--ember)" strokeWidth="1.2" />
            <path d={`M${s.x + s.w / 2 - 3} ${base - s.h / 2} h2 l1.2 -3 l1.6 6 l1.2 -3 h2`} stroke="var(--ember)" strokeWidth="1" fill="none" />
          </g>
        ) : (
          <path key={i} d={shape(s)} fill="var(--loam-3)" stroke="var(--line-strong)" strokeWidth="0.8" />
        ),
      )}
      <rect x="0" y={base} width="1200" height="4" fill="var(--loam-3)" />
    </svg>
  );
}

export function Footer() {
  const live = useQuery({ queryKey: ["footer-live"], queryFn: loadLive, refetchInterval: 60_000 });
  const s = live.data?.stats;
  const latest = live.data?.latest;

  return (
    <footer className="relative z-10 mt-20 overflow-hidden border-t border-line">
      <Pulse beats={SINGLE_BEAT} color="var(--bone-4)" scan animate={false} className="h-14 w-full" label="A flat line with a single heartbeat" />

      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="grid items-end gap-10 py-12 lg:grid-cols-[1.35fr_1fr]">
          <div>
            <p className="eyebrow">An epitaph for every bag</p>
            <p className="mt-4 font-display text-5xl leading-[0.95] text-bone sm:text-6xl xl:text-7xl">
              Here lies <span className="italic">conviction.</span>
              <br />
              <span className="text-bone-3">Some of it comes back.</span>
            </p>
          </div>

          <div className="rounded-[18px] border border-line bg-loam-1 p-5">
            <div className="flex items-center gap-2 text-xs text-bone-3">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-alive opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-alive" />
              </span>
              Live from <span className="font-mono">{CONTRACT_ID}</span>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3">
              {[
                ["Graves", s?.graves],
                ["Plots", s?.plots],
                ["Risings", s?.events],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="eyebrow !text-[10px]">{k}</dt>
                  <dd className="font-display text-3xl tabular text-bone">{v ?? <span className="skeleton inline-block h-6 w-8 align-middle" />}</dd>
                </div>
              ))}
            </dl>
            {latest && (
              <Link href={`/grave/${latest.id}`} className="mt-4 flex items-center justify-between rounded-[10px] border border-line bg-loam-2 px-3 py-2.5 text-sm hover:border-line-strong">
                <span className="text-bone-2">
                  Latest: <span className="font-display text-bone">{graveNo(latest.id)}</span> · ${latest.symbol}
                  {latest.risen && <span className="ml-1.5 text-ember">· risen</span>}
                </span>
                <span className="text-xs text-bone-4">{ago(latest.at)} →</span>
              </Link>
            )}
            <div className="mt-4 flex gap-2">
              <ButtonLink href="/scan" size="sm">Scan a wallet</ButtonLink>
              <ButtonLink href="/bury" size="sm" variant="ghost">Bury a bag</ButtonLink>
            </div>
          </div>
        </div>

        <div className="grid gap-10 border-t border-line py-10 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5">
              <Mark size={24} />
              <span className="font-display text-xl font-semibold text-bone">{BRAND.name}</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-bone-3">
              Dead memecoins on Solana and Base, buried in vaults only NEAR can open. If one comes back, the whole cemetery shares it.
            </p>
          </div>
          {[
            {
              title: "The grounds",
              links: [
                ["Cemetery", "/cemetery"],
                ["Register of the dead", "/discover"],
                ["Scan a wallet", "/scan"],
                ["My graves", "/graves"],
              ],
            },
            {
              title: "The rules",
              links: [
                ["How it works", "/how"],
                ["Death methodology", "/how#methodology"],
                ["Economics", "/how#economics"],
                ["60-day simulation", "/how#simulation"],
                ["$BONES rules and log", "/bones"],
              ],
            },
            {
              title: "Verify",
              links: [
                ["Judge desk: verify every claim", "/verify"],
                ["Re-derive an address", "/proof"],
                [`${CONTRACT_ID} ↗`, nearAccountUrl(CONTRACT_ID)],
                [`${MPC_SIGNER} ↗`, nearAccountUrl(MPC_SIGNER)],
                ["Source on GitHub ↗", BRAND.repo],
              ],
            },
          ].map((col) => (
            <div key={col.title}>
              <div className="inscription text-sm text-bone-3">{col.title}</div>
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {col.links.map(([label, href]) => (
                  <li key={href}>
                    {href.startsWith("http") ? (
                      <a href={href} target="_blank" rel="noreferrer" className="block truncate py-2 text-sm text-bone-2 transition hover:pl-1 hover:text-bone">
                        {label}
                      </a>
                    ) : (
                      <Link href={href} className="block py-2 text-sm text-bone-2 transition hover:pl-1 hover:text-bone">
                        {label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <Horizon />
      <div className="bg-loam-3 pb-[calc(var(--tabbar-h)+14px)] md:pb-0">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-4 text-xs text-bone-3 sm:px-6 md:flex-row md:items-center md:justify-between">
          <span>
            © 2026 {BRAND.name} · {NETWORK === "testnet" ? "Testnet prototype" : "Mainnet"} · Not financial advice · Buried tokens only come back if their plot rises.
          </span>
          <span className="text-bone-4">{BRAND.disambiguation}</span>
        </div>
      </div>
    </footer>
  );
}
