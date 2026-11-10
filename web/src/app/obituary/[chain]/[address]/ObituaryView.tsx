"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { StepLoader } from "@/components/StepLoader";
import { ButtonLink, CONDITION_STYLE, Notice, TokenGlyph } from "@/components/ui";
import { CHAINS, shortAddress, type ChainId } from "@/core/chains";
import { NETWORK } from "@/core/near";
import { leftLine, obituaryOf, risenLine } from "@/core/obituary";
import { api, type ScanResult } from "@/lib/api";
import { usd } from "@/lib/format";

export function ObituaryView({ chain, address }: { chain: ChainId; address: string }) {
  const q = useQuery({
    queryKey: ["scan", chain, address],
    queryFn: () => api<ScanResult>(`/api/scan?chain=${chain}&address=${encodeURIComponent(address)}`),
    staleTime: 60_000,
  });
  const image = `/api/og/obituary/${chain}/${encodeURIComponent(address)}`;
  const net = CHAINS[chain].network;

  return (
    <div className="mx-auto max-w-[980px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <p className="eyebrow">Obituary · {CHAINS[chain].name}</p>
      <h1 className="mt-3 font-display text-4xl leading-tight text-bone sm:text-5xl">
        The bags of <span className="whitespace-nowrap">{shortAddress(address, 4, 4)}</span>
      </h1>

      {q.isLoading && (
        <div className="mt-8 rounded-[18px] border border-line bg-loam-1 p-6">
          <div className="font-display text-2xl text-bone">Reading the headstones…</div>
          <StepLoader steps={["Reading token balances", "Checking every token's vital signs", "Writing the obituary"]} className="mt-6" pace={900} />
        </div>
      )}
      {q.isError && <div className="mt-8"><Notice tone="danger">{(q.error as Error).message}</Notice></div>}

      {q.data && <Body scan={q.data} image={image} net={net} />}
    </div>
  );
}

function Body({ scan, image, net }: { scan: ScanResult; image: string; net: "mainnet" | "testnet" }) {
  const o = obituaryOf(scan.owner, scan.entries);
  // Key the card to its content so a cached image never disagrees with the page.
  const card = `${image}?k=${o.departed.length}.${o.risen.length}.${Math.round(o.leftUsd)}`;
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? window.location.href : "";
  const back = risenLine(o);
  const text =
    o.departed.length > 0
      ? `${o.headline} ${leftLine(o)}${back ? ` ${back}` : ""} My wallet's obituary. Who died in yours?`
      : "My wallet's obituary: everyone made it. Who died in yours?";
  const scanHref = `/scan?address=${encodeURIComponent(scan.owner)}&net=${net}`;

  return (
    <>
      <p className="mt-3 font-display text-2xl italic text-ember">{o.departed.length > 0 ? `${o.headline} ${leftLine(o)}` : leftLine(o)}</p>
      {back && (
        <p className="mt-1 text-sm text-bone-2">
          <span className="text-ember">{back}</span> Their Necropolis plots rose: they died, and came back.
        </p>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={card}
        alt={`Obituary card: ${o.headline} ${leftLine(o)} ${o.departed.slice(0, 6).map((d) => `$${d.symbol}`).join(", ")}`}
        width={1200}
        height={630}
        className="mt-8 w-full rounded-[18px] border border-line bg-loam-1"
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          className="inline-flex h-11 items-center rounded-[10px] bg-ember px-4 text-sm font-semibold text-on-ember hover:bg-ember-bright"
          href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noreferrer"
        >
          Share on X
        </a>
        <button
          className="inline-flex h-11 items-center rounded-[10px] border border-line px-4 text-sm text-bone-2 hover:text-bone"
          onClick={async () => {
            try {
              if (navigator.share) await navigator.share({ title: "Obituary", text, url });
              else {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            } catch {
              /* dismissed */
            }
          }}
        >
          {copied ? "Link copied" : "Share link"}
        </button>
        <a className="inline-flex h-11 items-center rounded-[10px] border border-line px-4 text-sm text-bone-2 hover:text-bone" href={card} download="obituary.png">
          Download card
        </a>
      </div>

      {o.departed.length > 0 && (
        <section className="mt-12" aria-label="The departed">
          <h2 className="font-display text-3xl text-bone">The departed</h2>
          <p className="mt-1 text-sm text-bone-3">
            {o.dead} dead{o.critical > 0 ? `, ${o.critical} critical` : ""}
            {o.survivors > 0 ? `, ${o.survivors} still breathing` : ""}. {o.epitaph}
          </p>
          <ul className="mt-5 divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-loam-1">
            {o.departed.map((e) => (
              <li key={e.address} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                <TokenGlyph symbol={e.symbol} size={36} dim={e.diagnosis.condition === "DEAD"} />
                <div className="min-w-0 flex-1">
                  <Link href={`/token/${scan.chain}/${e.address}`} className="font-semibold text-bone hover:text-ember">
                    ${e.symbol}
                  </Link>
                  <div className="text-xs text-bone-3">{e.valueUsd !== undefined ? `${usd(e.valueUsd, { precise: true })} today` : "no price"}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-2xl leading-none" style={{ color: CONDITION_STYLE[e.diagnosis.condition].color }}>
                    {e.diagnosis.deathScore ?? "—"}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-bone-4">{CONDITION_STYLE[e.diagnosis.condition].label}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href="/scan">Who died in your wallet?</ButtonLink>
        {o.departed.length > 0 && (
          <ButtonLink href={net === NETWORK ? scanHref : "/how"} variant="ghost">
            {net === NETWORK ? "Bury them" : "How burial works"}
          </ButtonLink>
        )}
      </div>
      <p className="mt-6 text-xs text-bone-4">
        Classified from live market data, never from cost basis: an obituary counts the dead and what they&rsquo;re worth today, not what anyone paid.{" "}
        <Link href="/how#methodology" className="text-ember hover:underline">How we classify death</Link>
      </p>
    </>
  );
}
