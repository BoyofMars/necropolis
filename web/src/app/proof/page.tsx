"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { BRAND } from "@/brand";
import { Button, Mono, Notice, Panel, cx } from "@/components/ui";
import { CHAINS, type ChainId } from "@/core/chains";
import { deriveAddress, ROOT_KEYS } from "@/core/derivation";
import { CONTRACT_ID, MPC_SIGNER, NETWORK, derivedPublicKey, nearAccountUrl, nearView, registry, type ContractChain, ossuaryPath } from "@/core/near";
import { graveNo } from "@/lib/format";

function Check({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <span className={cx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold", ok === null ? "border-line text-bone-4" : ok ? "border-alive/60 text-alive" : "border-danger/60 text-danger")}>
        {ok === null ? "…" : ok ? "✓" : "✗"}
      </span>
      <span className="text-bone-2">{children}</span>
    </li>
  );
}

async function mpcAddress(family: "solana" | "evm", path: string): Promise<string> {
  const key = await derivedPublicKey(path, family === "solana" ? 1 : 0);
  if (family === "solana") return key.replace(/^ed25519:/, "");
  const bs58 = (await import("bs58")).default;
  const { keccak_256 } = await import("@noble/hashes/sha3.js");
  const raw = bs58.decode(key.replace(/^secp256k1:/, ""));
  const xy = raw.length === 65 ? raw.slice(1) : raw;
  return `0x${Array.from(keccak_256(xy).slice(12), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export default function Proof() {
  const roots = useQuery({
    queryKey: ["mpc-roots"],
    queryFn: async () => ({
      secp: await nearView<string>("public_key", { domain_id: 0 }, MPC_SIGNER),
      ed: await nearView<string>("public_key", { domain_id: 1 }, MPC_SIGNER),
    }),
  });
  const config = useQuery({ queryKey: ["config"], queryFn: registry.config });
  const ossuaries = useQuery({
    queryKey: ["ossuaries"],
    queryFn: async () => {
      const chains: ContractChain[] = NETWORK === "mainnet" ? ["sol", "base"] : ["sol-devnet", "base-sepolia"];
      return Promise.all(
        chains.map(async (c) => {
          const stored = await registry.ossuary(c);
          const family = CHAINS[c as ChainId].family;
          const offline = deriveAddress(family, NETWORK, CONTRACT_ID, ossuaryPath(c));
          return { chain: c, stored, offline };
        }),
      );
    },
  });

  const [graveId, setGraveId] = useState("");
  const [result, setResult] = useState<null | { id: number; path: string; stored: string; offline: string; mpc: string; chain: ChainId }>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setErr(null);
    setResult(null);
    const id = Number(graveId);
    if (!Number.isInteger(id) || id < 0) return setErr("Enter a grave number, e.g. 0.");
    setBusy(true);
    try {
      const g = await registry.grave(id);
      if (!g) throw new Error(`${graveNo(id)} does not exist.`);
      const chain = g.chain as ChainId;
      const family = CHAINS[chain].family;
      const offline = deriveAddress(family, NETWORK, CONTRACT_ID, g.path);
      const mpc = await mpcAddress(family, g.path);
      setResult({ id, path: g.path, stored: g.grave_address, offline, mpc, chain });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const terms = (config.data as { terms?: Record<string, string | number> } | undefined)?.terms;

  return (
    <div className="mx-auto max-w-[900px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <p className="eyebrow">Proof &amp; verification</p>
      <h1 className="mt-3 font-display text-5xl leading-tight text-bone sm:text-6xl">Don&rsquo;t trust the graveyard. Check it.</h1>
      <p className="mt-4 text-lg text-bone-2">
        Every grave address is a pure function of public inputs. Your browser can recompute it from NEAR&rsquo;s MPC root key and
        compare it with what the MPC network and the contract report. Nothing on this page goes through our server.
      </p>

      <Panel className="mt-10 p-6">
        <h2 className="font-display text-2xl text-bone">The contract</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="grid gap-1 sm:grid-cols-[180px_1fr]"><dt className="text-bone-3">Registry</dt><dd><a className="font-mono text-ember hover:underline" href={nearAccountUrl(CONTRACT_ID)} target="_blank" rel="noreferrer">{CONTRACT_ID} ↗</a></dd></div>
          <div className="grid gap-1 sm:grid-cols-[180px_1fr]"><dt className="text-bone-3">MPC signer</dt><dd><a className="font-mono text-ember hover:underline" href={nearAccountUrl(MPC_SIGNER)} target="_blank" rel="noreferrer">{MPC_SIGNER} ↗</a></dd></div>
          <div className="grid gap-1 sm:grid-cols-[180px_1fr]"><dt className="text-bone-3">Network</dt><dd className="text-bone-2">NEAR {NETWORK} · {NETWORK === "testnet" ? "Solana devnet, Base Sepolia" : "Solana, Base"}</dd></div>
          <div className="grid gap-1 sm:grid-cols-[180px_1fr]"><dt className="text-bone-3">Source</dt><dd><a className="text-ember hover:underline" href={`${BRAND.repo}/tree/main/contract`} target="_blank" rel="noreferrer">contract/ on GitHub ↗</a></dd></div>
        </dl>
        {terms && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-bone-3 hover:text-bone">Resurrection terms new plots are frozen with (live)</summary>
            <pre className="mt-3 overflow-x-auto rounded-[10px] border border-line bg-loam p-3 font-mono text-xs text-bone-2">{JSON.stringify(terms, null, 2)}</pre>
          </details>
        )}
        {config.isError && <p className="mt-3 text-sm text-danger">Could not read the contract config.</p>}
      </Panel>

      <Panel className="mt-4 p-6">
        <h2 className="font-display text-2xl text-bone">MPC root keys</h2>
        <p className="mt-1 text-sm text-bone-3">The derivation below uses these published keys. Here they are, checked live against the signer contract.</p>
        <ul className="mt-4 space-y-3">
          <Check ok={roots.data ? roots.data.secp === ROOT_KEYS[NETWORK].secp256k1 : roots.isError ? false : null}>
            secp256k1 (Base): <Mono className="break-all">{ROOT_KEYS[NETWORK].secp256k1.slice(0, 40)}…</Mono>
          </Check>
          <Check ok={roots.data ? roots.data.ed === ROOT_KEYS[NETWORK].ed25519 : roots.isError ? false : null}>
            ed25519 (Solana): <Mono className="break-all">{ROOT_KEYS[NETWORK].ed25519}</Mono>
          </Check>
        </ul>
      </Panel>

      <Panel className="mt-4 p-6">
        <h2 className="font-display text-2xl text-bone">Re-derive a grave address</h2>
        <p className="mt-1 text-sm text-bone-3">
          <span className="font-mono">tweak = sha3_256(&quot;near-mpc-recovery v0.1.0 epsilon derivation:&quot; + {CONTRACT_ID} + &quot;,&quot; + path)</span>, then root + tweak·G.
        </p>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
        >
          <label htmlFor="gid" className="sr-only">Grave number</label>
          <input id="gid" inputMode="numeric" value={graveId} onChange={(e) => setGraveId(e.target.value)} placeholder="Grave number, e.g. 0" className="h-11 flex-1 rounded-[10px] border border-line-strong bg-loam px-4 text-bone placeholder:text-bone-4 focus:border-bone-3 focus:outline-none" />
          <Button type="submit" disabled={busy}>{busy ? "Deriving…" : "Verify"}</Button>
        </form>
        {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
        {result && (
          <ul className="mt-5 space-y-3">
            <li className="text-sm text-bone-3">Path: <Mono className="break-all">{result.path}</Mono></li>
            <Check ok={same(result.offline, result.mpc)}>
              Your browser derived <Mono className="break-all">{result.offline}</Mono>; the MPC network says <Mono className="break-all">{result.mpc}</Mono>.
            </Check>
            <Check ok={same(result.offline, result.stored)}>
              The contract recorded <Mono className="break-all">{result.stored}</Mono> for {graveNo(result.id)}.
            </Check>
            <li className="pl-8 text-sm">
              <a className="text-ember hover:underline" href={CHAINS[result.chain].explorer.address(result.stored)} target="_blank" rel="noreferrer">
                See what is buried there on {CHAINS[result.chain].name} ↗
              </a>{" "}
              · <Link className="text-ember hover:underline" href={`/grave/${result.id}`}>Grave page</Link>
            </li>
          </ul>
        )}
      </Panel>

      <Panel className="mt-4 p-6">
        <h2 className="font-display text-2xl text-bone">Ossuaries</h2>
        <p className="mt-1 text-sm text-bone-3">Where tithes collect when a plot rises: also contract-derived, also checkable.</p>
        <ul className="mt-4 space-y-3">
          {ossuaries.data?.map((o) => (
            <Check key={o.chain} ok={o.stored ? same(o.stored, o.offline) : null}>
              {CHAINS[o.chain as ChainId].name}:{" "}
              {o.stored ? (
                <a className="break-all font-mono text-ember hover:underline" href={CHAINS[o.chain as ChainId].explorer.address(o.stored)} target="_blank" rel="noreferrer">{o.stored}</a>
              ) : (
                <span className="text-bone-4">not prepared yet</span>
              )}
            </Check>
          ))}
        </ul>
      </Panel>

      <Panel className="mt-4 p-6">
        <h2 className="font-display text-2xl text-bone">Verify a burial, by hand</h2>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-bone-2">
          <li>Open the grave page and follow the origin-chain transaction: tokens moved from the owner to the grave address.</li>
          <li>Re-derive the grave address above; it must match the contract record and the MPC network.</li>
          <li>
            The grave&rsquo;s <span className="text-bone">MPC attestation</span> is <span className="font-mono text-xs">sha256(borsh(ForeignTxSignPayload::V1))</span> over the
            deposit request and the extracted token-account state or Transfer log. Recompute it with{" "}
            <a className="text-ember hover:underline" href={`${BRAND.repo}/blob/main/web/src/core/foreignTx.ts`} target="_blank" rel="noreferrer">foreignTx.ts</a>; the encoder is tested against attestations the live
            testnet MPC network produced.
          </li>
          <li>Read the burial event on NEAR: the contract emits <span className="font-mono text-xs">EVENT_JSON {"{"}&quot;standard&quot;:&quot;necropolis&quot;,&quot;event&quot;:&quot;burial&quot;{"}"}</span> with the deposit and proof hash, plus a NEP-171 <span className="font-mono text-xs">nft_mint</span>.</li>
        </ol>
      </Panel>
    </div>
  );
}
