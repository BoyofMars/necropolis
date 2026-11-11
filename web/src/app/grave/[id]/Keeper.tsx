"use client";

import { useState } from "react";
import { useSignMessage } from "wagmi";
import { Button, Panel, cx } from "@/components/ui";
import { CHAINS, shortAddress, type ChainId } from "@/core/chains";
import { CONTRACT_ID, formatBones, nearTxUrl, parseBones, type GraveJson } from "@/core/near";
import { post } from "@/lib/api";
import { CONTRACT_ARG, canonicalPayout, encodeSolanaSignature, prepareOwnerAction, receiverAccountId, signerKind, type OwnerAction } from "@/lib/ownerAction";
import { useWallets } from "@/lib/wallets";

type Step =
  | { k: "idle" }
  | { k: "review"; action: OwnerAction; value: string; message: string; nonce: number; note?: string }
  | { k: "signing" | "relaying"; action: OwnerAction }
  | { k: "done"; action: OwnerAction; nearTx: string }
  | { k: "error"; action: OwnerAction; message: string };

const LABEL: Record<OwnerAction, string> = {
  set_epitaph: "Epitaph",
  set_payout_address: "Payout address",
  transfer_grave: "Hand it down",
  exhume_bones: "Exhume BONES",
};

/**
 * Owner actions, signed by the wallet that buried the bag. The wallet signs a
 * plain-text message (no transaction, no fee). The Sexton relays it; the
 * contract checks the signature and nonce itself.
 */
