"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CONDITION_STYLE, ConditionTag, TokenGlyph, cx } from "@/components/ui";
import { CHAINS, type ChainId } from "@/core/chains";
import type { Condition } from "@/core/death";
import { TEST_BAGS } from "@/core/testnet";
import { NETWORK } from "@/core/near";
import register from "@/core/register-seed.json";
import { api } from "@/lib/api";
import { date, usd } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";

interface Entry {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  image: string | null;
  condition: Condition;
  deathScore: number | null;
  causeTitle: string;
  timeOfDeath: number | null;
  drawdown: number | null;
  liquidityUsd: number | null;
  checkedAt: number;
}

interface SearchResult {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  image: string | null;
  liquidityUsd: number | null;
  testBag: boolean;
}

const ROWS = register as Entry[];
const FILTERS: (Condition | "ALL")[] = ["ALL", "DEAD", "CRITICAL", "FADING", "ALIVE"];

export default function Discover() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [chainF, setChainF] = useState<"all" | "sol" | "base">("all");
  const { prefs } = usePrefs();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const search = useQuery({
    queryKey: ["search", debounced],
    enabled: debounced.length >= 2,
    queryFn: () => api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(debounced)}`),
  });
  const rows = useMemo(
    () =>
      ROWS.filter((r) => (filter === "ALL" || r.condition === filter) && (chainF === "all" || r.chain === chainF)).sort(
        (a, b) => (b.deathScore ?? 0) - (a.deathScore ?? 0),
      ),
    [filter, chainF],
  );
  const pronounced = ROWS.filter((r) => r.condition === "DEAD" || r.condition === "CRITICAL").length;

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <p className="eyebrow">Discover</p>
      <h1 className="mt-3 font-display text-5xl text-bone sm:text-6xl">The register of the dead.</h1>
      <p className="mt-3 max-w-2xl text-bone-2">
        Most crashed memecoins aren&rsquo;t dead. Of {ROWS.length} famous crashes we examined, we pronounce only {pronounced} dead or critical. The rest still have real traders, and we say so.
      </p>

      <div className="mt-8">
        <label className="sr-only" htmlFor="q">Search tokens</label>
        <input
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any Solana or Base token by name, ticker or address"
          className="h-12 w-full rounded-[12px] border border-line-strong bg-loam-1 px-4 text-bone placeholder:text-bone-4 focus:border-bone-3 focus:outline-none"
          autoComplete="off"
        />
        {debounced.length >= 2 && (
          <div className="mt-2 overflow-hidden rounded-[12px] border border-line bg-loam-1">
            {search.isLoading && <div className="px-4 py-3 text-sm text-bone-3">Searching DexScreener…</div>}
            {search.isError && <div className="px-4 py-3 text-sm text-danger">{(search.error as Error).message}</div>}
            {search.data?.results.length === 0 && <div className="px-4 py-3 text-sm text-bone-3">No Solana or Base tokens match.</div>}
            <ul className="divide-y divide-line">
              {search.data?.results.map((r) => (
                <li key={`${r.chain}:${r.address}`}>
                  <Link href={`/token/${r.chain}/${r.address}`} className="flex items-center gap-3 px-4 py-3 hover:bg-loam-2">
                    <TokenGlyph symbol={r.symbol} src={r.image} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="text-sm font-semibold text-bone">${r.symbol}</span>{" "}
                      <span className="text-xs text-bone-3">{r.name}</span>
                    </span>
                    <span className="text-xs text-bone-4">
                      {r.testBag ? "test bag" : CHAINS[r.chain]?.name} {r.liquidityUsd !== null && `· ${usd(r.liquidityUsd)} liquidity`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cx("rounded-full border px-3.5 py-1.5 text-sm", filter === f ? "border-bone-3 bg-loam-3 text-bone" : "border-line text-bone-3 hover:text-bone")}
          >
            <span style={{ color: f === "ALL" ? undefined : CONDITION_STYLE[f].color }}>{f === "ALL" ? "All" : CONDITION_STYLE[f].label}</span>
          </button>
        ))}
        <span className="mx-2 h-5 w-px bg-line" aria-hidden />
        {(["all", "sol", "base"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setChainF(c)}
            aria-pressed={chainF === c}
            className={cx("rounded-full border px-3.5 py-1.5 text-sm", chainF === c ? "border-bone-3 bg-loam-3 text-bone" : "border-line text-bone-3 hover:text-bone")}
          >
            {c === "all" ? "Both chains" : c === "sol" ? "Solana" : "Base"}
          </button>
        ))}
      </div>

      <div className="mt-5 overflow-x-auto rounded-[16px] border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-loam-1 text-bone-4">
            <tr>
              <th className="px-4 py-3 font-medium">Nº</th>
              <th className="px-4 py-3 font-medium">Token</th>
              <th className="px-4 py-3 font-medium">Condition</th>
              <th className="px-4 py-3 font-medium">Cause</th>
              <th className="px-4 py-3 text-right font-medium">From peak</th>
              <th className="px-4 py-3 text-right font-medium">Liquidity</th>
              <th className="px-4 py-3 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.address} className="ledger-row">
                <td className="px-4 py-3 font-display text-bone-4">{String(i + 1).padStart(2, "0")}</td>
                <td className="px-4 py-3">
                  <Link href={`/token/${r.chain}/${r.address}`} className="flex items-center gap-2.5 text-bone hover:text-ember">
                    <TokenGlyph symbol={r.symbol} src={r.image} size={26} dim={r.condition === "DEAD"} />
                    <span>
                      <span className="font-semibold">${r.symbol}</span>
                      <span className="ml-2 text-xs text-bone-4">{CHAINS[r.chain].name}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3"><ConditionTag condition={r.condition} /></td>
                <td className="px-4 py-3 text-bone-3">{r.condition === "DEAD" || r.condition === "CRITICAL" ? r.causeTitle : "—"}</td>
                <td className="px-4 py-3 text-right tabular text-bone-2">{r.drawdown !== null ? `-${(r.drawdown * 100).toFixed(1)}%` : "—"}</td>
                <td className="px-4 py-3 text-right tabular text-bone-2">{usd(r.liquidityUsd)}</td>
                <td className="px-4 py-3 text-right font-display text-lg" style={{ color: CONDITION_STYLE[r.condition].color }}>{r.deathScore ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-bone-4">
        Verdicts recorded {ROWS[0] ? date(Math.floor(ROWS[0].checkedAt / 1000)) : "—"} from live DexScreener, Jupiter and GeckoTerminal data; open a token for today&rsquo;s autopsy. Tokens are matched by Jupiter&rsquo;s verified list or DexScreener profiles to avoid copycats.
      </p>

      {NETWORK === "testnet" && TEST_BAGS.length > 0 && (
        <section className="mt-14">
          <h2 className="font-display text-3xl text-bone">Proving Grounds</h2>
          <p className="mt-2 text-sm text-bone-3">Test bags on Solana devnet and Base Sepolia, with simulated life stories. Bury them for real.</p>
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {TEST_BAGS.map((b) => (
              <li key={`${b.chain}:${b.address}`}>
                <Link href={`/token/${b.chain}/${b.address}`} className="block rounded-[12px] border border-line bg-loam-1 p-4 hover:border-line-strong">
                  <div className="font-semibold text-bone">${b.symbol}</div>
                  <div className="text-xs text-bone-3">{CHAINS[b.chain].name}</div>
                  <div className="mt-2 font-display text-sm italic text-bone-3">&ldquo;{b.epitaphHint}&rdquo;</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {prefs.recent.length > 0 && (
        <section className="mt-14">
          <h2 className="font-display text-2xl text-bone">Recently examined</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {prefs.recent.map((r) => (
              <li key={`${r.chain}:${r.address}`}>
                <Link href={`/token/${r.chain}/${r.address}`} className="rounded-full border border-line px-3 py-1.5 text-sm text-bone-2 hover:border-bone-4 hover:text-bone">
                  ${r.symbol}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
