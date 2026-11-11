"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSignMessage } from "wagmi";
import { Button, Panel, cx } from "@/components/ui";
import { bonesTransferMessage, formatBones as fmt, nearTxUrl, parseBones as toBase, registry, type EventJson } from "@/core/near";
import { post } from "@/lib/api";
import { compact } from "@/lib/format";
import { encodeSolanaSignature, receiverAccountId, signerKind } from "@/lib/ownerAction";
import { useWallets } from "@/lib/wallets";

async function load(holder: string) {
  const [balance, supply, genesis, events] = await Promise.all([registry.bonesBalance(holder), registry.bonesSupply(), registry.bonesGenesis(), registry.events()]);
  const era = genesis === null ? [] : events.filter((e) => e.id >= genesis);
  const shares = await Promise.all(era.map((e) => registry.bonesShare(e.id, holder).then((s) => ({ e, s }))));
  return { balance, supply, genesis, shares: shares.reverse() };
}

/**
 * $BONES for one wallet: what it holds, what each rising since genesis owes
 * it, and a signed transfer. Claims pay the wallet's own key on the risen chain.
 */
export function BonesPanel({ holder }: { holder: string }) {
  const q = useQuery({ queryKey: ["bones", holder], queryFn: () => load(holder), refetchInterval: 30_000 });
  const share = q.data && BigInt(q.data.supply) > 0n ? (Number(q.data.balance) / Number(q.data.supply)) * 100 : 0;
  return (
    <Panel className="mt-10 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line p-6">
        <div>
          <div className="eyebrow">$BONES in your wallet</div>
          <div className="mt-2 font-display text-5xl text-bone tabular">{q.data ? fmt(q.data.balance) : "…"}</div>
          <p className="mt-1 text-sm text-bone-3">
            {q.data ? `${share >= 0.01 || share === 0 ? share.toFixed(2) : "<0.01"}% of ${fmt(q.data.supply)} BONES in circulation.` : " "} The BONES in your wallet:
            exhumed from your graves or sent to you. BONES still inside a grave are on that grave&rsquo;s page. Every coin&rsquo;s rising pays holders.
          </p>
        </div>
      </div>
      <div className="grid gap-px bg-line md:grid-cols-2">
        <div className="bg-loam-1 p-6">
          <h3 className="font-display text-2xl text-bone">Risings that owe you</h3>
          {q.isLoading ? (
            <div className="skeleton mt-4 h-16" />
          ) : (q.data?.shares.length ?? 0) === 0 ? (
            <p className="mt-3 text-sm text-bone-3">No coin has risen since $BONES began. When one does, holders split its tithe.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {q.data!.shares.map(({ e, s }) => (
                <ShareRow key={e.id} e={e} s={s} holder={holder} />
              ))}
            </ul>
          )}
        </div>
        <div className="bg-loam-1 p-6">
          <Transfer holder={holder} balance={q.data?.balance ?? "0"} />
        </div>
      </div>
    </Panel>
  );
}

function ShareRow({ e, s, holder }: { e: EventJson; s: Awaited<ReturnType<typeof registry.bonesShare>>; holder: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const amount = s?.amount ? Number(s.amount) / 10 ** e.decimals : 0;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <div className="text-sm text-bone">${e.symbol} rose</div>
        <div className="text-xs text-bone-3">
          {s?.eligible ? `${compact(amount)} $${e.symbol} for ${fmt(s.balance_at_rising)} BONES held at the rising` : s?.reason ?? "…"}
        </div>
        {msg && <div className="mt-1 text-xs text-bone-2">{msg}</div>}
      </div>
      {s?.eligible &&
        (s.claimed ? (
          <span className="text-xs text-alive">Claimed</span>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const r = await post<{ txs: string[] }>("/api/bones/claim", { eventId: e.id, holder });
                setMsg(`Paid to your wallet · ${r.txs[0]?.slice(0, 8)}…`);
                qc.invalidateQueries({ queryKey: ["bones", holder] });
              } catch (err) {
                setMsg((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "MPC signing…" : "Claim"}
          </Button>
        ))}
    </li>
  );
}

function Transfer({ holder, balance }: { holder: string; balance: string }) {
  const w = useWallets();
  const qc = useQueryClient();
  const { mutateAsync: signEvm } = useSignMessage();
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState<"sign" | "relay" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);

  const send = async () => {
    setMsg(null);
    try {
      const amount = toBase(amt);
      if (!amount) throw new Error("Enter an amount of BONES.");
      if (BigInt(amount) > BigInt(balance)) throw new Error("That's more than you hold.");
      const receiver = receiverAccountId(to).accountId;
      const nonce = Number(await registry.nonce(holder));
      const message = bonesTransferMessage(receiver, amount, nonce);
      setBusy("sign");
      let signature: string;
      if (signerKind(holder) === "solana") {
        const sm = w.solWallet.signMessage;
        if (!sm) throw new Error("This Solana wallet can't sign messages.");
        signature = encodeSolanaSignature(await sm(new TextEncoder().encode(message)));
      } else {
        signature = await signEvm({ message });
      }
      setBusy("relay");
      const r = await post<{ nearTx: string }>("/api/bones/transfer", { holder, receiver: to, amount, nonce, signature });
      setMsg({ ok: true, text: `Sent ${fmt(amount)} BONES.`, tx: r.nearTx });
      setAmt("");
      qc.invalidateQueries({ queryKey: ["bones", holder] });
    } catch (e) {
      const m = (e as Error).message ?? "";
      setMsg({ ok: false, text: /reject|denied|cancel/i.test(m) ? "You declined the signature." : m.split("\n")[0] });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h3 className="font-display text-2xl text-bone">Send BONES</h3>
      <p className="mt-1 text-xs text-bone-3">
        To a Solana or EVM wallet, or any NEAR account. Your wallet signs; no fee. BONES you send carry future risings with them; risings already
        recorded stay yours.
      </p>
      <div className="mt-4 space-y-2">
        <input
          aria-label="Receiver"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Solana address, 0x address or NEAR account"
          spellCheck={false}
          className="h-11 w-full rounded-[10px] border border-line-strong bg-loam px-4 font-mono text-sm text-bone placeholder:font-sans placeholder:text-bone-4 focus:border-bone-3 focus:outline-none"
        />
        <div className="flex gap-2">
          <input
            aria-label="Amount of BONES"
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
            inputMode="decimal"
            placeholder="Amount"
            className="h-11 min-w-0 flex-1 rounded-[10px] border border-line-strong bg-loam px-4 text-sm text-bone tabular placeholder:text-bone-4 focus:border-bone-3 focus:outline-none"
          />
          <Button onClick={send} disabled={!!busy || !to || !amt}>
            {busy === "sign" ? "Check your wallet…" : busy === "relay" ? "Sending…" : "Sign and send"}
          </Button>
        </div>
      </div>
      {msg && (
        <p className={cx("mt-2 text-xs", msg.ok ? "text-alive" : "text-danger")} aria-live="polite">
          {msg.text}{" "}
          {msg.tx && (
            <a className="underline-offset-2 hover:underline" href={nearTxUrl(msg.tx)} target="_blank" rel="noreferrer">
              tx ↗
            </a>
          )}
        </p>
      )}
    </>
  );
}
