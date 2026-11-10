"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { StepLoader } from "@/components/StepLoader";
import { Button, CONDITION_STYLE, ConditionTag, Notice, TokenGlyph, cx } from "@/components/ui";
import { CHAINS, detectFamily, shortAddress, type ChainId } from "@/core/chains";
import type { Condition } from "@/core/death";
import { NETWORK } from "@/core/near";
import { api, type ScanResult } from "@/lib/api";
import { compact, usd } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { EVM_CHAIN, SOL_CHAIN, useWallets } from "@/lib/wallets";

type Net = "mainnet" | "testnet";
const FILTERS: (Condition | "ALL")[] = ["ALL", "DEAD", "CRITICAL", "FADING", "ALIVE", "UNKNOWN"];

function chainFor(address: string, net: Net): ChainId | null {
  const f = detectFamily(address);
  if (!f) return null;
  if (f === "solana") return net === "mainnet" ? "sol" : "sol-devnet";
  return net === "mainnet" ? "base" : "base-sepolia";
}

/** Coins whose Necropolis plot rose aren't counted among the dead: they came back. */
function headline(s: ScanResult): string {
  const total = s.entries.length;
  if (total === 0) return "No tokens found.";
  const back = s.entries.filter((e) => e.risen).length;
  const dying = s.entries.filter((e) => !e.risen && (e.diagnosis.condition === "DEAD" || e.diagnosis.condition === "CRITICAL")).length;
  const cameBack = back > 0 ? ` ${back} came back.` : "";
  if (dying > 0) return `${dying} of ${total} tokens ${dying === 1 ? "is" : "are"} dead or dying.${cameBack}`;
  return back > 0 ? `${back} came back. The rest are breathing.` : `${total} tokens, all still breathing.`;
}

