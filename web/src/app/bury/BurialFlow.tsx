"use client";

import { Transaction } from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSendTransaction, useSwitchChain } from "wagmi";
import { Pulse } from "@/components/Pulse";
import { StepLoader } from "@/components/StepLoader";
import { Button, ButtonLink, ConditionTag, Mono, Notice, Panel, TokenGlyph, cx } from "@/components/ui";
import { CHAINS, shortAddress, type ChainId } from "@/core/chains";
import { CONTRACT_ID, NETWORK, nearTxUrl } from "@/core/near";
import { describeWindow, TESTNET_TERMS, MAINNET_TERMS } from "@/core/resurrection";
import { api, post, type ScanResult } from "@/lib/api";
import { syntheticBeats } from "@/lib/beats";
import { compact, graveNo, usd } from "@/lib/format";
import { EVM_CHAIN, SOL_CHAIN, useConnectSheet, useWallets } from "@/lib/wallets";

interface Prepared {
  chain: ChainId;
  token: string;
  owner: string;
  nonce: number;
  path: string;
  graveAddress: string;
  graveTokenAccount?: string;
  decimals: number;
  amount: string;
  closesAccount?: boolean;
  solanaTx?: string;
  evmTx?: { to: string; data: string; chainId: number };
  appraisal: { valueUsd: number; weightUsd: number; priceUsd: number; capUsd: number };
  eligibility: { ok: true; kind: "ranked" | "unmarked"; notes: string[] };
  diagnosis: { condition: "DEAD" | "CRITICAL" | "UNKNOWN"; deathScore?: number; headline: string };
  opensPlot: boolean;
}

type Confirm =
  | { stage: "finalizing"; detail: string }
  | { stage: "verifying"; detail: string }
  | { stage: "buried"; graveId: number; nearTx?: string }
  | { stage: "failed"; reason: string; nearTx?: string };

type Phase =
  | { k: "choose" }
  | { k: "review"; prep: Prepared }
  | { k: "signing"; prep: Prepared }
  | { k: "confirming"; prep: Prepared; tx: string; status?: Confirm }
  | { k: "done"; prep: Prepared; tx: string; graveId: number; nearTx?: string }
  | { k: "error"; message: string; prep?: Prepared; tx?: string };

const PENDING_KEY = "necropolis:pending-burial";
const TERMS = NETWORK === "mainnet" ? MAINNET_TERMS : TESTNET_TERMS;

