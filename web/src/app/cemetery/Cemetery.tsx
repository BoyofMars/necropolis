"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { GraveCard } from "@/components/GraveCard";
import { Pulse } from "@/components/Pulse";
import { ButtonLink, ConditionTag, Notice, Panel, TokenGlyph } from "@/components/ui";
import { CHAINS, type ChainId } from "@/core/chains";
import { riteProgress } from "@/core/resurrection";
import { NETWORK, registry, type PlotJson } from "@/core/near";
import { syntheticBeats } from "@/lib/beats";
import { ago, date, tokenAmount, usd } from "@/lib/format";
import { baseOf, obsOf, stateOf, termsOf } from "@/lib/rite";
import { ownerIds, useWallets } from "@/lib/wallets";
import register from "@/core/register-seed.json";
import { Boards } from "./Boards";

async function load() {
  const [stats, plots, graves, events] = await Promise.all([registry.stats(), registry.plots(0, 100), registry.graves(0, 24, true), registry.events()]);
  return { stats, plots, graves, events };
}

export function Cemetery() {
  const q = useQuery({ queryKey: ["cemetery"], queryFn: load, refetchInterval: 20_000 });
  const w = useWallets();
  const ids = ownerIds(w);
  const mine = useQuery({
    queryKey: ["my-graves", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => (await Promise.all(ids.map((id) => registry.gravesByOwner(id)))).flat(),
  });
  const plotsById = new Map((q.data?.plots ?? []).map((p) => [p.id, p]));
  const stirring = (q.data?.plots ?? []).filter((p) => p.state.kind === "STIRRING");
  const risen = q.data?.events ?? [];
  const chainSplit = (q.data?.plots ?? []).reduce<Record<string, number>>((m, p) => {
    const k = p.chain.startsWith("sol") ? "Solana" : "Base";
    m[k] = (m[k] ?? 0) + p.grave_count;
    return m;
  }, {});
  const dead = (register as { condition: string; symbol: string; chain: string; address: string; deathScore: number | null; image: string | null; causeTitle: string }[]).filter(
    (r) => r.condition === "DEAD" || r.condition === "CRITICAL",
  );

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="eyebrow">The cemetery · {NETWORK}</p>
          <h1 className="mt-3 font-display text-5xl text-bone sm:text-6xl">Rows of the departed.</h1>
          <p className="mt-3 max-w-xl text-bone-2">Every grave here is a dead token sitting in a vault on its own chain, and a claim recorded on NEAR.</p>
        </div>
        <ButtonLink href="/bury">Bury a bag</ButtonLink>
      </div>

      {q.isError && <div className="mt-8"><Notice tone="danger">The NEAR RPC is not responding. {(q.error as Error).message}</Notice></div>}

      <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[16px] border border-line bg-line sm:grid-cols-5">
        {[
          ["Graves", q.data?.stats.graves],
          ["Plots", q.data?.stats.plots],
          ["Risings", q.data?.stats.events],
          ["Value buried", q.data ? usd(Number(q.data.stats.total_value_buried_usd_e6) / 1e6, { precise: true }) : undefined],
          ["Solana · Base", q.data ? `${chainSplit.Solana ?? 0} · ${chainSplit.Base ?? 0}` : undefined],
        ].map(([k, v]) => (
          <div key={k as string} className="bg-loam-1 px-5 py-4">
            <dt className="eyebrow">{k}</dt>
            <dd className="mt-1 font-display text-3xl text-bone tabular">{v ?? <span className="skeleton inline-block h-7 w-14 align-middle" />}</dd>
          </div>
        ))}
      </dl>

      {(mine.data?.length ?? 0) > 0 && (
        <section className="mt-12">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-3xl text-bone">Your graves</h2>
            <Link href="/graves" className="text-sm text-ember hover:underline">All of them →</Link>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {mine.data!.slice(0, 6).map((g) => (
              <GraveCard key={g.id} g={g} plot={plotsById.get(g.plot_id)} compact />
            ))}
          </div>
        </section>
      )}

      {/* Resurrection watch */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-3xl text-bone">Resurrection watch</h2>
          <span className="text-xs text-bone-4">plots showing signs of life</span>
        </div>
        {stirring.length === 0 ? (
          <Panel className="mt-5 flex flex-col items-center gap-3 p-8 text-center">
            <Pulse beats={syntheticBeats("dead", 40)} className="h-12 w-full max-w-lg" />
            <p className="text-sm text-bone-3">Nothing is stirring. The cemetery is quiet.</p>
          </Panel>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {stirring.map((p) => <StirringPlot key={p.id} p={p} />)}
          </div>
        )}
      </section>

      {/* The boards */}
      <section className="mt-14" aria-label="Boards">
        <h2 className="font-display text-3xl text-bone">The boards</h2>
        <Boards plotsById={plotsById} />
      </section>

      {/* Fresh graves */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-3xl text-bone">Fresh graves</h2>
          <span className="text-xs text-bone-4">newest first</span>
        </div>
        {q.isLoading ? (
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton stele h-48" />)}
          </div>
        ) : (q.data?.graves.length ?? 0) === 0 ? (
          <Panel className="mt-5 p-8 text-center">
            <p className="font-display text-2xl text-bone">No one has been buried yet.</p>
            <p className="mt-2 text-sm text-bone-3">Be the first to dig. The first burial of a token opens its plot and freezes its terms.</p>
            <ButtonLink href="/bury" className="mt-5">Dig the first grave</ButtonLink>
          </Panel>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {q.data!.graves.map((g) => <GraveCard key={g.id} g={g} plot={plotsById.get(g.plot_id)} />)}
          </div>
        )}
      </section>

      {/* Plots */}
      {(q.data?.plots.length ?? 0) > 0 && (
        <section className="mt-14">
          <h2 className="font-display text-3xl text-bone">Plots</h2>
          <div className="mt-5 overflow-hidden rounded-[16px] border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-loam-1 text-bone-4">
                <tr>
                  <th className="px-4 py-3 font-medium">Token</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">Chain</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 text-right font-medium">Graves</th>
                  <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Buried</th>
                  <th className="hidden px-4 py-3 text-right font-medium md:table-cell">Opened</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.plots.map((p) => (
                  <tr key={p.id} className="ledger-row">
                    <td className="px-4 py-3">
                      <Link href={`/token/${p.chain}/${p.token}`} className="flex items-center gap-2 text-bone hover:text-ember">
                        <TokenGlyph symbol={p.symbol} src={p.image} size={24} dim={p.state.kind === "RESTING"} />${p.symbol}
                      </Link>
                    </td>
                    <td className="hidden px-4 py-3 text-bone-3 sm:table-cell">{CHAINS[p.chain as ChainId]?.name}</td>
                    <td className="px-4 py-3"><ConditionTag condition={p.state.kind} pulse={p.state.kind === "STIRRING"} /></td>
                    <td className="px-4 py-3 text-right tabular text-bone-2">{p.grave_count}</td>
                    <td className="hidden px-4 py-3 text-right tabular text-bone-2 sm:table-cell">{tokenAmount(p.total_amount, p.decimals)}</td>
                    <td className="hidden px-4 py-3 text-right text-bone-3 md:table-cell">{date(p.opened_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Risen */}
      <section className="mt-14">
        <h2 className="font-display text-3xl text-bone">The risen</h2>
        {risen.length === 0 ? (
          <p className="mt-3 text-sm text-bone-3">No plot has risen yet. When one does, every resting grave shares its tithe.</p>
        ) : (
          <ul className="mt-5 grid gap-3 md:grid-cols-2">
            {risen.map((e) => (
              <li key={e.id} className="rounded-[14px] border border-ember/40 bg-loam-1 p-5">
                <div className="flex items-center justify-between">
                  <span className="font-display text-2xl ember-text">${e.symbol}</span>
                  <span className="text-xs text-bone-3">{date(e.at)}</span>
                </div>
                <p className="mt-2 text-sm text-bone-2">
                  {tokenAmount(e.pool_amount, e.decimals)} ${e.symbol} went to the ossuary, shared across graves worth{" "}
                  {usd(Number(e.pool_weight_usd_e6) / 1e6, { precise: true })} of weight.
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recently pronounced (mainnet register) */}
      {dead.length > 0 && (
        <section className="mt-14">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-3xl text-bone">Recently pronounced</h2>
            <Link href="/discover" className="text-sm text-ember hover:underline">The register →</Link>
          </div>
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {dead.slice(0, 5).map((r) => (
              <li key={r.address}>
                <Link href={`/token/${r.chain}/${r.address}`} className="flex items-center gap-3 rounded-[12px] border border-line bg-loam-1 p-3 hover:border-line-strong">
                  <TokenGlyph symbol={r.symbol} src={r.image} size={32} dim />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-bone">${r.symbol}</span>
                    <span className="block truncate text-xs text-bone-3">{r.causeTitle}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StirringPlot({ p }: { p: PlotJson }) {
  const latest = p.last_observation ? obsOf(p.last_observation) : undefined;
  const prog = riteProgress(termsOf(p), baseOf(p), stateOf(p), latest);
  return (
    <Link href={`/token/${p.chain}/${p.token}`} className="stirring-glow block rounded-[16px] border border-ember/50 bg-loam-1 p-5">
      <div className="flex items-center justify-between">
        <span className="font-display text-2xl text-bone">${p.symbol}</span>
        <ConditionTag condition="STIRRING" pulse />
      </div>
      <Pulse beats={syntheticBeats("stirring", 36, p.observations + 3)} color="var(--ember)" glow scan className="mt-3 h-14 w-full" />
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-loam-3">
        <div className="h-full bg-ember" style={{ width: `${Math.max(3, prog.overall * 100)}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-bone-3">
        <span>{p.grave_count} grave{p.grave_count === 1 ? "" : "s"} waiting</span>
        <span>{latest ? `last pulse ${ago(latest.t)}` : ""}</span>
      </div>
    </Link>
  );
}
