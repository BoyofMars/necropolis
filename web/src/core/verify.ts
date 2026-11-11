/**
 * The judge desk: every claim the README makes about live state, re-checked
 * from public RPCs. The /verify page and `npm run verify` run this same code,
 * so what a judge sees in the browser is what a screener sees in a terminal.
 *
 * Nothing here trusts our server: it reads NEAR, Solana devnet and Base
 * Sepolia directly, and re-derives MPC addresses offline.
 */
import { CHAINS, type ChainId } from "./chains";
import { ROOT_KEYS, deriveAddress } from "./derivation";
import {
  CONTRACT_ID,
  MPC_SIGNER,
  NETWORK,
  accessKeyCount,
  graveAccountId,
  nearAccountUrl,
  nearView,
  ossuaryPath,
  registry,
  type ContractChain,
  type GraveJson,
} from "./near";
import refused from "../../testnet-refused.json";

/** Old testnet transactions fall off regular nodes after a few days; judging is later. */
const NEAR_ARCHIVAL_RPC =
  process.env.NEXT_PUBLIC_NEAR_ARCHIVAL_RPC ?? (NETWORK === "mainnet" ? "https://archival-rpc.mainnet.fastnear.com" : "https://archival-rpc.testnet.fastnear.com");

interface Refusals {
  sender?: string;
  refusals: { attack: string; expected: string; tx: string }[];
}

export type CheckStatus = "pass" | "fail" | "note";

export interface Check {
  id: string;
  claim: string;
  /** how to reproduce it by hand */
  how: string;
  status: CheckStatus;
  detail: string;
  link?: { label: string; href: string };
}

const SOLANA_RPC: Partial<Record<ChainId, string>> = {
  "sol-devnet": process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC ?? "https://api.devnet.solana.com",
  sol: process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com",
};
const EVM_RPC: Partial<Record<ChainId, string>> = {
  "base-sepolia": process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC ?? "https://sepolia.base.org",
  base: process.env.NEXT_PUBLIC_BASE_RPC ?? "https://mainnet.base.org",
};

async function jsonRpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? "RPC error");
  return j.result as T;
}

async function allGraves(): Promise<GraveJson[]> {
  const out: GraveJson[] = [];
  for (let from = 0; ; from += 50) {
    const page = await registry.graves(from, 50, false);
    out.push(...page);
    if (page.length < 50) return out;
  }
}

/** Run one check; a thrown error is a failed check, never a crashed desk. */
async function check(id: string, claim: string, how: string, f: () => Promise<Omit<Check, "id" | "claim" | "how">>): Promise<Check> {
  try {
    return { id, claim, how, ...(await f()) };
  } catch (e) {
    return { id, claim, how, status: "fail", detail: `Could not check: ${(e as Error).message}` };
  }
}

