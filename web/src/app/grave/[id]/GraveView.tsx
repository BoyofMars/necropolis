"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Pulse } from "@/components/Pulse";
import { Button, ButtonLink, ConditionTag, Notice, Panel, cx } from "@/components/ui";
import { CHAINS, shortAddress, type ChainId } from "@/core/chains";
import { graveStage } from "@/core/graveArt";
import { CONTRACT_ID, MPC_SIGNER, NETWORK, nearAccountUrl, registry, type EventJson, type GraveJson, type PlotJson } from "@/core/near";
import { checkObservation, describeWindow, riteProgress } from "@/core/resurrection";
import { post } from "@/lib/api";
import { syntheticBeats } from "@/lib/beats";
import { ago, compact, date, graveNo, tokenAmount, usd } from "@/lib/format";
import { baseOf, obsOf, stateOf, termsOf } from "@/lib/rite";
import { ownerIds, useWallets } from "@/lib/wallets";
import { Keeper } from "./Keeper";

interface Bundle {
  grave: GraveJson;
  plot: PlotJson | null;
  events: EventJson[];
}

async function load(id: number): Promise<Bundle | null> {
  const grave = await registry.grave(id);
  if (!grave) return null;
  const [plot, events] = await Promise.all([registry.plot(grave.plot_id), registry.events()]);
  return { grave, plot, events };
}

