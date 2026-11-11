"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useSignMessage } from "wagmi";
import { Button, Notice, Panel } from "@/components/ui";
import { shortAddress } from "@/core/chains";
import { NEAR_EXPLORER, cryptMessage, formatBones, nearAccountUrl, registry, type GraveEventJson } from "@/core/near";
import { post } from "@/lib/api";
import { compact, date, graveNo } from "@/lib/format";
import { encodeSolanaSignature, receiverAccountId, signerKind } from "@/lib/ownerAction";
import { ownerIds, useConnectSheet, useWallets } from "@/lib/wallets";

interface Crypt {
  graveId: number;
  holder: string;
  account: string;
  checkedAt: { height: number; hash: string; at: number };
  inside: string;
  history: GraveEventJson[];
  statement: { earned: { symbol: string; amount: string }[]; bones: { minted: string; exhumed: string; burned: string }; holders: string[] };
}

const short = (a: string) => (/^[0-9a-f]{64}$/.test(a) || /^0x[0-9a-f]{40}$/.test(a) ? shortAddress(a, 6, 4) : a);

function csv(c: Crypt): string {
  const rows = [["date", "kind", "account", "amount_base_units", "symbol", "note"]];
  for (const h of c.history) rows.push([new Date(Number(h.at) * 1000).toISOString(), h.kind, h.account ?? "", h.amount ?? "", h.symbol ?? "", h.note ?? ""]);
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
}

/**
 * A page only the current holder of a grave can open. The wallet signs a
 * time-boxed message; the server checks it against the grave's owner at a
 * final NEAR block. Hand the grave on and the door no longer opens for you.
 */
