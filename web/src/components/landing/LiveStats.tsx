"use client";

import { useQuery } from "@tanstack/react-query";
import { NETWORK, registry } from "@/core/near";

export function LiveStats() {
  const q = useQuery({ queryKey: ["stats"], queryFn: registry.stats, refetchInterval: 30_000 });
  const s = q.data;
  const fmtUsd = (e6?: string) => {
    if (!e6) return "—";
    const n = Number(e6) / 1e6;
    return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(n < 10 ? 2 : 0)}`;
  };
  const items = [
    { k: "Graves", v: s ? s.graves.toLocaleString() : "—" },
    { k: "Plots", v: s ? s.plots.toLocaleString() : "—" },
    { k: "Risings", v: s ? s.events.toLocaleString() : "—" },
    { k: "Value buried", v: fmtUsd(s?.total_value_buried_usd_e6) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4" aria-live="polite">
      {items.map((i) => (
        <div key={i.k}>
          <dt className="eyebrow">{i.k}</dt>
          <dd className="mt-0.5 font-display text-2xl text-bone tabular">{q.isLoading ? <span className="skeleton inline-block h-6 w-12 align-middle" /> : i.v}</dd>
        </div>
      ))}
      <p className="col-span-full text-xs text-bone-4">
        Read live from the NEAR {NETWORK} contract. {q.isError && "The NEAR RPC is not responding right now."}
      </p>
    </dl>
  );
}