export async function runChecks(): Promise<Check[]> {
  const graves = await allGraves();
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  return Promise.all([
    check(
      "mpc-root",
      "The MPC root keys we derive from are the ones NEAR's signer network publishes",
      `${MPC_SIGNER}.public_key({domain_id: 0 | 1})`,
      async () => {
        const [secp, ed] = await Promise.all([
          nearView<string>("public_key", { domain_id: 0 }, MPC_SIGNER),
          nearView<string>("public_key", { domain_id: 1 }, MPC_SIGNER),
        ]);
        const ok = secp === ROOT_KEYS[NETWORK].secp256k1 && ed === ROOT_KEYS[NETWORK].ed25519;
        return { status: ok ? "pass" : "fail", detail: ok ? "Both root keys match." : `Live keys differ: ${secp} / ${ed}` };
      },
    ),
    check(
      "vaults",
      "Every grave's vault is an address only this contract can sign for, through NEAR MPC",
      "Re-derive each grave_address offline from (contract, path) and the MPC root key",
      async () => {
        const bad = graves.filter((g) => deriveAddress(CHAINS[g.chain as ChainId].family, NETWORK, CONTRACT_ID, g.path) !== g.grave_address);
        return {
          status: bad.length === 0 ? "pass" : "fail",
          detail: bad.length === 0 ? `${plural(graves.length, "grave")}, every address re-derived.` : `Mismatch on graves ${bad.map((g) => g.id).join(", ")}.`,
          link: { label: "Re-derive one yourself", href: "/proof" },
        };
      },
    ),
    check("ossuary", "The ossuary is an MPC address too, derived from a fixed path", "get_ossuary(chain) vs. offline derivation of ossuary/v1/<chain>", async () => {
      const chains = [...new Set(graves.map((g) => g.chain as ContractChain))];
      const rows = await Promise.all(chains.map(async (c) => ({ c, stored: await registry.ossuary(c) })));
      const set = rows.filter((r) => r.stored);
      const bad = set.filter((r) => deriveAddress(CHAINS[r.c as ChainId].family, NETWORK, CONTRACT_ID, ossuaryPath(r.c)) !== r.stored);
      return { status: bad.length === 0 && set.length > 0 ? "pass" : "fail", detail: `${set.map((r) => r.c).join(", ")}: ${bad.length === 0 ? "all match" : `mismatch on ${bad.map((r) => r.c).join(", ")}`}.` };
    }),
    check(
      "deposits",
      "Every burial is a real transaction on its own chain, verified on NEAR by MPC before the grave was minted",
      "Solana getSignatureStatuses / EVM eth_getTransactionReceipt for each deposit_tx; proof_hash recorded by the verify_foreign_transaction callback",
      async () => {
        const missing: number[] = [];
        const sol = graves.filter((g) => CHAINS[g.chain as ChainId].family === "solana");
        const bySolChain = new Map<string, GraveJson[]>();
        for (const g of sol) bySolChain.set(g.chain, [...(bySolChain.get(g.chain) ?? []), g]);
        for (const [chain, gs] of bySolChain) {
          for (let i = 0; i < gs.length; i += 100) {
            const batch = gs.slice(i, i + 100);
            const r = await jsonRpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>(SOLANA_RPC[chain as ChainId]!, "getSignatureStatuses", [
              batch.map((g) => g.deposit_tx),
              { searchTransactionHistory: true },
            ]);
            r.value.forEach((s, j) => {
              if (!s || s.err) missing.push(batch[j].id);
            });
          }
        }
        for (const g of graves.filter((g) => CHAINS[g.chain as ChainId].family === "evm")) {
          const rc = await jsonRpc<{ status: string } | null>(EVM_RPC[g.chain as ChainId]!, "eth_getTransactionReceipt", [g.deposit_tx]);
          if (!rc || rc.status !== "0x1") missing.push(g.id);
        }
        const unproven = graves.filter((g) => !/^[0-9a-f]{64}$/.test(g.proof_hash)).map((g) => g.id);
        const ok = missing.length === 0 && unproven.length === 0;
        return {
          status: ok ? "pass" : "fail",
          detail: ok
            ? `${plural(graves.length, "deposit")} found on chain, each with an MPC payload hash on NEAR.`
            : `Not found: ${missing.join(", ") || "none"}; no proof hash: ${unproven.join(", ") || "none"}.`,
        };
      },
    ),
    check("accounts", "Every grave NFT controls a NEAR account that has no access keys", "view_access_key_list(g<id>.<contract>) for every grave", async () => {
      const counts = await Promise.all(graves.map(async (g) => ({ id: g.id, n: await accessKeyCount(graveAccountId(g.id)) })));
      const bad = counts.filter((c) => c.n !== 0);
      return {
        status: bad.length === 0 ? "pass" : "fail",
        detail: bad.length === 0 ? `${plural(graves.length, "account")}, 0 keys each.` : `Missing or keyed: ${bad.map((c) => `g${c.id} (${c.n ?? "missing"})`).join(", ")}.`,
        link: graves[0] ? { label: graveAccountId(graves[0].id), href: nearAccountUrl(graveAccountId(graves[0].id)) } : undefined,
      };
    }),
    check(
      "supply",
      "$BONES supply is exactly what burials minted minus what risings burned",
      "ft_total_supply() vs. the sum of get_grave_bones(id).amount − burned",
      async () => {
        const [supply, bones] = await Promise.all([registry.bonesSupply(), Promise.all(graves.map((g) => registry.graveBones(g.id)))]);
        const sum = bones.reduce((t, b) => t + (b ? BigInt(b.amount) - BigInt(b.burned) : 0n), 0n);
        const ok = sum === BigInt(supply);
        return { status: ok ? "pass" : "fail", detail: `${(Number(supply) / 1e6).toLocaleString()} BONES; graves account for ${(Number(sum) / 1e6).toLocaleString()}.`, link: { label: "Every mint and burn", href: "/bones" } };
      },
    ),
    check("rules", "No method can change the $BONES mechanic", "get_bones_rules(): setters is empty; tithe 2000 bps, upkeep 1000 bps", async () => {
      const r = await registry.bonesRules();
      const ok = r.setters.length === 0 && r.tithe_bps === 2000 && r.upkeep_bps === 1000;
      return { status: ok ? "pass" : "fail", detail: `Setters: ${r.setters.length === 0 ? "none" : r.setters.join(", ")}. Tithe ${r.tithe_bps / 100}%, upkeep ${r.upkeep_bps / 100}% of it.` };
    }),
    check(
      "markets",
      "Markets bound to a plot were read from the pool by NEAR MPC, not reported",
      "get_pool_binding / get_market_reading(plot): a reading with an MPC proof hash",
      async () => {
        const plots = await registry.plots();
        const bound = (await Promise.all(plots.map(async (p) => ({ p, b: await registry.poolBinding(p.id).catch(() => null), r: await registry.marketReading(p.id).catch(() => null) })))).filter((x) => x.b);
        const bad = bound.filter((x) => !x.r || !/^[0-9a-f]{64}$/.test(x.r.proof_hash));
        return {
          status: bound.length > 0 && bad.length === 0 ? "pass" : "fail",
          detail: bound.length === 0 ? "No plot is bound to a pool yet." : `${bound.map((x) => `$${x.p.symbol} (${x.p.state.kind.toLowerCase()})`).join(", ")}: ${bad.length === 0 ? "each reading carries its MPC proof hash" : `no proof for ${bad.map((x) => x.p.symbol).join(", ")}`}.`,
        };
      },
    ),
    check("raises", "Every raised grave's payout was signed by NEAR MPC from the grave's own vault", "get_payout('raise:<id>'): signatures present, signed_at set", async () => {
      const raised = graves.filter((g) => g.raised);
      const payouts = await Promise.all(raised.map((g) => registry.payout(`raise:${g.id}`)));
      const bad = raised.filter((_, i) => !payouts[i]?.signed_at || (payouts[i]?.signatures.length ?? 0) === 0);
      return {
        status: bad.length === 0 ? "pass" : "fail",
        detail: raised.length === 0 ? "No grave has been raised yet." : `${plural(raised.length, "raised grave")}: ${bad.length === 0 ? "every payout signed" : `unsigned: ${bad.map((g) => g.id).join(", ")}`}.`,
      };
    }),
    check(
      "attacks",
      "Every attack listed on this page was refused by the contract itself",
      "NEAR tx(hash, sender) on an archival node: the receipt failed with the stated panic",
      async () => {
        const r = refused as Refusals;
        if (r.refusals.length === 0 || !r.sender) return { status: "note", detail: "No attacks recorded yet." };
        const rows = await Promise.all(
          r.refusals.map(async (a) => {
            const out = await jsonRpc<{ receipts_outcome: { outcome: { status: { Failure?: unknown } } }[] }>(NEAR_ARCHIVAL_RPC, "tx", {
              tx_hash: a.tx,
              sender_account_id: r.sender,
              wait_until: "NONE",
            });
            const failures = out.receipts_outcome.map((o) => JSON.stringify(o.outcome.status.Failure ?? "")).join(" ");
            return { a, ok: failures.includes(a.expected.slice(0, 40)) };
          }),
        );
        const bad = rows.filter((x) => !x.ok);
        return {
          status: bad.length === 0 ? "pass" : "fail",
          detail: bad.length === 0 ? `${plural(rows.length, "attack")}, each a failed transaction with the contract's own error.` : `Not confirmed: ${bad.map((x) => x.a.attack).join("; ")}.`,
        };
      },
    ),
    check("lock", "The contract's code can no longer be changed", `view_access_key_list(${CONTRACT_ID})`, async () => {
      const n = await accessKeyCount(CONTRACT_ID);
      return {
        status: n === 0 ? "pass" : "note",
        detail: n === 0 ? "Locked: no access keys." : `Not yet: ${plural(n ?? 0, "access key")} can still deploy new code. See "Security model" in the README.`,
        link: { label: CONTRACT_ID, href: nearAccountUrl(CONTRACT_ID) },
      };
    }),
  ]);
}

export function summarize(checks: Check[]) {
  const scored = checks.filter((c) => c.status !== "note");
  return { passed: scored.filter((c) => c.status === "pass").length, total: scored.length, notes: checks.length - scored.length };
}