export function CryptView({ id }: { id: number }) {
  const w = useWallets();
  const { open } = useConnectSheet();
  const { mutateAsync: signEvm } = useSignMessage();
  const g = useQuery({ queryKey: ["grave-lite", id], queryFn: () => registry.grave(id) });
  const events = useQuery({ queryKey: ["events"], queryFn: () => registry.events() });
  const [state, setState] = useState<{ k: "idle" } | { k: "signing" | "checking" } | { k: "open"; c: Crypt } | { k: "refused"; m: string }>({ k: "idle" });

  const owner = g.data?.owner_id ?? null;
  const mine = !!owner && ownerIds(w).includes(owner);

  const enter = async () => {
    try {
      // Sign with the wallet the holder uses; otherwise with whatever is connected (the door will say no).
      const useSol = owner && signerKind(owner) === "solana" ? !!w.sol : !w.evm;
      const issued = Math.floor(Date.now() / 1000);
      const message = cryptMessage(id, issued);
      setState({ k: "signing" });
      let signature: string;
      let signer: string;
      if (useSol && w.sol) {
        const sm = w.solWallet.signMessage;
        if (!sm) throw new Error("This Solana wallet can't sign messages.");
        signature = encodeSolanaSignature(await sm(new TextEncoder().encode(message)));
        signer = receiverAccountId(w.sol).accountId;
      } else if (w.evm) {
        signature = await signEvm({ message });
        signer = w.evm.toLowerCase();
      } else {
        throw new Error("Connect a wallet first.");
      }
      setState({ k: "checking" });
      const c = await post<Crypt>("/api/crypt", { graveId: id, issued, signature, signer });
      setState({ k: "open", c });
    } catch (e) {
      const m = (e as Error).message ?? "";
      setState({ k: "refused", m: /reject|denied|cancel/i.test(m) ? "You declined the signature." : m.split("\n")[0] });
    }
  };

  const decimalsOf = (symbol: string) =>
    symbol === "BONES" ? 6 : (events.data?.find((e) => e.symbol === symbol)?.decimals ?? (g.data && symbol ? g.data.decimals : 0));

  return (
    <div className="mx-auto max-w-[860px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <Link href={`/grave/${id}`} className="text-sm text-bone-3 hover:text-bone">
        ← Grave {graveNo(id)}
      </Link>
      <h1 className="mt-3 font-display text-5xl leading-none text-bone sm:text-6xl">The crypt</h1>
      <p className="mt-3 max-w-xl text-bone-2">
        Only the grave&rsquo;s current holder can open this door. Your wallet signs a short message (no transaction, no fee) and the server checks it
        against the grave&rsquo;s owner on NEAR at that moment. Sell or hand the grave on and the door closes for you on the next block.
      </p>

      {state.k !== "open" && (
        <Panel className="mt-8 p-6">
          <div className="text-sm text-bone-3">
            Holder of {graveNo(id)}: <span className="font-mono text-bone-2">{owner ? short(owner) : "…"}</span>
          </div>
          {!w.any ? (
            <Button className="mt-4" onClick={() => open()}>
              Connect wallet
            </Button>
          ) : (
            <>
              {owner && !mine && (
                <p className="mt-3 text-sm text-fading">This wallet doesn&rsquo;t hold the grave. You can try the door; it will refuse you.</p>
              )}
              <Button className="mt-4" disabled={state.k === "signing" || state.k === "checking"} onClick={enter}>
                {state.k === "signing" ? "Check your wallet…" : state.k === "checking" ? "Checking NEAR…" : mine ? "Sign to enter" : "Try the door"}
              </Button>
            </>
          )}
          {state.k === "refused" && (
            <div className="mt-4">
              <Notice tone="danger">{state.m}</Notice>
            </div>
          )}
        </Panel>
      )}

      {state.k === "open" && (
        <div className="mt-8 space-y-4">
          <Panel className="border-alive/40 p-6">
            <div className="text-sm font-semibold text-alive">The door opened.</div>
            <p className="mt-1 text-sm text-bone-3">
              At NEAR block{" "}
              <a className="font-mono text-ember hover:underline" href={`${NEAR_EXPLORER}/blocks/${state.c.checkedAt.hash}`} target="_blank" rel="noreferrer">
                #{state.c.checkedAt.height.toLocaleString()} ↗
              </a>
              , <span className="font-mono">get_grave({id}).owner_id</span> was <span className="font-mono text-bone-2">{short(state.c.holder)}</span>, and your
              signature matched it.
            </p>
          </Panel>

          <Panel className="p-6">
            <h2 className="font-display text-2xl text-bone">Holder&rsquo;s statement</h2>
            <dl className="mt-4 grid gap-5 sm:grid-cols-3">
              <div>
                <dt className="eyebrow">Earned by this grave</dt>
                <dd className="mt-1 space-y-0.5 text-sm text-bone">
                  {state.c.statement.earned.length === 0
                    ? "Nothing yet"
                    : state.c.statement.earned.map((e) => (
                        <div key={e.symbol} className="tabular">
                          {compact(Number(e.amount) / 10 ** decimalsOf(e.symbol))} ${e.symbol}
                        </div>
                      ))}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">BONES</dt>
                <dd className="mt-1 space-y-0.5 text-sm tabular text-bone">
                  <div>{formatBones(state.c.inside)} inside now</div>
                  <div className="text-bone-3">{formatBones(state.c.statement.bones.minted)} minted · {formatBones(state.c.statement.bones.exhumed)} exhumed</div>
                  {state.c.statement.bones.burned !== "0" && <div className="text-bone-3">{formatBones(state.c.statement.bones.burned)} burned</div>}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Holders, oldest first</dt>
                <dd className="mt-1 space-y-0.5 font-mono text-xs text-bone-2">
                  {state.c.statement.holders.map((h, i) => (
                    <div key={`${h}-${i}`}>{short(h)}</div>
                  ))}
                </dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const blob = new Blob([csv(state.c)], { type: "text/csv" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `grave-${id}-statement.csv`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                Download statement (CSV)
              </Button>
              <a className="inline-flex h-9 items-center rounded-[10px] border border-line px-3 text-sm text-bone-2 hover:text-bone" href={nearAccountUrl(state.c.account)} target="_blank" rel="noreferrer">
                {state.c.account} ↗
              </a>
            </div>
          </Panel>

          <Panel className="p-6">
            <h2 className="font-display text-2xl text-bone">Every entry</h2>
            <ol className="mt-3 divide-y divide-line">
              {[...state.c.history].reverse().map((h, i) => (
                <li key={i} className="grid grid-cols-[100px_1fr] gap-3 py-2 text-sm">
                  <span className="tabular text-bone-4">{date(h.at)}</span>
                  <span className="min-w-0 break-words text-bone-2">
                    <span className="font-semibold text-bone">{h.kind.replace(/_/g, " ")}</span>
                    {h.amount && h.symbol ? ` · ${compact(Number(h.amount) / 10 ** decimalsOf(h.symbol))} ${h.symbol === "BONES" ? "BONES" : `$${h.symbol}`}` : ""}
                    {h.account ? ` · ${short(h.account)}` : ""}
                    {h.note ? <span className="block text-xs text-bone-4">{h.note}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>

          <div className="flex flex-wrap gap-3">
            <Link href={`/grave/${id}`} className="text-sm text-ember hover:underline">
              Exhume BONES, set a payout address or hand it down →
            </Link>
            <button className="text-sm text-bone-3 hover:text-bone" onClick={() => setState({ k: "idle" })}>
              Leave the crypt
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