export function Scanner() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const w = useWallets();
  const { prefs, rememberWallet } = usePrefs();
  const address = params.get("address") ?? "";
  const net = (params.get("net") as Net) ?? "mainnet";
  const [input, setInput] = useState(address);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const chain = address ? chainFor(address, net) : null;

  const q = useQuery({
    queryKey: ["scan", chain, address],
    enabled: !!chain,
    queryFn: () => api<ScanResult>(`/api/scan?chain=${chain}&address=${encodeURIComponent(address)}`),
    staleTime: 30_000,
  });

  const go = (addr: string, n: Net = net) => {
    const a = addr.trim();
    if (!a) return;
    const c = chainFor(a, n);
    if (c) rememberWallet(c, a);
    router.push(`${path}?address=${encodeURIComponent(a)}&net=${n}`);
  };

  const invalid = input.trim().length > 0 && !detectFamily(input.trim());
  const entries = useMemo(
    () => (q.data?.entries ?? []).filter((e) => filter === "ALL" || e.diagnosis.condition === filter),
    [q.data, filter],
  );
  const steps =
    chain && CHAINS[chain].family === "solana"
      ? ["Reading Solana token accounts", "Finding markets for each token", "Checking liquidity", "Counting today's traders", "Looking for signs of life"]
      : ["Reading Base token balances", "Finding markets for each token", "Checking liquidity", "Counting today's trades", "Looking for signs of life"];

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <p className="eyebrow">Wallet graveyard scanner</p>
      <h1 className="mt-3 font-display text-5xl leading-tight text-bone sm:text-6xl">Who died in your wallet?</h1>
      <p className="mt-3 max-w-2xl text-bone-2">
        Paste any Solana or Base address. We check every token&rsquo;s vital signs and tell you which are dead, and why. Looking
        is free and needs no wallet connection.
      </p>

      <form
        className="mt-8 rounded-[18px] border border-line bg-loam-1 p-3 sm:p-4"
        onSubmit={(e) => {
          e.preventDefault();
          go(input);
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="addr">Wallet address</label>
          <input
            id="addr"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a Solana or Base wallet address"
            spellCheck={false}
            autoComplete="off"
            className="h-12 flex-1 rounded-[10px] border border-line-strong bg-loam px-4 font-mono text-sm text-bone placeholder:font-sans placeholder:text-bone-4 focus:border-bone-3 focus:outline-none"
            aria-invalid={invalid}
          />
          <div className="flex gap-2">
            <div className="flex rounded-[10px] border border-line-strong p-1" role="radiogroup" aria-label="Network">
              {(["mainnet", "testnet"] as Net[]).map((n) => (
                <button
                  type="button"
                  key={n}
                  role="radio"
                  aria-checked={net === n}
                  onClick={() => address && go(address, n)}
                  className={cx("rounded-[7px] px-3 text-sm capitalize", net === n ? "bg-loam-3 text-bone" : "text-bone-3 hover:text-bone")}
                >
                  {n}
                </button>
              ))}
            </div>
            <Button type="submit" className="h-12 flex-1 sm:flex-none" disabled={invalid || !input.trim()}>
              Scan
            </Button>
          </div>
        </div>
        {invalid && <p className="mt-2 text-sm text-danger">That isn&rsquo;t a Solana or Base address.</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-bone-3">
          {(w.sol || w.evm) && <span>Your wallets:</span>}
          {w.sol && (
            <button type="button" className="rounded-full border border-line px-2.5 py-1 font-mono hover:border-bone-4 hover:text-bone" onClick={() => { setInput(w.sol!); go(w.sol!, SOL_CHAIN === "sol" ? "mainnet" : "testnet"); }}>
              {shortAddress(w.sol)} · {CHAINS[SOL_CHAIN].shortName}
            </button>
          )}
          {w.evm && (
            <button type="button" className="rounded-full border border-line px-2.5 py-1 font-mono hover:border-bone-4 hover:text-bone" onClick={() => { setInput(w.evm!); go(w.evm!, EVM_CHAIN === "base" ? "mainnet" : "testnet"); }}>
              {shortAddress(w.evm)} · {CHAINS[EVM_CHAIN].shortName}
            </button>
          )}
          {prefs.wallets.filter((x) => x.address !== w.sol && x.address !== w.evm).slice(0, 3).map((x) => (
            <button type="button" key={x.address} className="rounded-full border border-line px-2.5 py-1 font-mono hover:border-bone-4 hover:text-bone" onClick={() => { setInput(x.address); go(x.address, CHAINS[x.chain].network); }}>
              {shortAddress(x.address)}
            </button>
          ))}
        </div>
      </form>

      {!address && (
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            ["Triage, not a verdict", "The scan uses live market data for every token at once. Open an autopsy for the full price history before you decide."],
            ["Explained, always", "Every classification shows the signals behind it: liquidity, volume, traders, how long since anyone cared."],
            [NETWORK === "testnet" ? "Burials run on testnet" : "Bury what's dead", NETWORK === "testnet" ? "Scan mainnet to see your real dead. To try a burial, switch to testnet and claim a few test bags first." : "Select the dead and bury them in one flow."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-[16px] border border-line bg-loam-1 p-5">
              <h3 className="font-display text-xl text-bone">{t}</h3>
              <p className="mt-2 text-sm text-bone-2">{d}</p>
            </div>
          ))}
        </div>
      )}

      {address && !chain && <div className="mt-8"><Notice tone="danger">That address isn&rsquo;t valid on Solana or Base.</Notice></div>}

      {q.isLoading && (
        <div className="mt-10 rounded-[18px] border border-line bg-loam-1 p-6">
          <div className="font-display text-2xl text-bone">Walking the rows of {shortAddress(address, 6, 6)}…</div>
          <StepLoader steps={steps} className="mt-6" pace={900} />
        </div>
      )}

      {q.isError && (
        <div className="mt-8 space-y-3">
          <Notice tone="danger">{(q.error as Error).message}</Notice>
          <Button variant="ghost" onClick={() => q.refetch()}>Try again</Button>
        </div>
      )}

      {q.data && (
        <section className="mt-10" aria-label="Scan results">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="eyebrow">{CHAINS[q.data.chain].name} · {shortAddress(q.data.owner, 6, 6)}</div>
              <h2 className="mt-2 font-display text-4xl text-bone sm:text-5xl">{headline(q.data)}</h2>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              {q.data.counts.total > 0 && (
                <Link
                  href={`/obituary/${q.data.chain}/${encodeURIComponent(q.data.owner)}`}
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-ember/50 px-3.5 text-sm font-semibold text-ember hover:bg-ember/10"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M7 21V10a5 5 0 0 1 10 0v11M4 21h16M12 10v5M9.5 12.5h5" />
                  </svg>
                  Share the obituary
                </Link>
              )}
              <div className="text-xs text-bone-4">Scanned {new Date(q.data.scannedAt).toLocaleTimeString()}</div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Filter by condition">
            {FILTERS.map((f) => {
              const n = f === "ALL" ? q.data!.counts.total : q.data!.counts[f.toLowerCase() as keyof ScanResult["counts"]];
              if (f !== "ALL" && n === 0) return null;
              return (
                <button
                  key={f}
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={cx(
                    "rounded-full border px-3.5 py-1.5 text-sm transition",
                    filter === f ? "border-bone-3 bg-loam-3 text-bone" : "border-line text-bone-3 hover:text-bone",
                  )}
                >
                  <span style={{ color: f === "ALL" ? undefined : CONDITION_STYLE[f].color }}>{f === "ALL" ? "All" : CONDITION_STYLE[f].label}</span>
                  <span className="ml-1.5 tabular text-bone-4">{n}</span>
                </button>
              );
            })}
          </div>

          {q.data.gaps.length > 0 && <div className="mt-4"><Notice tone="warn">{q.data.gaps.join(" ")}</Notice></div>}

          {q.data.counts.total === 0 && CHAINS[q.data.chain].network === "testnet" && (
            <div className="mt-6">
              <Notice>
                No test bags here yet. <Link className="text-ember hover:underline" href="/bury">Claim test bags on the burial page</Link> to try a full burial.
              </Notice>
            </div>
          )}

          <ul className="mt-6 divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-loam-1">
            {entries.map((e) => {
              const testnet = CHAINS[q.data!.chain].network === "testnet";
              const canBury = (e.diagnosis.condition === "DEAD" || e.diagnosis.condition === "CRITICAL" || e.diagnosis.condition === "UNKNOWN") && CHAINS[q.data!.chain].network === NETWORK;
              const top = [...e.diagnosis.reasons].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 2);
              return (
                <li key={e.address} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
                  <TokenGlyph symbol={e.symbol} src={e.icon} size={40} dim={e.diagnosis.condition === "DEAD"} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className="font-semibold text-bone">${e.symbol}</span>
                      <ConditionTag condition={e.diagnosis.condition} />
                      {e.risen && (
                        <span title="Its Necropolis plot rose" className="rounded-full border border-ember/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ember">
                          risen
                        </span>
                      )}
                      {e.testBag && <span className="text-[10px] uppercase tracking-wider text-fading">test bag</span>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-bone-3">
                      {compact(e.uiAmount)} held · {e.valueUsd !== undefined ? usd(e.valueUsd, { precise: true }) : "no price"}
                      {top.length > 0 && ` · ${top.map((r) => `${r.label.toLowerCase()} ${r.measured}`).join(" · ")}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-2xl leading-none" style={{ color: CONDITION_STYLE[e.diagnosis.condition].color }}>
                      {e.diagnosis.deathScore ?? "—"}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-bone-4">death score</div>
                  </div>
                  <div className="col-span-3 flex flex-wrap gap-2 sm:col-span-2 sm:col-start-2">
                    <Link href={`/token/${q.data!.chain}/${e.address}`} className="rounded-[8px] border border-line px-3 py-1.5 text-xs text-bone-2 hover:border-bone-4 hover:text-bone">
                      Autopsy
                    </Link>
                    {canBury && (
                      <Link
                        href={`/bury?chain=${q.data!.chain}&token=${e.address}&amount=${e.amountRaw}`}
                        className="rounded-[8px] bg-ember/90 px-3 py-1.5 text-xs font-semibold text-on-ember hover:bg-ember-bright"
                      >
                        Bury
                      </Link>
                    )}
                    {!canBury && !testnet && (e.diagnosis.condition === "DEAD" || e.diagnosis.condition === "CRITICAL") && (
                      <span className="px-1 py-1.5 text-xs text-bone-4">Mainnet burials open after audit</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs text-bone-4">
            Triage uses live DexScreener{q.data.chain === "sol" ? " and Jupiter" : ""} data. Price history is loaded per token in the autopsy.{" "}
            <Link href="/how#methodology" className="text-ember hover:underline">How we classify death</Link>
          </p>
        </section>
      )}
    </div>
  );
}
