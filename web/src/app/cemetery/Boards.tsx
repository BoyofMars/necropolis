"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { Panel } from "@/components/ui";
import { registry, type GraveJson, type PlotJson } from "@/core/near";
import { graveNo, usd } from "@/lib/format";
import { Flame } from "@/components/Flame";

async function load() {
  const [mourned, graves, total] = await Promise.all([registry.mostMourned(5), registry.graves(0, 200, true), registry.candleTotal()]);
  const byId = new Map(graves.map((g) => [g.id, g]));
  return {
    mourned: mourned.map(([id, n]) => ({ g: byId.get(id), n: Number(n) })).filter((r): r is { g: GraveJson; n: number } => !!r.g),
    biggest: [...graves].sort((a, b) => Number(b.value_usd_e6) - Number(a.value_usd_e6)).slice(0, 5),
    total: Number(total),
  };
}

function Board({ title, hint, empty, children }: { title: string; hint: string; empty: string | null; children: ReactNode }) {
  return (
    <Panel className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-2xl text-bone">{title}</h3>
        <span className="text-xs text-bone-4">{hint}</span>
      </div>
      {empty ? <p className="mt-4 text-sm text-bone-3">{empty}</p> : <ol className="mt-3 divide-y divide-line">{children}</ol>}
    </Panel>
  );
}

function Row({ rank, g, plot, right }: { rank: number; g: GraveJson; plot?: PlotJson; right: ReactNode }) {
  return (
    <li>
      <Link href={`/grave/${g.id}`} className="ledger-row -mx-2 flex items-center gap-3 rounded-[10px] px-2 py-2.5">
        <span className="w-6 font-display text-2xl leading-none text-bone-4">{rank}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-bone">${plot?.symbol ?? "…"}</span>
          <span className="block text-xs text-bone-3">{graveNo(g.id)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-sm tabular text-bone-2">{right}</span>
      </Link>
    </li>
  );
}

/** The social layer: who the cemetery mourns, and who it buried deepest. */
export function Boards({ plotsById }: { plotsById: Map<string, PlotJson> }) {
  const q = useQuery({ queryKey: ["mourned"], queryFn: load, refetchInterval: 30_000 });
  if (q.isLoading) return <div className="mt-5 grid gap-4 md:grid-cols-2"><div className="skeleton h-56" /><div className="skeleton h-56" /></div>;
  if (!q.data) return null;
  const { mourned, biggest, total } = q.data;
  return (
    <div className="mt-5 grid gap-4 md:grid-cols-2">
      <Board
        title="Most mourned"
        hint={`${total} candle${total === 1 ? "" : "s"} lit, each signed by a wallet`}
        empty={mourned.length === 0 ? "No candles yet. Open any grave and light the first one." : null}
      >
        {mourned.map(({ g, n }, i) => (
          <Row
            key={g.id}
            rank={i + 1}
            g={g}
            plot={plotsById.get(g.plot_id)}
            right={
              <>
                <Flame className="h-5 w-3" delay={i * 0.7} />
                {n}
              </>
            }
          />
        ))}
      </Board>
      <Board title="Biggest graves" hint="value at burial" empty={biggest.length === 0 ? "No one has been buried yet." : null}>
        {biggest.map((g, i) => (
          <Row key={g.id} rank={i + 1} g={g} plot={plotsById.get(g.plot_id)} right={usd(Number(g.value_usd_e6) / 1e6, { precise: true })} />
        ))}
      </Board>
    </div>
  );
}