export function BurialFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const w = useWallets();
  const { open } = useConnectSheet();
  const { mutateAsync: sendEvm } = useSendTransaction();
  const { mutateAsync: switchChain } = useSwitchChain();
  const [phase, setPhase] = useState<Phase>({ k: "choose" });
  const [epitaph, setEpitaph] = useState("");
  const [pct, setPct] = useState(100);
  const [busy, setBusy] = useState<string | null>(null);

  const qChain = params.get("chain") as ChainId | null;
  const qToken = params.get("token");
  const family = qChain ? CHAINS[qChain]?.family : null;
  const owner = family === "evm" ? w.evm : family === "solana" ? w.sol : null;

  // Resume a burial interrupted by a refresh.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { prep: Prepared; tx: string; epitaph?: string };
        setEpitaph(saved.epitaph ?? "");
        setPhase({ k: "confirming", prep: saved.prep, tx: saved.tx });
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Wallet holdings for picking a bag (testnet bags or whatever the wallet holds).
  const holdings = useQuery({
    queryKey: ["bury-holdings", qChain ?? (w.sol ? SOL_CHAIN : EVM_CHAIN), owner ?? w.sol ?? w.evm],
    enabled: phase.k === "choose" && !!(owner ?? w.sol ?? w.evm),
    queryFn: () => {
      const chain = qChain ?? (w.sol ? SOL_CHAIN : EVM_CHAIN);
      const addr = (qChain ? owner : w.sol ?? w.evm) as string;
      return api<ScanResult>(`/api/scan?chain=${chain}&address=${addr}`);
    },
  });

  const selected = useMemo(() => {
    if (!qToken || !holdings.data) return null;
    return holdings.data.entries.find((e) => e.address.toLowerCase() === qToken.toLowerCase()) ?? null;
  }, [qToken, holdings.data]);

  // Poll confirmation.
  useEffect(() => {
    if (phase.k !== "confirming") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await post<Confirm>("/api/bury/confirm", {
          chain: phase.prep.chain,
          token: phase.prep.token,
          owner: phase.prep.owner,
          nonce: phase.prep.nonce,
          amount: phase.prep.amount,
          tx: phase.tx,
          epitaph,
        });
        if (cancelled) return;
        if (r.stage === "buried") {
          localStorage.removeItem(PENDING_KEY);
          setPhase({ k: "done", prep: phase.prep, tx: phase.tx, graveId: r.graveId, nearTx: r.nearTx });
          return;
        }
        if (r.stage === "failed") {
          setPhase({ k: "error", message: r.reason, prep: phase.prep, tx: phase.tx });
          return;
        }
        setPhase((p) => (p.k === "confirming" ? { ...p, status: r } : p));
        timer = setTimeout(tick, r.stage === "finalizing" ? 4_000 : 2_500);
      } catch (e) {
        if (cancelled) return;
        setPhase((p) => (p.k === "confirming" ? { ...p, status: { stage: "verifying", detail: `Retrying… (${(e as Error).message})` } } : p));
        timer = setTimeout(tick, 6_000);
      }
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.k]);

  const prepare = async () => {
    if (!selected || !qChain || !owner) return;
    setBusy("Preparing your grave…");
    try {
      const raw = BigInt(selected.amountRaw);
      const amount = pct === 100 ? raw : (raw * BigInt(pct)) / 100n;
      const prep = await post<Prepared>("/api/bury/prepare", { chain: qChain, token: selected.address, owner, amount: amount.toString() });
      setPhase({ k: "review", prep });
    } catch (e) {
      setPhase({ k: "error", message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const sign = async (prep: Prepared) => {
    setPhase({ k: "signing", prep });
    try {
      let tx: string;
      if (prep.solanaTx) {
        const wallet = w.solWallet;
        if (!wallet.signTransaction) throw new Error("This wallet cannot sign transactions.");
        const t = Transaction.from(Buffer.from(prep.solanaTx, "base64"));
        const signed = await wallet.signTransaction(t);
        const r = await post<{ signature: string }>("/api/bury/submit", {
          chain: prep.chain,
          tx: signed.serialize({ requireAllSignatures: true }).toString("base64"),
        });
        tx = r.signature;
      } else if (prep.evmTx) {
        if (w.evmChainId !== prep.evmTx.chainId) await switchChain({ chainId: prep.evmTx.chainId });
        tx = await sendEvm({ to: prep.evmTx.to as `0x${string}`, data: prep.evmTx.data as `0x${string}`, chainId: prep.evmTx.chainId });
      } else throw new Error("Nothing to sign.");
      localStorage.setItem(PENDING_KEY, JSON.stringify({ prep, tx, epitaph }));
      setPhase({ k: "confirming", prep, tx });
    } catch (e) {
      const m = (e as Error).message ?? "";
      setPhase({
        k: "error",
        prep,
        message: /reject|denied|cancel/i.test(m) ? "You declined the signature. Nothing was sent." : m.split("\n")[0],
      });
    }
  };

  // ---------------------------------------------------------------- render

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <p className="eyebrow">Burial</p>
      <h1 className="mt-3 font-display text-5xl leading-tight text-bone sm:text-6xl">Lay it to rest.</h1>
      <p className="mt-3 max-w-2xl text-bone-2">
        One native transaction from the wallet you already use. The token goes to its own grave address on its own chain;
        NEAR verifies it and mints your grave. No bridge, no NEAR wallet.
      </p>
      {NETWORK === "testnet" && (
        <div className="mt-6">
          <Notice tone="warn">
            Testnet: burials run on Solana devnet and Base Sepolia with real NEAR testnet verification. Need a dead bag?{" "}
            <TestBagFaucet />
          </Notice>
        </div>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          {phase.k === "choose" && (
            <ChooseStep
              qChain={qChain}
              owner={owner}
              holdings={holdings.data}
              loading={holdings.isLoading}
              error={holdings.error as Error | null}
              onConnect={() => open(family ?? undefined)}
              onPick={(chain, token) => router.replace(`/bury?chain=${chain}&token=${token}`)}
              selected={selected}
              pct={pct}
              setPct={setPct}
              onContinue={prepare}
              busy={busy}
              anyWallet={w.any}
            />
          )}
          {phase.k === "review" && (
            <ReviewStep prep={phase.prep} epitaph={epitaph} setEpitaph={setEpitaph} onBack={() => setPhase({ k: "choose" })} onSign={() => sign(phase.prep)} />
          )}
          {phase.k === "signing" && (
            <Panel className="p-8">
              <h2 className="font-display text-3xl text-bone">Check your wallet</h2>
              <p className="mt-2 text-bone-2">
                Approve the {CHAINS[phase.prep.chain].name} transaction: a transfer of {compact(Number(phase.prep.amount) / 10 ** phase.prep.decimals)} tokens to{" "}
                <Mono>{shortAddress(phase.prep.graveAddress, 6, 6)}</Mono>.
                {phase.prep.solanaTx && " Network fees are paid by Necropolis."}
              </p>
              <Pulse beats={syntheticBeats("dead", 30)} className="mt-6 h-16 w-full" scan />
            </Panel>
          )}
          {phase.k === "confirming" && <ConfirmingStep prep={phase.prep} tx={phase.tx} status={phase.status} />}
          {phase.k === "done" && <DoneStep prep={phase.prep} tx={phase.tx} graveId={phase.graveId} nearTx={phase.nearTx} />}
          {phase.k === "error" && (
            <Panel className="p-8">
              <h2 className="font-display text-3xl text-bone">The burial did not go through.</h2>
              <p className="mt-3 text-bone-2">{phase.message}</p>
              {phase.tx && (
                <p className="mt-3 text-sm text-bone-3">
                  Origin transaction:{" "}
                  <a className="font-mono text-ember hover:underline" target="_blank" rel="noreferrer" href={CHAINS[phase.prep!.chain].explorer.tx(phase.tx)}>
                    {shortAddress(phase.tx, 8, 8)} ↗
                  </a>
                  . If tokens left your wallet, they are in the grave address; this page can retry registration safely.
                </p>
              )}
              <div className="mt-6 flex flex-wrap gap-3">
                {phase.tx && phase.prep ? (
                  <Button onClick={() => setPhase({ k: "confirming", prep: phase.prep!, tx: phase.tx! })}>Retry registration</Button>
                ) : (
                  <Button onClick={() => { localStorage.removeItem(PENDING_KEY); setPhase({ k: "choose" }); }}>Start over</Button>
                )}
              </div>
            </Panel>
          )}
        </div>
        <aside className="space-y-4">
          <Panel className="p-5">
            <div className="eyebrow">What happens</div>
            <ol className="mt-3 space-y-3 text-sm text-bone-2">
              {[
                ["Native transfer", "Your token moves to a fresh grave address on its own chain."],
                ["MPC verification", "NEAR's MPC network reads that chain and attests to the deposit."],
                ["Grave minted", "A NEP-171 grave is minted to your own wallet key."],
                ["The rite", `If the token sustains a real recovery for ${describeWindow(TERMS)}, its plot rises.`],
                ["Raising", "80% returns to you. 20% goes to $BONES holders, the graves still resting."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="font-display text-bone-4">{i + 1}</span>
                  <span>
                    <span className="text-bone">{t}.</span> {d}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel className="p-5 text-sm text-bone-3">
            <div className="eyebrow">The fine print, in large print</div>
            <ul className="mt-3 space-y-2">
              <li>There is no early exit. Buried tokens stay in the grave until the plot rises.</li>
              <li>If the token never recovers, it stays buried forever.</li>
              <li>Coroners report market data; they cannot move buried tokens.</li>
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function ChooseStep(props: {
  qChain: ChainId | null;
  owner: string | null;
  holdings?: ScanResult;
  loading: boolean;
  error: Error | null;
  onConnect: () => void;
  onPick: (chain: ChainId, token: string) => void;
  selected: ScanResult["entries"][number] | null;
  pct: number;
  setPct: (n: number) => void;
  onContinue: () => void;
  busy: string | null;
  anyWallet: boolean;
}) {
  const { holdings, selected } = props;
  if (!props.anyWallet || (props.qChain && !props.owner)) {
    return (
      <Panel className="p-8">
        <h2 className="font-display text-3xl text-bone">Connect the wallet holding the bag</h2>
        <p className="mt-2 text-bone-2">
          {props.qChain ? `This token lives on ${CHAINS[props.qChain].name}.` : "Solana (Phantom, Solflare, Backpack) or Base (any browser wallet)."}
        </p>
        <Button className="mt-6" onClick={props.onConnect}>Connect wallet</Button>
      </Panel>
    );
  }
  if (props.loading) {
    return (
      <Panel className="p-8">
        <h2 className="font-display text-2xl text-bone">Looking through your wallet…</h2>
        <StepLoader steps={["Reading token accounts", "Checking which are dead"]} className="mt-6" />
      </Panel>
    );
  }
  if (props.error) return <Notice tone="danger">{props.error.message}</Notice>;
  const candidates = (holdings?.entries ?? []).filter((e) => e.diagnosis.condition !== "ALIVE" && e.diagnosis.condition !== "FADING");
  return (
    <div className="space-y-6">
      <Panel className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl text-bone">Choose the bag</h2>
          {holdings && <span className="text-xs text-bone-4">{CHAINS[holdings.chain].name}</span>}
        </div>
        {candidates.length === 0 ? (
          <p className="mt-3 text-sm text-bone-2">
            Nothing dead in this wallet{NETWORK === "testnet" ? " yet. Claim test bags above, then come back." : "."}
          </p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {candidates.map((e) => {
              const on = selected?.address === e.address;
              return (
                <li key={e.address}>
                  <button
                    onClick={() => props.onPick(holdings!.chain, e.address)}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-[12px] border px-4 py-3 text-left transition",
                      on ? "border-ember/70 bg-loam-2" : "border-line bg-loam-1 hover:border-bone-4",
                    )}
                    aria-pressed={on}
                  >
                    <TokenGlyph symbol={e.symbol} src={e.icon} size={34} dim />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-bone">${e.symbol}</span>
                        <ConditionTag condition={e.diagnosis.condition} />
                      </span>
                      <span className="block truncate text-xs text-bone-3">{compact(e.uiAmount)} held · {e.diagnosis.headline}</span>
                    </span>
                    <span className="font-display text-xl text-dead">{e.diagnosis.deathScore ?? "—"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {selected && (
        <Panel className="p-6">
          <h2 className="font-display text-2xl text-bone">How much?</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                onClick={() => props.setPct(p)}
                className={cx("h-10 rounded-[10px] border px-4 text-sm", props.pct === p ? "border-ember/70 bg-loam-2 text-bone" : "border-line text-bone-3 hover:text-bone")}
                aria-pressed={props.pct === p}
              >
                {p === 100 ? "All of it" : `${p}%`}
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-bone-2">
            Burying <span className="text-bone">{compact((selected.uiAmount * props.pct) / 100)} ${selected.symbol}</span>
            {props.pct === 100 && selected.testBag !== undefined && " — burying all of it also closes the empty token account and returns its rent to you."}
          </p>
          <Button className="mt-6" onClick={props.onContinue} disabled={!!props.busy}>
            {props.busy ?? "Review burial"}
          </Button>
        </Panel>
      )}
    </div>
  );
}

function ReviewStep({ prep, epitaph, setEpitaph, onBack, onSign }: { prep: Prepared; epitaph: string; setEpitaph: (s: string) => void; onBack: () => void; onSign: () => void }) {
  const ch = CHAINS[prep.chain];
  const ui = Number(prep.amount) / 10 ** prep.decimals;
  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-line p-6">
        <h2 className="font-display text-3xl text-bone">Review the burial</h2>
        <p className="mt-1 text-sm text-bone-3">Read this. It is the whole deal.</p>
      </div>
      <dl className="divide-y divide-line">
        {[
          ["You bury", <span key="a" className="text-bone">{compact(ui)} tokens ({prep.diagnosis.headline.toLowerCase()})</span>],
          ["On", ch.name],
          [
            "Grave address",
            <span key="g" className="block">
              <a className="font-mono text-sm text-ember hover:underline" href={ch.explorer.address(prep.graveAddress)} target="_blank" rel="noreferrer">
                {shortAddress(prep.graveAddress, 8, 8)} ↗
              </a>
              <span className="mt-1 block text-xs text-bone-4">
                Derived from <span className="font-mono">{CONTRACT_ID}</span> by NEAR Chain Signatures (path <span className="font-mono">{prep.path.slice(0, 22)}…</span>). Only the contract can sign for it.
              </span>
            </span>,
          ],
          ["Value today", `${usd(prep.appraisal.valueUsd, { precise: true })} at ${usd(prep.appraisal.priceUsd)} (7-day average)`],
          [
            "Ossuary weight",
            prep.eligibility.kind === "ranked"
              ? `${usd(prep.appraisal.weightUsd, { precise: true })}: mints ${prep.appraisal.weightUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} $BONES into your grave, your share of every other coin's rising.`
              : "None (unmarked grave): no $BONES. It can still rise.",
          ],
          ["You receive", "A grave (NEP-171 NFT on NEAR) owned by this same wallet key, with its own keyless NEAR account holding its $BONES. Sell the grave and they go with it."],
          ["It rises if", `the token sustains a real recovery for ${describeWindow(TERMS)} (liquidity, volume, traders, market cap, no wash trading).`],
          ["When it rises", "80% of your tokens come back to you. 20% goes to the ossuary, split among $BONES holders; your grave's BONES burn."],
          ["Fees", prep.solanaTx ? "None. Necropolis pays the Solana network fee and the grave account rent." : "Base network gas, paid from your wallet."],
        ].map(([k, v]) => (
          <div key={k as string} className="grid gap-1 px-6 py-4 sm:grid-cols-[160px_1fr]">
            <dt className="text-sm text-bone-3">{k}</dt>
            <dd className="text-sm text-bone-2">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-line p-6">
        <label className="eyebrow" htmlFor="epitaph">Epitaph (optional, public)</label>
        <input
          id="epitaph"
          maxLength={140}
          value={epitaph}
          onChange={(e) => setEpitaph(e.target.value)}
          placeholder="Here lies my conviction."
          className="mt-2 h-11 w-full rounded-[10px] border border-line-strong bg-loam px-4 font-display text-lg italic text-bone placeholder:text-bone-4 focus:border-bone-3 focus:outline-none"
        />
        {prep.eligibility.notes.length > 0 && (
          <ul className="mt-4 space-y-1 text-xs text-fading">
            {prep.eligibility.notes.map((n) => (
              <li key={n}>· {n}</li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button size="lg" onClick={onSign}>
            Sign and bury
          </Button>
          <Button size="lg" variant="ghost" onClick={onBack}>
            Back
          </Button>
        </div>
        <p className="mt-3 text-xs text-bone-4">There is no early exit. If the token never recovers, it stays buried.</p>
      </div>
    </Panel>
  );
}

function ConfirmingStep({ prep, tx, status }: { prep: Prepared; tx: string; status?: Confirm }) {
  const ch = CHAINS[prep.chain];
  const idx = !status || status.stage === "finalizing" ? 1 : 2;
  return (
    <Panel className="p-8">
      <h2 className="font-display text-3xl text-bone">Interment in progress</h2>
      <p className="mt-2 text-sm text-bone-2">
        You can leave this page; the burial will finish and you can resume here.{" "}
        <a className="font-mono text-ember hover:underline" href={ch.explorer.tx(tx)} target="_blank" rel="noreferrer">
          {shortAddress(tx, 6, 6)} ↗
        </a>
      </p>
      <StepLoader
        className="mt-8"
        doneIndex={idx}
        steps={[
          `Transfer sent on ${ch.name}`,
          prep.chain.startsWith("base") ? "Waiting for Base to settle on Ethereum (safe head)" : "Waiting for Solana finality",
          "NEAR MPC network verifying the deposit",
          "Minting your grave",
        ]}
      />
      {status && "detail" in status && <p className="mt-6 text-sm text-bone-3">{status.detail}</p>}
    </Panel>
  );
}

function DoneStep({ prep, tx, graveId, nearTx }: { prep: Prepared; tx: string; graveId: number; nearTx?: string }) {
  const ch = CHAINS[prep.chain];
  return (
    <div className="stele relative overflow-hidden border border-line-strong bg-loam-1 px-6 pb-10 pt-16 text-center sm:px-12">
      <p className="inscription text-sm text-bone-3">Here lies</p>
      <h2 className="mt-3 font-display text-6xl text-bone">{graveNo(graveId)}</h2>
      <p className="mt-3 text-bone-2">
        {compact(Number(prep.amount) / 10 ** prep.decimals)} tokens, buried on {ch.name}.
      </p>
      <Pulse beats={syntheticBeats("dead", 36, graveId + 3)} className="mx-auto mt-8 h-14 w-full max-w-md" />
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href={`/grave/${graveId}`}>Visit your grave</ButtonLink>
        <ButtonLink href="/scan" variant="ghost">Bury another</ButtonLink>
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-4 text-xs text-bone-4">
        <a className="hover:text-bone" href={ch.explorer.tx(tx)} target="_blank" rel="noreferrer">{ch.name} transaction ↗</a>
        {nearTx && <a className="hover:text-bone" href={nearTxUrl(nearTx)} target="_blank" rel="noreferrer">NEAR registration ↗</a>}
        <Link className="hover:text-bone" href="/proof">How to verify</Link>
      </div>
    </div>
  );
}

function TestBagFaucet() {
  const w = useWallets();
  const { open } = useConnectSheet();
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  if (state === "done") return <span className="text-alive">Test bags sent. They appear below in a few seconds.</span>;
  return (
    <button
      className="font-semibold text-ember underline-offset-2 hover:underline disabled:opacity-50"
      disabled={state === "busy"}
      onClick={async () => {
        if (!w.sol && !w.evm) return open();
        setState("busy");
        try {
          await post("/api/faucet", { sol: w.sol, evm: w.evm });
          setState("done");
          // New token accounts take a moment to show up on devnet RPCs; refresh the bag list a few times.
          for (const ms of [1_500, 4_000, 8_000, 15_000]) setTimeout(() => qc.invalidateQueries({ queryKey: ["bury-holdings"] }), ms);
        } catch (e) {
          setState((e as Error).message);
        }
      }}
    >
      {state === "busy" ? "Sending test bags…" : state === "idle" ? "Claim test bags" : `Faucet unavailable: ${state}`}
    </button>
  );
}
