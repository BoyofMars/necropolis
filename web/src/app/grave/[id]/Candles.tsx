"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSignMessage } from "wagmi";
import { Flame } from "@/components/Flame";
import { Button, cx } from "@/components/ui";
import { candleMessage, nearTxUrl, registry } from "@/core/near";
import { post } from "@/lib/api";
import { encodeSolanaSignature } from "@/lib/ownerAction";
import { ownerIds, useConnectSheet, useWallets } from "@/lib/wallets";

/**
 * Candles: anyone with a Solana or EVM wallet can light one per grave. The
 * wallet signs a plain message, the Sexton relays it, and the contract checks
 * the signature and keeps the count.
 */
export function Candles({ graveId }: { graveId: number }) {
  const w = useWallets();
  const qc = useQueryClient();
  const { open } = useConnectSheet();
  const { mutateAsync: signEvm } = useSignMessage();
  const mourner = ownerIds(w)[0] ?? null;
  const q = useQuery({
    queryKey: ["candles", graveId, mourner],
    queryFn: async () => {
      const [[n], lit] = await Promise.all([registry.candles([graveId]), mourner ? registry.hasLit(graveId, mourner) : Promise.resolve(false)]);
      return { n: Number(n ?? 0), lit };
    },
  });
  const [busy, setBusy] = useState<"sign" | "relay" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);
  const n = q.data?.n ?? 0;

  const light = async () => {
    if (!mourner) return open();
    setMsg(null);
    try {
      setBusy("sign");
      if (mourner === w.near) {
        // A named NEAR account lights its own candle with a NEAR transaction.
        const tx = await w.nearWallet.call("light_candle", { grave_id: graveId, mourner, signature: null }, { tgas: 30 });
        setMsg({ ok: true, text: "Your candle is lit, on NEAR.", tx: tx || undefined });
        qc.invalidateQueries({ queryKey: ["candles", graveId] });
        qc.invalidateQueries({ queryKey: ["mourned"] });
        return;
      }
      const message = candleMessage(graveId, mourner);
      let signature: string;
      if (w.sol) {
        // ownerIds lists the Solana key first, so the mourner is the Solana wallet
        const sm = w.solWallet.signMessage;
        if (!sm) throw new Error("This Solana wallet can't sign messages.");
        signature = encodeSolanaSignature(await sm(new TextEncoder().encode(message)));
      } else {
        signature = await signEvm({ message });
      }
      setBusy("relay");
      const r = await post<{ candles: number; nearTx: string }>("/api/candle", { graveId, mourner, signature });
      setMsg({ ok: true, text: "Your candle is lit, on NEAR.", tx: r.nearTx });
      qc.invalidateQueries({ queryKey: ["candles", graveId] });
      qc.invalidateQueries({ queryKey: ["mourned"] });
    } catch (e) {
      const m = (e as Error).message ?? "";
      setMsg({ ok: false, text: /reject|denied|cancel/i.test(m) ? "You declined the signature." : m.split("\n")[0] });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-line bg-loam-1/80 px-5 py-4">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex items-end -space-x-1" aria-hidden>
          {n === 0 ? <Flame lit={false} /> : Array.from({ length: Math.min(n, 12) }, (_, i) => <Flame key={i} delay={(i * 0.73) % 2.6} />)}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-bone">
            {q.isLoading ? "…" : n === 0 ? "No candles yet" : `${n} candle${n === 1 ? "" : "s"} lit`}
          </div>
          <div className="text-xs text-bone-3">One per wallet, signed, kept by the contract. No fee.</div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {q.data?.lit ? (
          <span className="text-sm text-ember">You lit a candle here</span>
        ) : (
          <Button size="sm" variant="ghost" onClick={light} disabled={!!busy}>
            {busy === "sign" ? "Check your wallet…" : busy === "relay" ? "Lighting…" : mourner ? "Light a candle" : "Connect to light a candle"}
          </Button>
        )}
        {msg && (
          <span className={cx("text-xs", msg.ok ? "text-alive" : "text-danger")} aria-live="polite">
            {msg.text}{" "}
            {msg.tx && (
              <a className="underline-offset-2 hover:underline" href={nearTxUrl(msg.tx)} target="_blank" rel="noreferrer">
                tx ↗
              </a>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
