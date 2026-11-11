"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Button, Panel, cx } from "@/components/ui";
import { formatBones, graveAccountId, registry, type BonesShareJson, type EventJson, type GraveJson } from "@/core/near";
import { post } from "@/lib/api";
import { compact, graveNo } from "@/lib/format";

interface Owed {
  g: GraveJson;
  e: EventJson;
  s: BonesShareJson;
}

async function load(graves: GraveJson[]) {
  const [genesis, events] = await Promise.all([registry.bonesGenesis(), registry.events()]);
  const era = genesis === null ? [] : events.filter((e) => e.id >= genesis);
  const rows = await Promise.all(
    graves.map(async (g) => {
      const acct = graveAccountId(g.id);
      const [inside, shares] = await Promise.all([
        registry.bonesBalance(acct).catch(() => "0"),
        Promise.all(era.map((e) => registry.bonesShare(e.id, acct).then((s) => ({ g, e, s })))),
      ]);
      return { g, inside, shares: shares.filter((x): x is Owed => !!x.s?.eligible) };
    }),
  );
  const inside = rows.reduce((t, r) => t + BigInt(r.inside), 0n);
  const shares = rows.flatMap((r) => r.shares).sort((a, b) => b.e.id - a.e.id || a.g.id - b.g.id);
  return { inside, shares, perGrave: rows };
}

/**
 * $BONES held inside the graves this wallet holds, and every share of a
 * rising those graves are owed. Claims are permissionless and always pay the
 * grave's current holder, so "Claim all" just triggers each one.
 */
export function GravesBones({ graves }: { graves: GraveJson[] }) {
  const ids = graves.map((g) => g.id).join(",");
  const q = useQuery({ queryKey: ["graves-bones", ids], queryFn: () => load(graves), refetchInterval: 30_000 });
  const qc = useQueryClient();
  const [msgs, setMsgs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const unclaimed = q.data?.shares.filter((x) => !x.s.claimed) ?? [];
  const key = (x: Owed) => `${x.g.id}:${x.e.id}`;

  const claim = async (x: Owed) => {
    setBusy(key(x));
    try {
      const r = await post<{ txs: string[] }>("/api/bones/claim", { eventId: x.e.id, holder: graveAccountId(x.g.id) });
      setMsgs((m) => ({ ...m, [key(x)]: `Paid · ${r.txs[0]?.slice(0, 8)}…` }));
    } catch (e) {
      setMsgs((m) => ({ ...m, [key(x)]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const claimAll = async () => {
    for (const x of unclaimed) await claim(x);
    qc.invalidateQueries({ queryKey: ["graves-bones"] });
  };

  return (
    <Panel className="mt-10 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line p-6">
        <div>
          <div className="eyebrow">$BONES inside your graves</div>
          <div className="mt-2 font-display text-5xl text-bone tabular">{q.data ? formatBones(q.data.inside) : "…"}</div>
          <p className="mt-1 max-w-xl text-sm text-bone-3">
            Each burial mints its BONES into the grave&rsquo;s own account, so they and everything they earn belong to whoever holds the grave. Sell a
            grave and its BONES go with it.{" "}
            <Link href="/bones" className="text-ember hover:underline">
              How $BONES works
            </Link>
          </p>
        </div>
        {unclaimed.length > 1 && (
          <Button onClick={claimAll} disabled={!!busy}>
            {busy ? "MPC signing…" : `Claim all ${unclaimed.length}`}
          </Button>
        )}
      </div>
      <div className="p-6">
        <h3 className="font-display text-2xl text-bone">What your graves are owed</h3>
        {q.isLoading ? (
          <div className="skeleton mt-4 h-16" />
        ) : (q.data?.shares.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-bone-3">Nothing yet. When another coin rises, every grave holding BONES at that moment is owed a share of its tithe.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {q.data!.shares.map((x) => (
              <li key={key(x)} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-bone">
                    <Link href={`/grave/${x.g.id}`} className="hover:text-ember">
                      Grave {graveNo(x.g.id)}
                    </Link>{" "}
                    · ${x.e.symbol} rose
                  </div>
                  <div className="text-xs text-bone-3">
                    {compact(Number(x.s.amount) / 10 ** x.e.decimals)} ${x.e.symbol} for {formatBones(x.s.balance_at_rising)} BONES held at the rising
                  </div>
                  {msgs[key(x)] && <div className={cx("mt-1 text-xs", msgs[key(x)].startsWith("Paid") ? "text-alive" : "text-danger")}>{msgs[key(x)]}</div>}
                </div>
                {x.s.claimed ? (
                  <span className="text-xs text-alive">Paid</span>
                ) : (
                  <Button size="sm" disabled={!!busy} onClick={() => claim(x).then(() => qc.invalidateQueries({ queryKey: ["graves-bones"] }))}>
                    {busy === key(x) ? "MPC signing…" : "Claim"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-bone-4">Paid in the risen coin to your wallet on its chain, signed out of the ossuary by NEAR&rsquo;s MPC network.</p>
      </div>
    </Panel>
  );
}
