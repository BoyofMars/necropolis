"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Panel, cx } from "@/components/ui";
import { shortAddress } from "@/core/chains";
import { CONTRACT_ID, accessKeyCount, formatBones, graveIdOfAccount, nearAccountUrl, registry, type BonesLogJson } from "@/core/near";
import { date, graveNo } from "@/lib/format";

async function load() {
  const rules = await registry.bonesRules();
  const n = Number(rules.mints_and_burns);
  const pages = await Promise.all(Array.from({ length: Math.ceil(n / 100) }, (_, p) => registry.bonesLog(p * 100, 100)));
  const keys = await accessKeyCount(CONTRACT_ID).catch(() => null);
  return { rules, log: pages.flat(), keys };
}

const who = (a: string) => {
  const g = graveIdOfAccount(a);
  if (g !== null) return { label: `grave ${graveNo(g)}`, href: `/grave/${g}` };
  return { label: /^[0-9a-f]{64}$/.test(a) || /^0x[0-9a-f]{40}$/.test(a) ? shortAddress(a, 6, 4) : a, href: nearAccountUrl(a) };
};

/** Supply before the log began: undo the first logged entry. */
function preLogSupply(log: BonesLogJson[], total: string): bigint {
  if (log.length === 0) return BigInt(total);
  const e = log[0];
  return BigInt(e.supply_after) + (e.kind === "mint" ? -BigInt(e.amount) : BigInt(e.amount));
}

export function BonesView() {
  const q = useQuery({ queryKey: ["bones-page"], queryFn: load, refetchInterval: 30_000 });
  const r = q.data?.rules;
  const pct = (bps: number) => `${bps / 100}%`;
  const holdersShare = r ? (r.tithe_bps * (10_000 - r.upkeep_bps)) / 1e6 : 0;

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <div className="eyebrow">NEP-141 · on {CONTRACT_ID}</div>
      <h1 className="mt-2 font-display text-6xl leading-none text-bone sm:text-7xl">$BONES</h1>
      <p className="mt-4 max-w-2xl text-lg text-bone-2">
        The ossuary as a token. Minted as coins die, burned as they come back, and paid a share of every resurrection. Everything on this page is
        read from the contract as you load it.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          ["In circulation", r ? formatBones(r.total_supply) : "…"],
          ["Mints and burns logged", r ? Number(r.mints_and_burns).toLocaleString() : "…"],
          ["Holders' share of a risen plot", r ? `${holdersShare}%` : "…"],
        ].map(([k, v]) => (
          <Panel key={k} className="p-5">
            <div className="eyebrow">{k}</div>
            <div className="mt-2 font-display text-4xl text-bone tabular">{v}</div>
          </Panel>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel className="p-6">
          <h2 className="font-display text-2xl text-bone">The rules, as the contract states them</h2>
          {q.isLoading ? (
            <div className="skeleton mt-4 h-40" />
          ) : (
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-bone-2">
              {r?.rules.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          )}
          <p className="mt-4 text-xs text-bone-4">
            From <span className="font-mono">get_bones_rules()</span>. Holders are paid in the risen coin itself, signed out of the ossuary by NEAR&rsquo;s MPC
            network.
          </p>
        </Panel>
        <Panel className="p-6">
          <h2 className="font-display text-2xl text-bone">Parameters</h2>
          <dl className="mt-4 space-y-2 text-sm">
            {(r
              ? [
                  ["Mint rate", `${r.bones_per_usd_of_weight} BONES per $1 of weight`],
                  ["Tithe on a risen plot", pct(r.tithe_bps)],
                  ["Upkeep, of the tithe", pct(r.upkeep_bps)],
                  ["Death-score floor", `${r.min_death_score} / 100`],
                  ["Decimals", `${r.decimals}`],
                  ["Methods that can change these", r.setters.length === 0 ? "none" : r.setters.join(", ")],
                ]
              : []
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-line pb-2 last:border-0">
                <dt className="text-bone-3">{k}</dt>
                <dd className={cx("text-right tabular", k.startsWith("Methods") ? "font-semibold text-alive" : "text-bone")}>{v}</dd>
              </div>
            ))}
          </dl>
          {q.data && q.data.keys !== null && (
            <p className="mt-4 text-xs text-bone-3">
              {q.data.keys === 0 ? (
                <>
                  <span className="font-semibold text-alive">Locked.</span> {CONTRACT_ID} has no access keys, so its code can&rsquo;t be changed by anyone.
                </>
              ) : (
                <>
                  No method changes these, but {CONTRACT_ID} still has {q.data.keys} access key{q.data.keys === 1 ? "" : "s"}, so its code could be
                  upgraded. The README says when that ends.
                </>
              )}
            </p>
          )}
        </Panel>
      </div>

      <Panel className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line p-6">
          <h2 className="font-display text-2xl text-bone">Every mint and burn</h2>
          <span className="text-xs text-bone-4">
            <span className="font-mono">get_bones_log()</span> · also emitted as NEP-141 <span className="font-mono">ft_mint</span> /{" "}
            <span className="font-mono">ft_burn</span> events
          </span>
        </div>
        {q.isLoading ? (
          <div className="skeleton m-6 h-24" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-bone-4">
                  <th className="px-6 py-3 font-semibold">#</th>
                  <th className="px-3 py-3 font-semibold">When</th>
                  <th className="px-3 py-3 font-semibold">What</th>
                  <th className="px-3 py-3 font-semibold">Account</th>
                  <th className="px-3 py-3 text-right font-semibold">Amount</th>
                  <th className="px-6 py-3 text-right font-semibold">Supply after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...(q.data?.log ?? [])].reverse().map((e) => {
                  const a = who(e.account);
                  return (
                    <tr key={e.i}>
                      <td className="px-6 py-2.5 tabular text-bone-4">{e.i}</td>
                      <td className="px-3 py-2.5 tabular text-bone-3">{date(e.at)}</td>
                      <td className="px-3 py-2.5">
                        <span className={e.kind === "mint" ? "text-bone" : "text-ember"}>{e.kind === "mint" ? "Minted" : "Burned"}</span>
                        <span className="text-bone-4"> · {e.note}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <a href={a.href} className="font-mono text-xs text-bone-2 hover:text-ember" {...(a.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                          {a.label}
                        </a>
                      </td>
                      <td className={cx("px-3 py-2.5 text-right tabular", e.kind === "mint" ? "text-bone" : "text-ember")}>
                        {e.kind === "mint" ? "+" : "−"}
                        {formatBones(e.amount)}
                      </td>
                      <td className="px-6 py-2.5 text-right tabular text-bone-2">{formatBones(e.supply_after)}</td>
                    </tr>
                  );
                })}
                {q.data && (
                  <tr>
                    <td colSpan={6} className="px-6 py-3 text-xs text-bone-4">
                      Before the log began: {formatBones(preLogSupply(q.data.log, q.data.rules.total_supply))} BONES in circulation, from genesis and the
                      first burials. Those mints and burns are in each grave&rsquo;s history and in the contract&rsquo;s{" "}
                      <span className="font-mono">ft_mint</span> / <span className="font-mono">ft_burn</span> events.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/how#simulation" className="text-ember hover:underline">
          60 days of $BONES, simulated under four futures →
        </Link>
        <Link href="/graves" className="text-ember hover:underline">
          Your BONES and what they&rsquo;re owed →
        </Link>
      </div>
    </div>
  );
}
