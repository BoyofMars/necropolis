"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button, Panel, cx } from "@/components/ui";
import { runChecks, summarize, type Check } from "@/core/verify";
import { nearTxUrl } from "@/core/near";
import refused from "../../../testnet-refused.json";

const ICON: Record<Check["status"], { glyph: string; cls: string; label: string }> = {
  pass: { glyph: "✓", cls: "border-alive/50 text-alive", label: "holds" },
  fail: { glyph: "✗", cls: "border-danger/50 text-danger", label: "fails" },
  note: { glyph: "·", cls: "border-fading/50 text-fading", label: "note" },
};

interface Refusal {
  attack: string;
  expected: string;
  tx: string;
}

/**
 * The judge desk. Runs the same checks as `npm run verify`, in the browser,
 * against public RPCs; then lists attacks we sent to the contract on testnet
 * and the transactions in which it refused them.
 */
export function VerifyView() {
  const q = useQuery({ queryKey: ["verify"], queryFn: runChecks, staleTime: 60_000, refetchOnWindowFocus: false });
  const s = q.data ? summarize(q.data) : null;
  const attacks = (refused as { refusals: Refusal[] }).refusals;

  return (
    <div className="mx-auto max-w-[960px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <div className="eyebrow">Judge desk</div>
      <h1 className="mt-2 font-display text-5xl leading-none text-bone sm:text-6xl">Don&rsquo;t trust us.</h1>
      <p className="mt-4 max-w-2xl text-lg text-bone-2">
        Every live claim in the README, re-checked right now by your browser from NEAR, Solana devnet and Base Sepolia. Addresses are re-derived
        offline. Nothing on this page asks our server anything.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <code className="rounded-[8px] border border-line bg-loam-2 px-3 py-1.5 font-mono text-sm text-bone-2">cd web &amp;&amp; npm run verify</code>
        <span className="text-sm text-bone-3">runs the same checks in a terminal.</span>
      </div>

      <Panel className="mt-8 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div className="font-display text-2xl text-bone tabular">
            {s ? (
              <>
                <span className={s.passed === s.total ? "text-alive" : "text-danger"}>{s.passed}</span>/{s.total} claims hold
              </>
            ) : (
              "Checking…"
            )}
          </div>
          <Button size="sm" variant="ghost" disabled={q.isFetching} onClick={() => q.refetch()}>
            {q.isFetching ? "Checking…" : "Run again"}
          </Button>
        </div>
        <ul className="divide-y divide-line">
          {(q.data ?? []).map((c) => (
            <li key={c.id} className="grid grid-cols-[28px_1fr] gap-3 px-6 py-4">
              <span
                aria-label={ICON[c.status].label}
                className={cx("mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border text-sm font-bold", ICON[c.status].cls)}
              >
                {ICON[c.status].glyph}
              </span>
              <div className="min-w-0">
                <div className="font-semibold text-bone">{c.claim}</div>
                <div className="mt-0.5 text-sm text-bone-2">{c.detail}</div>
                <div className="mt-1 break-words font-mono text-[11px] text-bone-4">{c.how}</div>
                {c.link && (
                  <a
                    href={c.link.href}
                    className="mt-1 inline-block text-xs text-ember hover:underline"
                    {...(c.link.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                  >
                    {c.link.label} {c.link.href.startsWith("http") ? "↗" : "→"}
                  </a>
                )}
              </div>
            </li>
          ))}
          {q.isLoading &&
            Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="px-6 py-4">
                <div className="skeleton h-10" />
              </li>
            ))}
        </ul>
      </Panel>

      <Panel className="mt-6 overflow-hidden">
        <div className="border-b border-line px-6 py-4">
          <h2 className="font-display text-2xl text-bone">Attacks the contract refused</h2>
          <p className="mt-1 text-sm text-bone-3">
            We sent these straight to the contract on testnet, skipping our own server&rsquo;s checks, the way a malicious relayer would. Each link is the
            failed transaction on NEAR with the contract&rsquo;s own error.
          </p>
        </div>
        {attacks.length === 0 ? (
          <p className="px-6 py-4 text-sm text-bone-4">None recorded yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {attacks.map((a) => (
              <li key={a.tx} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-6 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-bone">{a.attack}</div>
                  <div className="font-mono text-[11px] text-bone-4">refused: {a.expected}</div>
                </div>
                <a className="shrink-0 font-mono text-xs text-ember hover:underline" href={nearTxUrl(a.tx)} target="_blank" rel="noreferrer">
                  {a.tx.slice(0, 8)}… ↗
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/proof" className="text-ember hover:underline">
          Re-derive a grave address step by step →
        </Link>
        <Link href="/bones" className="text-ember hover:underline">
          $BONES rules and every mint and burn →
        </Link>
      </div>
    </div>
  );
}
