"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Panel, cx } from "@/components/ui";
import { shortAddress } from "@/core/chains";
import {
  accessKeyCount,
  formatBones,
  graveAccountId,
  nearAccountUrl,
  registry,
  type EventJson,
  type GraveEventJson,
  type GraveJson,
  type PlotJson,
} from "@/core/near";
import { post } from "@/lib/api";
import { compact, date } from "@/lib/format";

const KIND: Record<string, string> = {
  buried: "Buried",
  bones_minted: "BONES minted",
  earned: "Earned",
  raised: "Raised",
  bones_burned: "BONES burned",
  bones_exhumed: "BONES exhumed",
  transferred: "Changed hands",
  epitaph: "Epitaph set",
};

const short = (a: string | null) => (!a ? "" : /^[0-9a-f]{64}$/.test(a) || /^0x[0-9a-f]{40}$/.test(a) ? shortAddress(a, 6, 4) : a);

async function load(g: GraveJson, events: EventJson[], genesis: number | null) {
  const acct = graveAccountId(g.id);
  const era = genesis === null ? [] : events.filter((e) => e.id >= genesis);
  const [inside, keys, history, shares] = await Promise.all([
    registry.bonesBalance(acct),
    accessKeyCount(acct).catch(() => null),
    registry.graveHistory(g.id).catch(() => [] as GraveEventJson[]),
    Promise.all(era.map((e) => registry.bonesShare(e.id, acct).then((s) => ({ e, s })))),
  ]);
  return { acct, inside, keys, history, shares: shares.filter(({ s }) => s?.eligible).reverse() };
}

/**
 * The NEAR account this grave NFT controls. It has no access keys, so no one
 * can sign for it; the contract moves what it holds, and only for whoever
 * holds the NFT at that moment. Sell the grave and all of this goes with it.
 */
export function GraveAccount({
  g,
  plot,
  events,
  genesis,
  mintedTo,
}: {
  g: GraveJson;
  plot: PlotJson | null;
  events: EventJson[];
  genesis: number | null;
  mintedTo: string | null;
}) {
  const q = useQuery({ queryKey: ["graveAccount", g.id, events.length], queryFn: () => load(g, events, genesis), refetchInterval: 30_000 });
  const d = q.data;
  const owed = d?.shares.filter(({ s }) => !s!.claimed).length ?? 0;
  const decimalsOf = (symbol: string | null) =>
    symbol === "BONES" ? 6 : symbol === plot?.symbol ? g.decimals : (events.find((e) => e.symbol === symbol)?.decimals ?? null);

  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-line p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl text-bone">The grave&rsquo;s account</h2>
          {d?.keys === 0 && (
            <span
              title="No key can sign for this account. Only the Necropolis contract moves what it holds, for whoever holds the NFT."
              className="rounded-full border border-alive/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-alive"
            >
              0 access keys
            </span>
          )}
        </div>
        <a className="mt-1 inline-block break-all font-mono text-sm text-ember hover:underline" href={nearAccountUrl(graveAccountId(g.id))} target="_blank" rel="noreferrer">
          {graveAccountId(g.id)} ↗
        </a>
        <p className="mt-2 max-w-2xl text-sm text-bone-3">
          This NFT controls a NEAR account that nobody holds a key to. Its $BONES, and every share of a rising they earn, belong to whoever holds the
          grave right now. Sell or hand it down and the account goes with it; the last holder keeps nothing.
        </p>
        {mintedTo && mintedTo !== graveAccountId(g.id) && (
          <p className="mt-2 max-w-2xl text-xs text-bone-4">
            This grave was dug before graves had accounts, so its BONES were minted to its burier ({short(mintedTo)}). Burials since then mint into the
            grave itself.
          </p>
        )}
        <dl className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-3">
          <div>
            <dt className="eyebrow">BONES inside</dt>
            <dd className="mt-1 text-lg font-semibold tabular text-bone">{d ? formatBones(d.inside) : "…"}</dd>
          </div>
          <div>
            <dt className="eyebrow">Risings owed</dt>
            <dd className="mt-1 text-lg font-semibold tabular text-bone">{d ? owed : "…"}</dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className="eyebrow">Held by</dt>
            <dd className="mt-1 truncate font-mono text-sm text-bone-2" title={g.owner_id}>
              {short(g.owner_id)}
            </dd>
          </div>
        </dl>
      </div>

      {(d?.shares.length ?? 0) > 0 && (
        <div className="border-b border-line p-6">
          <h3 className="font-display text-xl text-bone">Shares of risings</h3>
          <ul className="mt-2 divide-y divide-line">
            {d!.shares.map(({ e, s }) => (
              <ShareRow key={e.id} e={e} s={s!} holder={d!.acct} graveId={g.id} />
            ))}
          </ul>
          <p className="mt-2 text-xs text-bone-4">Anyone can trigger a claim. It always pays the grave&rsquo;s current holder.</p>
        </div>
      )}

      <div className="p-6">
        <h3 className="font-display text-xl text-bone">History</h3>
        {q.isLoading ? (
          <div className="skeleton mt-3 h-24" />
        ) : (d?.history.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-bone-3">No history recorded yet.</p>
        ) : (
          <ol className="mt-3 space-y-0">
            {[...d!.history].reverse().map((h, i) => {
              const dec = decimalsOf(h.symbol);
              const amount = h.amount && dec !== null ? `${compact(Number(h.amount) / 10 ** dec)} ${h.symbol === "BONES" ? "BONES" : `$${h.symbol}`}` : null;
              return (
                <li key={i} className="grid grid-cols-[88px_1fr] gap-3 border-l border-line py-2 pl-4 text-sm sm:grid-cols-[110px_1fr]">
                  <span className="tabular text-bone-4">{date(h.at)}</span>
                  <div className="min-w-0">
                    <span className={cx("font-semibold", h.kind === "earned" || h.kind === "raised" ? "text-alive" : h.kind === "transferred" ? "text-ember" : "text-bone")}>
                      {KIND[h.kind] ?? h.kind}
                    </span>
                    {amount && <span className="text-bone-2"> · {amount}</span>}
                    {h.account && <span className="text-bone-3"> · {h.kind === "transferred" ? "to " : ""}{short(h.account)}</span>}
                    {h.note && <div className="break-words text-xs text-bone-4">{h.note}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Panel>
  );
}

function ShareRow({ e, s, holder, graveId }: { e: EventJson; s: NonNullable<Awaited<ReturnType<typeof registry.bonesShare>>>; holder: string; graveId: number }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <div className="text-sm text-bone">${e.symbol} rose {date(e.at)}</div>
        <div className="text-xs text-bone-3">
          {compact(Number(s.amount) / 10 ** e.decimals)} ${e.symbol} for {formatBones(s.balance_at_rising)} BONES held at the rising
        </div>
        {msg && <div className="mt-1 text-xs text-bone-2">{msg}</div>}
      </div>
      {s.claimed ? (
        <span className="text-xs text-alive">Paid</span>
      ) : (
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await post<{ txs: string[] }>("/api/bones/claim", { eventId: e.id, holder });
              setMsg(`Paid to the holder · ${r.txs[0]?.slice(0, 8)}…`);
              qc.invalidateQueries({ queryKey: ["graveAccount", graveId] });
            } catch (err) {
              setMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "MPC signing…" : "Claim"}
        </Button>
      )}
    </li>
  );
}
