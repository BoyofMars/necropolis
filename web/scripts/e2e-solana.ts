/**
 * End-to-end testnet run against a live app, acting as a user with a Solana
 * devnet wallet: faucet → scan → prepare → sign → submit → confirm (MPC
 * verification on NEAR) → séance → rising → raise (MPC-signed payout).
 *
 *   npx tsx scripts/e2e-solana.ts [bury|seance|raise|all] [--grave <id>] [--app http://localhost:3000]
 *
 * The test user's key lives in .e2e-user.json (gitignored). It never needs SOL:
 * the Sexton pays fees.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { registry } from "../src/core/near";

const args = process.argv.slice(2);
const stage = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a) && !a.startsWith("http")) ?? "all";
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const APP = flag("app") ?? "http://localhost:3000";
const SYMBOL = flag("symbol") ?? "FUMBLE";
const conn = new Connection("https://api.devnet.solana.com", "confirmed");

function user(): Keypair {
  const p = ".e2e-user.json";
  if (existsSync(p)) return Keypair.fromSecretKey(bs58.decode(JSON.parse(readFileSync(p, "utf8")).secret));
  const k = Keypair.generate();
  writeFileSync(p, JSON.stringify({ secret: bs58.encode(k.secretKey) }));
  return k;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${APP}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${json.error}`);
  return json;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...m: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...m);

async function tokenBalance(owner: PublicKey, mint: string): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(new PublicKey(mint), owner);
  const b = await conn.getTokenAccountBalance(ata).catch(() => null);
  return b ? BigInt(b.value.amount) : 0n;
}

async function bury(u: Keypair): Promise<number> {
  const owner = u.publicKey.toBase58();
  log("user", owner);
  try {
    const f = await call<{ sent: { symbol: string }[] }>("/api/faucet", { sol: owner });
    log("faucet sent", f.sent.map((s) => s.symbol).join(", "));
  } catch (e) {
    log("faucet:", (e as Error).message);
  }
  const scan = await call<{ entries: { address: string; symbol: string; amountRaw: string; diagnosis: { condition: string; deathScore?: number } }[] }>(
    `/api/scan?chain=sol-devnet&address=${owner}`,
  );
  log("scan:", scan.entries.map((e) => `${e.symbol}=${e.diagnosis.condition}(${e.diagnosis.deathScore})`).join(" "));
  const bag = scan.entries.find((e) => e.symbol === SYMBOL);
  if (!bag) throw new Error(`no ${SYMBOL} in wallet`);

  const prep = await call<{ solanaTx: string; nonce: number; graveAddress: string; path: string; amount: string; appraisal: { valueUsd: number; weightUsd: number } }>(
    "/api/bury/prepare",
    { chain: "sol-devnet", token: bag.address, owner, amount: bag.amountRaw },
  );
  log("prepared grave", prep.graveAddress, "path", prep.path, `value $${prep.appraisal.valueUsd.toFixed(2)} weight $${prep.appraisal.weightUsd.toFixed(2)}`);
  const tx = Transaction.from(Buffer.from(prep.solanaTx, "base64"));
  tx.partialSign(u);
  const { signature } = await call<{ signature: string }>("/api/bury/submit", {
    chain: "sol-devnet",
    tx: tx.serialize({ requireAllSignatures: true }).toString("base64"),
  });
  log("deposit tx", signature);

  for (let i = 0; i < 60; i++) {
    const r = await call<{ stage: string; detail?: string; graveId?: number; reason?: string; nearTx?: string }>("/api/bury/confirm", {
      chain: "sol-devnet",
      token: bag.address,
      owner,
      nonce: prep.nonce,
      amount: prep.amount,
      tx: signature,
      epitaph: "Dev was a little guy. Then he wasn't.",
    });
    log("confirm:", r.stage, r.detail ?? r.reason ?? "", r.nearTx ? `near ${r.nearTx}` : "");
    if (r.stage === "buried") return r.graveId!;
    if (r.stage === "failed") throw new Error(r.reason);
    await sleep(r.stage === "finalizing" ? 5_000 : 3_000);
  }
  throw new Error("timed out waiting for burial");
}

async function seance(graveId: number) {
  const g = await registry.grave(graveId);
  const plotId = g?.plot_id;
  if (!plotId) throw new Error(`grave ${graveId} not found on NEAR`);
  for (let i = 0; i < 12; i++) {
    const r = await call<{ state?: { kind: string }; skipped?: string; waitSeconds?: number; transition?: string; risen?: boolean; nearTx?: string }>("/api/seance", {
      plotId,
      mode: "revive",
    });
    log("séance:", r.skipped ?? r.transition, r.state?.kind, r.nearTx ?? "");
    if (r.risen || r.state?.kind === "RISEN") return;
    await sleep(((r.waitSeconds ?? 0) + 62) * 1000);
  }
  throw new Error("plot did not rise");
}

async function raise(u: Keypair, graveId: number, mint: string) {
  const before = await tokenBalance(u.publicKey, mint);
  const r = await call<{ txs: string[]; nearTx?: string }>("/api/raise", { graveId });
  log("raise near tx", r.nearTx, "solana txs", r.txs.join(", "));
  await sleep(8_000);
  const after = await tokenBalance(u.publicKey, mint);
  log(`user ${SYMBOL} balance: ${before} → ${after}`);
}

(async () => {
  const u = user();
  let graveId = flag("grave") ? Number(flag("grave")) : undefined;
  if (stage === "bury" || stage === "all") graveId = await bury(u);
  log("grave", graveId);
  if (graveId === undefined) throw new Error("need --grave");
  const g = await registry.grave(graveId);
  log("on NEAR:", JSON.stringify({ owner: g?.owner_id, grave_address: g?.grave_address, amount: g?.amount, weight: g?.weight_usd_e6, proof: g?.proof_hash }));
  if (stage === "seance" || stage === "all") await seance(graveId);
  if (stage === "raise" || stage === "all") await raise(u, graveId, g!.token);
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
