/**
 * End-to-end testnet run against a live app, acting as a user with a Solana
 * devnet wallet: faucet → scan → prepare → sign → submit → confirm (MPC
 * verification on NEAR) → séance → rising → raise (MPC-signed payout).
 *
 *   npx tsx scripts/e2e-solana.ts [bury|seance|raise|all] [--grave <id>] [--app http://localhost:3000]
 *   npx tsx scripts/e2e-solana.ts claim --grave <id> --event <id>   (ossuary share)
 *   npx tsx scripts/e2e-solana.ts owner --grave <id>                (wallet-signed epitaph)
 *   npx tsx scripts/e2e-solana.ts candle --grave <id>[,<id>…]        (wallet-signed candles)
 *   --user <name> picks a separate test wallet (.e2e-<name>.json)
 *
 * The test user's key lives in .e2e-user.json (gitignored). It never needs SOL:
 * the Sexton pays fees.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519.js";
import { actionMessage, candleMessage, registry } from "../src/core/near";

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
  // --user <name> keeps several test wallets apart (.e2e-<name>.json, gitignored)
  const name = flag("user");
  const p = name ? `.e2e-${name}.json` : ".e2e-user.json";
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
  for (let i = 0; i < 14; i++) {
    const r = await call<{
      state?: { kind: string };
      skipped?: string;
      waitSeconds?: number;
      transition?: string;
      risen?: boolean;
      nearTx?: string;
      bound?: boolean;
      revived?: string[];
      market?: { liquidity_usd: string; market_cap_usd: string; proof_hash: string } | null;
    }>("/api/seance", { plotId, mode: "revive" });
    log("séance:", r.skipped ?? r.transition, r.state?.kind, r.nearTx ?? "");
    if (r.bound) log("  pool bound to the plot by its first MPC-verified reading");
    if (r.market) log(`  MPC-verified: liquidity $${r.market.liquidity_usd}, market cap $${r.market.market_cap_usd}, proof ${r.market.proof_hash.slice(0, 16)}…`);
    if (r.revived) log("  revival trades on Raydium devnet:", r.revived.join(", "));
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

/** Claim a resting grave's ossuary share of another plot's rising. */
async function claim(u: Keypair, graveId: number, eventId: number) {
  const ev = (await registry.events()).find((e) => e.id === eventId);
  if (!ev) throw new Error(`event ${eventId} not found`);
  const share = await registry.share(graveId, eventId);
  log(`share of event ${eventId} ($${ev.symbol}) for grave ${graveId}:`, JSON.stringify(share));
  const before = await tokenBalance(u.publicKey, ev.token);
  const r = await call<{ txs: string[]; nearTx?: string }>("/api/claim", { graveId, eventId });
  log("claim near tx", r.nearTx, "solana txs", r.txs.join(", "));
  await sleep(8_000);
  const after = await tokenBalance(u.publicKey, ev.token);
  log(`grave ${graveId} owner $${ev.symbol}: ${before} → ${after} (+${after - before})`);
}

/**
 * Wallet-signed owner action through the relay, plus the two attacks it must
 * refuse: a signature from the wrong key, and a replay of a used signature.
 */
async function owner(u: Keypair, graveId: number) {
  const g = await registry.grave(graveId);
  if (!g) throw new Error(`grave ${graveId} not found`);
  const ownerId = Buffer.from(u.publicKey.toBytes()).toString("hex");
  if (g.owner_id !== ownerId) throw new Error(`this user (${ownerId}) does not own grave ${graveId} (${g.owner_id})`);
  const epitaph = flag("epitaph") ?? `Signed by its keeper, ${new Date().toISOString().slice(0, 16)}Z.`;
  const nonce = Number(await registry.nonce(ownerId));
  const message = actionMessage("set_epitaph", graveId, [["epitaph", epitaph]], nonce);
  const sign = (secret: Uint8Array) => bs58.encode(ed25519.sign(new TextEncoder().encode(message), secret.slice(0, 32)));

  const forged = await call("/api/owner", { action: "set_epitaph", graveId, value: epitaph, nonce, signature: sign(Keypair.generate().secretKey) }).then(
    () => "ACCEPTED (bad)",
    (e: Error) => `refused: ${e.message}`,
  );
  log("forged signature →", forged);

  const signature = sign(u.secretKey);
  const r = await call<{ nearTx: string }>("/api/owner", { action: "set_epitaph", graveId, value: epitaph, nonce, signature });
  log("signed epitaph → near tx", r.nearTx);

  const replay = await call("/api/owner", { action: "set_epitaph", graveId, value: epitaph, nonce, signature }).then(
    () => "ACCEPTED (bad)",
    (e: Error) => `refused: ${e.message}`,
  );
  log("replayed signature →", replay);

  const after = await registry.grave(graveId);
  log("epitaph on NEAR:", JSON.stringify(after?.epitaph), "nonce", nonce, "→", await registry.nonce(ownerId));
  if (after?.epitaph !== epitaph || forged.startsWith("ACCEPTED") || replay.startsWith("ACCEPTED")) throw new Error("owner action check failed");
}

/** Light a wallet-signed candle on a grave, and check that a forged one and a second one are refused. */
async function candle(u: Keypair, graveId: number) {
  const mourner = Buffer.from(u.publicKey.toBytes()).toString("hex");
  const message = candleMessage(graveId, mourner);
  const sign = (secret: Uint8Array) => bs58.encode(ed25519.sign(new TextEncoder().encode(message), secret.slice(0, 32)));
  const refused = (p: Promise<unknown>) => p.then(() => "ACCEPTED (bad)", (e: Error) => `refused: ${e.message}`);
  const forged = await refused(call("/api/candle", { graveId, mourner, signature: sign(Keypair.generate().secretKey) }));
  log("forged candle →", forged);
  const r = await call<{ candles: number; nearTx: string }>("/api/candle", { graveId, mourner, signature: sign(u.secretKey) });
  log(`candle lit on grave ${graveId} (now ${r.candles}) → near tx`, r.nearTx);
  const again = await refused(call("/api/candle", { graveId, mourner, signature: sign(u.secretKey) }));
  log("second candle from the same wallet →", again);
  if (forged.startsWith("ACCEPTED") || again.startsWith("ACCEPTED")) throw new Error("candle check failed");
}

(async () => {
  const u = user();
  if (stage === "candle") {
    for (const g of (flag("grave") ?? "0").split(",")) await candle(u, Number(g));
    return;
  }
  if (stage === "claim") {
    await claim(u, Number(flag("grave")), Number(flag("event")));
    return;
  }
  if (stage === "owner") {
    await owner(u, Number(flag("grave")));
    return;
  }
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
