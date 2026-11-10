"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect } from "react";
import { DeathScore } from "@/components/autopsy/DeathScore";
import { LifeChart } from "@/components/autopsy/LifeChart";
import { Pulse } from "@/components/Pulse";
import { StepLoader } from "@/components/StepLoader";
import { ButtonLink, CONDITION_STYLE, ConditionTag, Mono, Notice, Panel, TokenGlyph, cx } from "@/components/ui";
import { CHAINS, shortAddress, type ChainId } from "@/core/chains";
import { isoDay } from "@/core/death";
import { NETWORK } from "@/core/near";
import { requiredMcap, requiredVolume } from "@/core/resurrection";
import { api, type TokenResponse } from "@/lib/api";
import { beatsFromVolumes } from "@/lib/beats";
import { date, graveNo, price, tokenAmount, usd } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";

const STEPS = [
  "Locating markets on DexScreener",
  "Reading holders and traders",
  "Pulling daily price history",
  "Checking for honeypots and freeze authority",
  "Writing the report",
];

export function Autopsy({ chain, address }: { chain: string; address: string }) {
  const q = useQuery({
    queryKey: ["token", chain, address],
    queryFn: () => api<TokenResponse>(`/api/token/${chain}/${encodeURIComponent(address)}`),
    staleTime: 60_000,
  });
  const { remember, toggleWatch, prefs } = usePrefs();
  const data = q.data;
  useEffect(() => {
    if (data) remember({ chain: data.dossier.profile.ref.chain, address: data.dossier.profile.ref.address, symbol: data.dossier.profile.symbol });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.dossier.profile.ref.address]);

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
        <p className="eyebrow">Autopsy in progress</p>
        <h1 className="mt-3 font-display text-4xl text-bone">Examining the body…</h1>
        <Mono className="mt-2 block">{shortAddress(address, 8, 8)}</Mono>
        <StepLoader steps={STEPS} className="mt-8 max-w-md" pace={1400} />
      </div>
    );
  }
  if (q.isError || !data) {
    return (
      <div className="mx-auto max-w-[760px] px-4 py-16 sm:px-6">
        <h1 className="font-display text-4xl text-bone">The autopsy could not be completed.</h1>
        <p className="mt-3 text-bone-2">{(q.error as Error)?.message ?? "Unknown error."}</p>
        <div className="mt-6 flex gap-3">
          <button onClick={() => q.refetch()} className="h-11 rounded-[10px] bg-ember px-5 text-sm font-semibold text-[#1a1206]">
            Try again
          </button>
          <ButtonLink href="/discover" variant="ghost">
            Back to the register
          </ButtonLink>
        </div>
      </div>
    );
  }

  const { dossier, diagnosis: d, eligibility: el, plot, graves } = data;
  const p = dossier.profile;
  const ch = CHAINS[p.ref.chain as ChainId];
  const v = dossier.vitals;
  const key = `${p.ref.chain}:${p.ref.address}`;
  const watched = prefs.watchlist.includes(key);
  const cond = d.condition;
  const color = CONDITION_STYLE[cond].color;
  const simulated = dossier.historySource === "simulated";
  const beats = beatsFromVolumes(dossier.history.map((c) => c.v), 56);
  const createdSecs = p.createdAt ? Math.floor(p.createdAt / 1000) : dossier.history[0]?.t;

  const buryHere = ch.network === NETWORK;
  const timeline = [
    createdSecs && { t: createdSecs, label: "Born", detail: `First market opened${p.primaryPool?.dex && p.primaryPool.dex !== "simulated" ? ` on ${p.primaryPool.dex}` : ""}.` },
    d.historyTruncated && dossier.history[0] && { t: dossier.history[0].t, label: "Records begin", detail: `Our price history starts here (${dossier.history.length} days).` },
    d.athAt && !d.deadBeforeRecords && { t: d.athAt, label: d.historyTruncated ? "Highest in our records" : "Peak", detail: `${d.historyTruncated ? "Highest" : "All-time high"} close of ${price(d.athPriceUsd)}.` },
    d.cause.code === "SUDDEN_COLLAPSE" && { t: undefined, label: "Collapse", detail: d.cause.detail },
    d.timeOfDeath && { t: d.timeOfDeath, label: "Time of death", detail: `Daily volume fell below 1% of its peak and never recovered.` },
    d.deadBeforeRecords && { t: undefined, label: "Time of death", detail: "Before our records begin: it was already flatlining on day one of our history." },
    d.lastSignOfLife && { t: d.lastSignOfLife.t, label: "Last sign of life", detail: `${usd(d.lastSignOfLife.volumeUsd)} traded that day.` },
    plot && { t: Number(plot.opened_at), label: "First burial", detail: `${plot.grave_count} grave${plot.grave_count === 1 ? "" : "s"} in this plot so far.` },
  ].filter(Boolean) as { t?: number; label: string; detail: string }[];

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-20 pt-8 sm:px-6 sm:pt-12">
      {simulated && (
        <div className="mb-6">
          <Notice tone="warn">
            Testnet test bag. Its market history is simulated (devnet tokens have no DEX market). Burials, NEAR verification and payouts
            are real.
          </Notice>
        </div>
      )}

      {/* header */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-4">
          <TokenGlyph symbol={p.symbol} src={p.imageUrl} size={64} dim={cond === "DEAD"} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <ConditionTag condition={cond} />
              <span className="text-xs text-bone-4">{ch.name}</span>
            </div>
            <h1 className="mt-1 font-display text-5xl leading-none text-bone sm:text-6xl">${p.symbol}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-bone-3">
              <span>{p.name}</span>
              <a className="font-mono text-xs hover:text-bone" href={ch.explorer.token(p.ref.address)} target="_blank" rel="noreferrer">
                {shortAddress(p.ref.address, 6, 6)} ↗
              </a>
            </div>
            <p className="mt-3 font-display text-2xl italic" style={{ color }}>
              {d.headline}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => toggleWatch(key)}
            className="h-11 rounded-[10px] border border-line-strong px-4 text-sm text-bone hover:border-bone-4"
            aria-pressed={watched}
          >
            {watched ? "Watching" : "Watch"}
          </button>
          <a
            href={`/api/og/token/${p.ref.chain}/${p.ref.address}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center rounded-[10px] border border-line-strong px-4 text-sm text-bone hover:border-bone-4"
          >
            Death certificate
          </a>
          {el.ok && buryHere ? (
            <ButtonLink href={`/bury?chain=${p.ref.chain}&token=${p.ref.address}`}>Bury ${p.symbol}</ButtonLink>
          ) : el.ok ? (
            <ButtonLink href="/bury" variant="ghost">
              Mainnet burials open after audit · try a test bag
            </ButtonLink>
          ) : (
            <span className="inline-flex h-11 items-center rounded-[10px] border border-line px-4 text-sm text-bone-4" title={el.reason}>
              Not buriable
            </span>
          )}
        </div>
      </div>

      {/* score + pulse */}
      <div className="mt-10 grid gap-4 lg:grid-cols-[auto_1fr]">
        <Panel className="p-6">
          <DeathScore score={d.deathScore} condition={cond} evidence={d.evidence} />
          <div className="mt-6 border-t border-line pt-4">
            <div className="eyebrow">Cause of death</div>
            <div className="mt-1 font-display text-2xl text-bone">{d.cause.title}</div>
            <p className="mt-1 max-w-sm text-sm text-bone-2">{d.cause.detail}</p>
          </div>
        </Panel>
        <Panel className="flex flex-col p-6">
          <div className="flex items-center justify-between">
            <div className="eyebrow">Vital signs · last {beats.length} days</div>
            <span className="text-xs text-bone-4">each beat = one day of volume</span>
          </div>
          <Pulse beats={beats.length ? beats : [0, 0, 0, 0]} color={cond === "ALIVE" ? "var(--alive)" : color} className="mt-3 h-28 w-full flex-1" scan={cond !== "DEAD"} />
          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
            {[
              ["Price", price(v.priceUsd?.value)],
              ["Liquidity", usd(v.liquidityUsd?.value)],
              ["24h volume", usd(v.volume24hUsd?.value)],
              [v.traders24h ? "24h traders" : "24h trades", (v.traders24h ?? v.trades24h)?.value?.toLocaleString() ?? "—"],
            ].map(([k, val]) => (
              <div key={k}>
                <dt className="eyebrow">{k}</dt>
                <dd className="mt-1 text-lg font-semibold tabular text-bone">{val}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      {/* chart */}
      <Panel className="mt-4 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl text-bone">Life, in one line</h2>
          <span className="text-xs text-bone-4">{dossier.historySource ? `source: ${dossier.historySource}` : ""}</span>
        </div>
        <LifeChart history={dossier.history} athAt={d.deadBeforeRecords ? undefined : d.athAt} timeOfDeath={d.timeOfDeath} athLabel={d.historyTruncated ? "high" : "ATH"} />
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        {/* evidence */}
        <Panel className="p-6">
          <h2 className="font-display text-2xl text-bone">The evidence</h2>
          <p className="mt-1 text-sm text-bone-3">
            Each signal is scored from 0 (alive) to 1 (dead) against fixed anchors. Model {d.modelVersion}.{" "}
            <Link className="text-ember hover:underline" href="/how#methodology">Methodology</Link>
          </p>
          <ul className="mt-5 divide-y divide-line">
            {d.components.map((c) => (
              <li key={c.key} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-3">
                <div>
                  <div className="text-sm font-semibold text-bone">{c.label}</div>
                  <div className="text-xs text-bone-4">{c.anchors}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm tabular text-bone-2">{c.measured ?? "not measured"}</div>
                  <div className="text-[11px] text-bone-4">weight {Math.round(c.weight * 100)}%{c.source ? ` · ${c.source}` : ""}</div>
                </div>
                <div className="col-span-2 mt-1 h-1.5 overflow-hidden rounded-full bg-loam-3">
                  {c.score !== undefined && (
                    <div className="h-full rounded-full" style={{ width: `${Math.max(3, c.score * 100)}%`, background: c.score > 0.8 ? "var(--dead)" : c.score > 0.5 ? "var(--critical)" : c.score > 0.25 ? "var(--fading)" : "var(--alive)" }} />
                  )}
                </div>
              </li>
            ))}
          </ul>
          {d.notes.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm text-bone-2">
              {d.notes.map((n) => (
                <li key={n} className="rounded-[10px] border border-line bg-loam-2 px-3 py-2">{n}</li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-4">
          {/* life story */}
          <Panel className="p-6">
            <h2 className="font-display text-2xl text-bone">Life story</h2>
            <ol className="relative mt-5 space-y-5 border-l border-line pl-5">
              {timeline.map((e) => (
                <li key={e.label} className="relative">
                  <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full border border-bone-3 bg-loam" />
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-bone">{e.label}</span>
                    {e.t && <span className="text-xs tabular text-bone-4">{isoDay(e.t)}</span>}
                  </div>
                  <p className="text-sm text-bone-2">{e.detail}</p>
                </li>
              ))}
              <li className="relative">
                <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full" style={{ background: color }} />
                <span className="text-sm font-semibold text-bone">Today</span>
                <p className="text-sm text-bone-2">{d.headline}.</p>
              </li>
            </ol>
          </Panel>

          {/* burial status */}
          <Panel className="p-6">
            <h2 className="font-display text-2xl text-bone">Burial</h2>
            {el.ok ? (
              <p className="mt-2 text-sm text-bone-2">
                {el.kind === "ranked"
                  ? "Eligible. A grave for this token carries ossuary weight: it shares in every other plot's rising."
                  : "Eligible as an unmarked grave: it can rise, but carries no ossuary weight."}
              </p>
            ) : (
              <p className="mt-2 text-sm text-bone-2">{el.reason}</p>
            )}
            {el.ok && el.notes.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-fading">
                {el.notes.map((n) => (
                  <li key={n}>· {n}</li>
                ))}
              </ul>
            )}
            {plot ? (
              <div className="mt-4 rounded-[12px] border border-line bg-loam-2 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-bone">Plot ${plot.symbol}</span>
                  <ConditionTag condition={plot.state.kind} pulse={plot.state.kind === "STIRRING"} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="font-display text-xl text-bone">{plot.grave_count}</div>
                    <div className="text-[10px] uppercase tracking-wider text-bone-4">graves</div>
                  </div>
                  <div>
                    <div className="font-display text-xl text-bone">{tokenAmount(plot.total_amount, plot.decimals)}</div>
                    <div className="text-[10px] uppercase tracking-wider text-bone-4">buried</div>
                  </div>
                  <div>
                    <div className="font-display text-xl text-bone">{usd(Number(plot.total_weight_usd_e6) / 1e6)}</div>
                    <div className="text-[10px] uppercase tracking-wider text-bone-4">weight</div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-bone-3">
                  Rises if, for {Math.round(Number(plot.terms.window_secs) / 60) >= 1440 ? `${Number(plot.terms.window_secs) / 86400} days` : `${Math.round(Number(plot.terms.window_secs) / 60)} min (testnet)`}: liquidity ≥ {usd(Number(plot.terms.min_liquidity_usd))}, volume ≥{" "}
                  {usd(requiredVolume({ minVolume24hUsd: Number(plot.terms.min_volume_24h_usd), minPeakVolumeShareBps: plot.terms.min_peak_volume_share_bps } as never, { baselineMcapUsd: Number(plot.baseline_mcap_usd), peakDailyVolumeUsd: Number(plot.peak_daily_volume_usd) }))}
                  , market cap ≥{" "}
                  {usd(requiredMcap({ minMcapUsd: Number(plot.terms.min_mcap_usd), minMcapMultipleX100: plot.terms.min_mcap_multiple_x100 } as never, { baselineMcapUsd: Number(plot.baseline_mcap_usd), peakDailyVolumeUsd: 0 }))}
                  , {plot.terms.min_traders_24h}+ traders.
                </p>
                {graves.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {graves.slice(0, 5).map((g) => (
                      <li key={g.id}>
                        <Link href={`/grave/${g.id}`} className="flex justify-between text-sm text-bone-2 hover:text-bone">
                          <span className="font-display">{graveNo(g.id)}</span>
                          <span className="tabular">{tokenAmount(g.amount, g.decimals)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs text-bone-4">No graves yet. The first burial opens this token&rsquo;s plot and freezes its resurrection terms.</p>
            )}
          </Panel>

          {/* provenance */}
          <Panel className="p-6">
            <h2 className="eyebrow">Provenance</h2>
            <ul className="mt-3 space-y-1 text-xs text-bone-3">
              <li>Fetched {new Date(dossier.fetchedAt).toLocaleString()}</li>
              <li>Market: {v.liquidityUsd?.source ?? "—"} · History: {dossier.historySource ?? "unavailable"} · Safety: {dossier.safety?.source.join(", ") || "—"}</li>
              {dossier.gaps.map((g) => (
                <li key={g} className="text-fading">{g}</li>
              ))}
              {dossier.safety?.flags.map((f) => (
                <li key={f.code} className={cx(f.severity === "ineligible" ? "text-danger" : "text-fading")}>
                  {f.severity === "ineligible" ? "Blocks burial: " : "Warning: "}
                  {f.detail}
                </li>
              ))}
              {createdSecs && <li>Created {date(createdSecs)}</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