export function GraveView({ id }: { id: number }) {
  const q = useQuery({ queryKey: ["grave", id], queryFn: () => load(id), refetchInterval: 15_000 });
  const qc = useQueryClient();
  const w = useWallets();

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[420px_1fr]">
          <div className="skeleton aspect-[5/6] w-full" />
          <div className="space-y-3">
            <div className="skeleton h-10 w-2/3" />
            <div className="skeleton h-5 w-1/2" />
            <div className="skeleton h-40 w-full" />
          </div>
        </div>
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="mx-auto max-w-[760px] px-4 py-16">
        <Notice tone="danger">Could not read this grave from NEAR: {(q.error as Error).message}</Notice>
        <Button className="mt-4" variant="ghost" onClick={() => q.refetch()}>Try again</Button>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="mx-auto max-w-[760px] px-4 py-20 text-center">
        <h1 className="font-display text-5xl text-bone">{graveNo(id)}</h1>
        <p className="mt-3 text-bone-2">No grave with this number exists yet.</p>
        <ButtonLink className="mt-6" href="/cemetery" variant="ghost">Walk the cemetery</ButtonLink>
      </div>
    );
  }

  const { grave: g, plot, events } = q.data;
  const ch = CHAINS[g.chain as ChainId];
  const stage = graveStage(g, plot);
  // Ownership follows the NEAR owner id (which changes on transfer), not the burier.
  const mine = ownerIds(w).includes(g.owner_id);
  const terms = plot ? termsOf(plot) : null;
  const latest = plot?.last_observation ? obsOf(plot.last_observation) : undefined;
  const checks = plot && latest && terms ? checkObservation(terms, baseOf(plot), latest) : [];
  const prog = plot && terms ? riteProgress(terms, baseOf(plot), stateOf(plot), latest) : null;
  const ownedEvents = events.filter((e) => e.plot_id !== g.plot_id);
  const refresh = () => qc.invalidateQueries({ queryKey: ["grave", id] });

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
      <div className="grid gap-8 lg:grid-cols-[420px_1fr]">
        {/* the stone */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/grave/${g.id}/image.svg?s=${stage}-${plot?.observations ?? 0}`}
            alt={`Headstone for grave ${graveNo(g.id)}: ${plot?.symbol ?? ""}, ${stage}`}
            className={cx("w-full rounded-[20px] border", stage === "stirring" ? "border-ember/50 stirring-glow" : stage === "risen" ? "border-ember-bright/60" : "border-line")}
            width={600}
            height={720}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <ShareButton id={g.id} symbol={plot?.symbol ?? ""} stage={stage} />
            <a href={`/api/grave/${g.id}/image.svg`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-[10px] border border-line px-3 text-sm text-bone-2 hover:text-bone">
              NFT image ↗
            </a>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inscription text-sm text-bone-3">Grave</span>
              {plot && <ConditionTag condition={plot.state.kind} pulse={plot.state.kind === "STIRRING"} />}
              {mine && <span className="rounded-full border border-alive/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-alive">yours</span>}
            </div>
            <h1 className="mt-1 font-display text-6xl leading-none text-bone">{graveNo(g.id)}</h1>
            <p className="mt-3 text-lg text-bone-2">
              {tokenAmount(g.amount, g.decimals)}{" "}
              <Link href={`/token/${g.chain}/${g.token}`} className="text-bone hover:text-ember">${plot?.symbol}</Link> buried on {ch.name}, {date(g.buried_at)}.
            </p>
            {g.epitaph && <p className="mt-4 font-display text-2xl italic text-bone-2">&ldquo;{g.epitaph}&rdquo;</p>}
          </div>

          <Panel className="p-6">
            <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              {[
                ["Value at burial", usd(Number(g.value_usd_e6) / 1e6, { precise: true })],
                ["Ossuary weight", Number(g.weight_usd_e6) > 0 ? usd(Number(g.weight_usd_e6) / 1e6, { precise: true }) : "unmarked"],
                ["Death score", `${g.death_score}`],
                ["If it rises", `${tokenAmount(BigInt(g.amount) - BigInt(g.tithe), g.decimals)} back`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="eyebrow">{k}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular text-bone">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          {/* the rite */}
          {plot && terms && (
            <Panel className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-2xl text-bone">The rite</h2>
                <span className="text-xs text-bone-4">
                  {plot.observations} observation{plot.observations === 1 ? "" : "s"} · {plot.state.kind === "RESTING" && plot.state.false_dawns > 0 ? `${plot.state.false_dawns} false dawn(s) · ` : ""}rises after {describeWindow(terms)}
                </span>
              </div>
              <Pulse
                beats={syntheticBeats(stage === "risen" ? "risen" : stage === "stirring" ? "stirring" : "dead", 40, g.id + plot.observations)}
                color={stage === "stirring" || stage === "risen" ? "var(--ember)" : "var(--bone-4)"}
                glow={stage === "stirring" || stage === "risen"}
                scan={stage === "stirring"}
                className="mt-4 h-20 w-full"
              />
              {prog && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-bone-3">
                    <span>Resurrection progress</span>
                    <span className="tabular">{Math.round(prog.overall * 100)}%</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-loam-3">
                    <div className="h-full rounded-full bg-ember transition-[width] duration-700" style={{ width: `${Math.max(2, prog.overall * 100)}%` }} />
                  </div>
                </div>
              )}
              {checks.length > 0 ? (
                <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                  {checks.map((c) => (
                    <li key={c.key} className="flex items-center justify-between rounded-[10px] border border-line bg-loam-2 px-3 py-2 text-sm">
                      <span className="text-bone-3">{c.label}</span>
                      <span className={cx("tabular", c.pass ? "text-alive" : "text-bone-2")}>
                        {c.measured} <span className="text-bone-4">/ {c.required}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-bone-3">No vital signs reported since burial. The plot rests.</p>
              )}
              {latest && <p className="mt-3 text-xs text-bone-4">Last observation {ago(latest.t)} · reported by a coroner, judged by the contract.</p>}
              {NETWORK === "testnet" && plot.state.kind !== "RISEN" && <Seance plotId={plot.id} onChange={refresh} state={plot.state.kind} />}
            </Panel>
          )}

          {/* raising */}
          {plot?.state.kind === "RISEN" && <Raise g={g} onDone={refresh} />}

          {/* owner actions, wallet-signed */}
          {mine && <Keeper g={g} onDone={refresh} />}

          {/* ossuary */}
          <Panel className="p-6">
            <h2 className="font-display text-2xl text-bone">Ossuary shares</h2>
            <p className="mt-1 text-sm text-bone-3">Every rising elsewhere in the cemetery while this grave rests pays it a share of the tithe.</p>
            {ownedEvents.length === 0 ? (
              <p className="mt-4 text-sm text-bone-4">No other plot has risen since this burial. Yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line">
                {ownedEvents.map((e) => (
                  <ShareRow key={e.id} g={g} e={e} />
                ))}
              </ul>
            )}
          </Panel>

          {/* proof */}
          <Panel className="p-6">
            <h2 className="font-display text-2xl text-bone">Proof</h2>
            <dl className="mt-4 space-y-3 text-sm">
              {[
                ["Burial transaction", <a key="1" className="font-mono text-ember hover:underline" href={ch.explorer.tx(g.deposit_tx)} target="_blank" rel="noreferrer">{shortAddress(g.deposit_tx, 10, 8)} ↗</a>],
                ["Grave address", <a key="2" className="font-mono text-ember hover:underline" href={ch.explorer.address(g.grave_address)} target="_blank" rel="noreferrer">{shortAddress(g.grave_address, 10, 8)} ↗</a>],
                ["Derivation", <span key="3" className="break-all font-mono text-xs text-bone-2">{CONTRACT_ID} · {g.path}</span>],
                ["MPC attestation", <span key="4" className="break-all font-mono text-xs text-bone-2">sha256 payload {g.proof_hash}</span>],
                ["Signer network", <a key="5" className="font-mono text-ember hover:underline" href={nearAccountUrl(MPC_SIGNER)} target="_blank" rel="noreferrer">{MPC_SIGNER} ↗</a>],
                ["Owner", <span key="6" className="break-all font-mono text-xs text-bone-2">{g.owner_id} <span className="text-bone-4">(= {shortAddress(g.origin_owner, 6, 6)} on {ch.name})</span></span>],
                ["NEAR record", <a key="7" className="font-mono text-ember hover:underline" href={nearAccountUrl(CONTRACT_ID)} target="_blank" rel="noreferrer">{CONTRACT_ID} · get_grave({g.id}) ↗</a>],
              ].map(([k, v]) => (
                <div key={k as string} className="grid gap-1 sm:grid-cols-[170px_1fr]">
                  <dt className="text-bone-3">{k}</dt>
                  <dd className="min-w-0">{v}</dd>
                </div>
              ))}
            </dl>
            <Link href="/proof" className="mt-4 inline-block text-sm text-ember hover:underline">Re-derive this address yourself →</Link>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Seance({ plotId, onChange, state }: { plotId: string; onChange: () => void; state: string }) {
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = async (mode: "revive" | "false-dawn") => {
    try {
      const r = await post<{ state?: { kind: string }; skipped?: string; waitSeconds?: number; transition?: string; risen?: boolean }>("/api/seance", { plotId, mode });
      onChange();
      if (r.skipped) setMsg(`Coroner will report again ${r.skipped.replace("next observation in ", "in ")}.`);
      else setMsg(r.risen ? "The plot has risen." : `Coroner reported: ${String(r.transition ?? "").replace(/([A-Z])/g, " $1").trim().toLowerCase()}.`);
      return r;
    } catch (e) {
      setMsg((e as Error).message);
      return null;
    }
  };

  useEffect(() => {
    if (!running) return;
    let alive = true;
    const loop = async () => {
      const r = await tick("revive");
      if (!alive) return;
      if (r?.risen || r?.state?.kind === "RISEN") {
        setRunning(false);
        setNext(null);
        return;
      }
      const wait = (r?.waitSeconds ?? 60) * 1000 + 3_000;
      setNext(Date.now() + wait);
      timer.current = setTimeout(loop, wait);
    };
    loop();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // A ticking clock in state keeps render pure (no Date.now() while rendering).
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!next) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [next]);

  return (
    <div className="mt-6 rounded-[14px] border border-dashed border-fading/40 bg-loam/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-fading">Séance · testnet only</div>
          <p className="mt-1 max-w-md text-xs text-bone-3">
            Feeds <em>simulated</em> recovery vitals to the coroner so you can watch the contract run the rite on compressed timers. The contract still checks every rule.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setRunning((r) => !r)} variant={running ? "ghost" : "primary"}>
            {running ? "Stop séance" : state === "STIRRING" ? "Continue séance" : "Begin séance"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => tick("false-dawn")} disabled={running}>
            Fake a pump
          </Button>
        </div>
      </div>
      {(msg || next) && (
        <p className="mt-3 text-xs text-bone-2" aria-live="polite">
          {msg} {running && next && now && next > now ? `Next reading in ${Math.ceil((next - now) / 1000)}s.` : ""}
        </p>
      )}
    </div>
  );
}

function Raise({ g, onDone }: { g: GraveJson; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ txs: string[]; nearTx?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ch = CHAINS[g.chain as ChainId];
  return (
    <Panel className="border-ember/40 p-6">
      <h2 className="font-display text-3xl ember-text">Risen.</h2>
      <p className="mt-2 text-bone-2">
        This plot met every condition of the rite. Raising the grave asks NEAR&rsquo;s MPC network to sign the payout from the grave address:
        {" "}<span className="text-bone">{tokenAmount(BigInt(g.amount) - BigInt(g.tithe), g.decimals)}</span> to the owner,{" "}
        <span className="text-bone">{tokenAmount(g.tithe, g.decimals)}</span> to the ossuary.
      </p>
      {res ? (
        <div className="mt-4 space-y-1 text-sm">
          {res.txs.map((t) => (
            <a key={t} className="block font-mono text-ember hover:underline" href={t === "already-broadcast" ? "#" : ch.explorer.tx(t)} target="_blank" rel="noreferrer">
              {t === "already-broadcast" ? "Already broadcast" : `${shortAddress(t, 10, 8)} ↗`}
            </a>
          ))}
        </div>
      ) : (
        <Button
          className="mt-5"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const r = await post<{ txs: string[]; nearTx?: string }>("/api/raise", { graveId: g.id });
              setRes(r);
              onDone();
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "MPC network signing…" : g.raised ? "Re-broadcast payout" : "Raise this grave"}
        </Button>
      )}
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
      <p className="mt-3 text-xs text-bone-4">Anyone can raise a risen grave. The payout always goes to the grave&rsquo;s owner.</p>
    </Panel>
  );
}

function ShareRow({ g, e }: { g: GraveJson; e: EventJson }) {
  const q = useQuery({ queryKey: ["share", g.id, e.id], queryFn: () => registry.share(g.id, e.id) });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const s = q.data;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <div className="text-sm text-bone">${e.symbol} rose {date(e.at)}</div>
        <div className="text-xs text-bone-3">
          {s?.eligible ? `${compact(Number(s.amount) / 10 ** e.decimals)} $${e.symbol} owed to this grave` : s?.reason ?? "…"}
        </div>
      </div>
      {s?.eligible &&
        (s.claimed || done ? (
          <span className="text-xs text-alive">{done ?? "Claimed"}</span>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await post<{ txs: string[] }>("/api/claim", { graveId: g.id, eventId: e.id });
                setDone(`Paid · ${shortAddress(r.txs[0] ?? "", 6, 4)}`);
              } catch (err) {
                setDone((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Signing…" : "Claim"}
          </Button>
        ))}
    </li>
  );
}

function ShareButton({ id, symbol, stage }: { id: number; symbol: string; stage: string }) {
  const [copied, setCopied] = useState(false);
  const text =
    stage === "risen"
      ? `Grave ${graveNo(id)} has RISEN. $${symbol} came back from the dead.`
      : stage === "stirring"
        ? `Grave ${graveNo(id)} is stirring. $${symbol} is showing signs of life.`
        : `I buried my $${symbol} bag. ${graveNo(id)}. If it ever comes back, I get it back.`;
  const url = typeof window !== "undefined" ? `${window.location.origin}/grave/${id}` : `/grave/${id}`;
  return (
    <>
      <a
        className="inline-flex h-10 items-center rounded-[10px] bg-ember px-4 text-sm font-semibold text-on-ember hover:bg-ember-bright"
        href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noreferrer"
      >
        Share on X
      </a>
      <button
        className="inline-flex h-10 items-center rounded-[10px] border border-line px-3 text-sm text-bone-2 hover:text-bone"
        onClick={async () => {
          try {
            if (navigator.share) await navigator.share({ title: graveNo(id), text, url });
            else {
              await navigator.clipboard.writeText(`${text} ${url}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          } catch {
            /* dismissed */
          }
        }}
      >
        {copied ? "Copied" : "Share"}
      </button>
    </>
  );
}