export function Keeper({ g, inside, onDone }: { g: GraveJson; inside: string; onDone: () => void }) {
  const w = useWallets();
  const { mutateAsync: signEvm } = useSignMessage();
  const [open, setOpen] = useState<OwnerAction | null>(null);
  const [step, setStep] = useState<Step>({ k: "idle" });
  const [epitaph, setEpitaph] = useState(g.epitaph ?? "");
  const [payout, setPayout] = useState(g.payout_to ?? "");
  const [receiver, setReceiver] = useState("");
  const [exhume, setExhume] = useState("");
  const kind = signerKind(g.owner_id);
  const ch = CHAINS[g.chain as ChainId];

  const begin = async (action: OwnerAction) => {
    try {
      let value: string;
      let note: string | undefined;
      if (action === "set_epitaph") {
        value = epitaph.trim();
        if (!value) throw new Error("Write something first.");
        if ([...value].length > 140) throw new Error("Epitaphs are limited to 140 characters.");
      } else if (action === "set_payout_address") {
        value = canonicalPayout(g.chain as ChainId, payout);
      } else if (action === "exhume_bones") {
        const base = parseBones(exhume);
        if (!base) throw new Error("Enter an amount of BONES.");
        if (BigInt(base) > BigInt(inside)) throw new Error(`The grave holds ${formatBones(inside)} BONES.`);
        value = base;
        note = "They leave the grave for your wallet, and stop following the NFT. Whoever holds them at a rising gets its share.";
      } else {
        const r = receiverAccountId(receiver);
        if (r.accountId === g.owner_id) throw new Error("That account already owns this grave.");
        value = r.accountId;
        note =
          r.kind === "solana"
            ? "The receiver controls it with that Solana wallet."
            : r.kind === "evm"
              ? "The receiver controls it with that EVM wallet."
              : "The receiver controls it with that NEAR account, and needs to set a payout address.";
      }
      if (kind === "near") {
        // Named NEAR owners act with their own NEAR transaction: the contract checks the caller.
        const message = `${CONTRACT_ID}.${action}({ grave_id: ${g.id}, ${CONTRACT_ARG[action]}: ${JSON.stringify(value)} })\nfrom ${g.owner_id}`;
        setStep({ k: "review", action, value, message, nonce: 0, note });
        return;
      }
      const { message, nonce } = await prepareOwnerAction(g.owner_id, action, g.id, value);
      setStep({ k: "review", action, value, message, nonce, note });
    } catch (e) {
      setStep({ k: "error", action, message: (e as Error).message });
    }
  };

  const sign = async (s: Extract<Step, { k: "review" }>) => {
    setStep({ k: "signing", action: s.action });
    try {
      if (kind === "near") {
        if (w.near !== g.owner_id) throw new Error(`Connect ${g.owner_id} with a NEAR wallet first.`);
        const nearTx = await w.nearWallet.call(s.action, { grave_id: g.id, [CONTRACT_ARG[s.action]]: s.value, auth: null }, { tgas: 50 });
        setStep({ k: "done", action: s.action, nearTx });
        if (s.action === "transfer_grave") setReceiver("");
        if (s.action === "exhume_bones") setExhume("");
        onDone();
        return;
      }
      let signature: string;
      if (kind === "solana") {
        const sm = w.solWallet.signMessage;
        if (!sm) throw new Error("This Solana wallet can't sign messages.");
        signature = encodeSolanaSignature(await sm(new TextEncoder().encode(s.message)));
      } else {
        signature = await signEvm({ message: s.message });
      }
      setStep({ k: "relaying", action: s.action });
      const r = await post<{ nearTx: string }>("/api/owner", { action: s.action, graveId: g.id, value: s.value, nonce: s.nonce, signature });
      setStep({ k: "done", action: s.action, nearTx: r.nearTx });
      if (s.action === "transfer_grave") setReceiver("");
      if (s.action === "exhume_bones") setExhume("");
      onDone();
    } catch (e) {
      const m = (e as Error).message ?? "";
      setStep({ k: "error", action: s.action, message: /reject|denied|cancel/i.test(m) ? "You declined the signature." : m.split("\n")[0] });
    }
  };

  const busy = step.k === "signing" || step.k === "relaying";
  const toggle = (a: OwnerAction) => {
    if (busy) return;
    setOpen((o) => (o === a ? null : a));
    setStep({ k: "idle" });
  };

  const rows: { action: OwnerAction; summary: string; body: React.ReactNode }[] = [
    {
      action: "set_epitaph",
      summary: g.epitaph ? `“${g.epitaph}”` : "None yet",
      body: (
        <input
          aria-label="Epitaph"
          maxLength={140}
          value={epitaph}
          onChange={(e) => setEpitaph(e.target.value)}
          placeholder="Here lies my conviction."
          className="h-11 w-full rounded-[10px] border border-line-strong bg-loam px-4 font-display text-lg italic text-bone placeholder:text-bone-4 focus:border-bone-3 focus:outline-none"
        />
      ),
    },
    {
      action: "set_payout_address",
      summary: g.payout_to ? shortAddress(g.payout_to, 6, 6) : "Your burial wallet",
      body: (
        <input
          aria-label={`Payout address on ${ch.name}`}
          value={payout}
          onChange={(e) => setPayout(e.target.value)}
          placeholder={ch.family === "solana" ? "Solana address" : "0x… address"}
          spellCheck={false}
          className="h-11 w-full rounded-[10px] border border-line-strong bg-loam px-4 font-mono text-sm text-bone placeholder:text-bone-4 focus:border-bone-3 focus:outline-none"
        />
      ),
    },
    ...(BigInt(inside || "0") > 0n
      ? [
          {
            action: "exhume_bones" as OwnerAction,
            summary: `${formatBones(inside)} BONES inside the grave`,
            body: (
              <div className="flex gap-2">
                <input
                  aria-label="BONES to exhume"
                  value={exhume}
                  onChange={(e) => setExhume(e.target.value)}
                  inputMode="decimal"
                  placeholder="Amount"
                  className="h-11 min-w-0 flex-1 rounded-[10px] border border-line-strong bg-loam px-4 text-sm text-bone tabular placeholder:text-bone-4 focus:border-bone-3 focus:outline-none"
                />
                <Button size="sm" variant="ghost" onClick={() => setExhume(`${BigInt(inside) / 1_000_000n}.${(BigInt(inside) % 1_000_000n).toString().padStart(6, "0")}`)}>
                  All
                </Button>
              </div>
            ),
          },
        ]
      : []),
    {
      action: "transfer_grave",
      summary: "Give this grave, its account and everything it is owed, to someone else",
      body: (
        <input
          aria-label="New owner"
          value={receiver}
          onChange={(e) => setReceiver(e.target.value)}
          placeholder="Solana address, 0x address or NEAR account"
          spellCheck={false}
          className="h-11 w-full rounded-[10px] border border-line-strong bg-loam px-4 font-mono text-sm text-bone placeholder:text-bone-4 focus:border-bone-3 focus:outline-none"
        />
      ),
    },
  ];

  return (
    <Panel className="p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl text-bone">Keeper&rsquo;s ledger</h2>
        <span className="text-xs text-bone-4">
          {kind === "near" ? "Sent from your NEAR account" : `Signed by your ${kind === "solana" ? "Solana" : "EVM"} wallet · no fee`}
        </span>
      </div>
      <p className="mt-1 text-sm text-bone-3">
        {kind === "near"
          ? "This grave belongs to a NEAR account, so you act with a NEAR transaction from it. The contract checks the caller is the grave's owner."
          : "Your wallet signs a plain message. NEAR checks the signature against this grave's owner, so nobody else can make these changes, not even the relayer."}
      </p>
      <ul className="mt-4 divide-y divide-line rounded-[12px] border border-line">
        {rows.map((r) => {
          const isOpen = open === r.action;
          const s = step.k !== "idle" && "action" in step && step.action === r.action ? step : null;
          return (
            <li key={r.action}>
              <button
                type="button"
                onClick={() => toggle(r.action)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-row-hover"
              >
                <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-bone">{LABEL[r.action]}</span>
                <span className={cx("min-w-0 truncate text-sm", r.action === "set_epitaph" && g.epitaph ? "font-display italic text-bone-2" : "text-bone-3")}>
                  {r.summary}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-3 border-t border-line bg-loam-2/60 px-4 py-4">
                  {r.action === "transfer_grave" && (
                    <p className="text-xs text-fading">The new owner gets the grave&rsquo;s account, the BONES inside it, every unclaimed share and every future payout. You keep nothing; only they can hand it back.</p>
                  )}
                  {r.body}
                  {s?.k === "review" ? (
                    <div className="space-y-3">
                      <div>
                        <div className="eyebrow">{kind === "near" ? "Your NEAR wallet will send this transaction" : "Your wallet will sign exactly this"}</div>
                        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded-[10px] border border-line bg-loam px-3 py-2 font-mono text-[11px] leading-relaxed text-bone-2">
                          {s.message}
                        </pre>
                        {s.note && <p className="mt-1.5 text-xs text-bone-3">{s.note}</p>}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => sign(s)}>
                          {r.action === "transfer_grave" ? "Sign and hand down" : "Sign"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setStep({ k: "idle" })}>
                          Edit
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" disabled={busy} onClick={() => begin(r.action)}>
                      {s?.k === "signing" ? "Check your wallet…" : s?.k === "relaying" ? "NEAR verifying…" : "Review signature"}
                    </Button>
                  )}
                  {s?.k === "done" && (
                    <p className="text-xs text-alive" aria-live="polite">
                      Recorded on NEAR ·{" "}
                      <a className="font-mono underline-offset-2 hover:underline" href={nearTxUrl(s.nearTx)} target="_blank" rel="noreferrer">
                        {shortAddress(s.nearTx, 6, 4)} ↗
                      </a>
                    </p>
                  )}
                  {s?.k === "error" && (
                    <p className="text-xs text-danger" aria-live="polite">
                      {s.message}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
