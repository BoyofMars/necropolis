"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { GraveCard } from "@/components/GraveCard";
import { Button, ButtonLink, Notice, Panel } from "@/components/ui";
import { registry } from "@/core/near";
import { usePrefs } from "@/lib/prefs";
import { ownerIds, useConnectSheet, useWallets } from "@/lib/wallets";
import { BonesPanel } from "./BonesPanel";
import { GravesBones } from "./GravesBones";

export default function MyGraves() {
  const w = useWallets();
  const { open } = useConnectSheet();
  const { prefs } = usePrefs();
  const ids = ownerIds(w);
  const q = useQuery({
    queryKey: ["my-graves-full", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const graves = (await Promise.all(ids.map((id) => registry.gravesByOwner(id)))).flat();
      const plots = await Promise.all([...new Set(graves.map((g) => g.plot_id))].map((p) => registry.plot(p)));
      return { graves: graves.sort((a, b) => b.id - a.id), plots: new Map(plots.filter(Boolean).map((p) => [p!.id, p!])) };
    },
    refetchInterval: 20_000,
  });

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <p className="eyebrow">My graveyard</p>
      <h1 className="mt-3 font-display text-5xl text-bone sm:text-6xl">What you&rsquo;ve laid to rest.</h1>
      {!w.any ? (
        <Panel className="mt-10 p-8">
          <p className="text-bone-2">Connect the wallet you buried from. Graves belong to your Solana or Base key: no NEAR account needed.</p>
          <Button className="mt-5" onClick={() => open()}>Connect wallet</Button>
        </Panel>
      ) : q.isLoading ? (
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton stele h-56" />)}
        </div>
      ) : q.isError ? (
        <div className="mt-10"><Notice tone="danger">{(q.error as Error).message}</Notice></div>
      ) : (q.data?.graves.length ?? 0) === 0 ? (
        <Panel className="mt-10 p-8">
          <p className="font-display text-2xl text-bone">No graves yet.</p>
          <p className="mt-2 text-bone-2">Scan your wallet to find what&rsquo;s dead, then bury it.</p>
          <div className="mt-5 flex gap-3">
            <ButtonLink href="/scan">Scan my wallet</ButtonLink>
            <ButtonLink href="/bury" variant="ghost">Bury a bag</ButtonLink>
          </div>
        </Panel>
      ) : (
        <>
          <p className="mt-3 text-bone-2">
            {q.data!.graves.length} grave{q.data!.graves.length === 1 ? "" : "s"} ·{" "}
            {q.data!.graves.filter((g) => q.data!.plots.get(g.plot_id)?.state.kind === "STIRRING").length} stirring ·{" "}
            {q.data!.graves.filter((g) => q.data!.plots.get(g.plot_id)?.state.kind === "RISEN").length} risen
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {q.data!.graves.map((g) => <GraveCard key={g.id} g={g} plot={q.data!.plots.get(g.plot_id)} />)}
          </div>
          <GravesBones graves={q.data!.graves} />
        </>
      )}

      {ids.map((id) => (
        <BonesPanel key={id} holder={id} />
      ))}

      {prefs.watchlist.length > 0 && (
        <section className="mt-16">
          <h2 className="font-display text-3xl text-bone">Watching</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {prefs.watchlist.map((k) => {
              const [chain, ...rest] = k.split(":");
              const addr = rest.join(":");
              const recent = prefs.recent.find((r) => r.address === addr);
              return (
                <li key={k}>
                  <Link href={`/token/${chain}/${addr}`} className="rounded-full border border-line px-3 py-1.5 text-sm text-bone-2 hover:border-bone-4 hover:text-bone">
                    {recent ? `$${recent.symbol}` : `${addr.slice(0, 6)}…`}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
