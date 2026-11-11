/**
 * Live testnet run of the NFT brief's hard case: a grave sold in the middle
 * of a payout, and every way the seller could try to keep the money.
 *
 *   npx tsx --env-file=.env.local scripts/e2e-accounts.ts [--app http://localhost:3000] [--fresh]
 *
 *  1. seller buries COPIUM → grave X; its BONES are minted into gX.<contract>
 *  2. riser buries PHOENIX → grave Y
 *  3. séance: PHOENIX rises. gX holds BONES at that moment, so it is owed a share
 *  4. attacks: a relayer exhumes with no signature; anyone claims before the tithe is in
 *  5. raise Y: MPC signs the payout, the tithe reaches the ossuary
 *  6. the seller sells grave X to the buyer (wallet-signed)
 *  7. the crypt: the seller is turned away, the buyer gets in
 *  8. attacks, straight to the contract as a malicious relayer would send them:
 *     the seller exhumes, redirects payouts, claims to their own key, sells again
 *  9. anyone claims gX's share → the MPC network pays the buyer's Solana key
 * 10. attacks: claim it twice; replay the buyer's signed exhume
 *
 * Refused attacks are written to testnet-refused.json (shown on /verify).
 * Progress is kept in .e2e-accounts.json (gitignored) so a run can resume.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519.js";
import { actionMessage, cryptMessage, graveAccountId, registry } from "../src/core/near";
import { callContractRaw } from "../src/server/sexton";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const APP = flag("app") ?? "http://localhost:3000";
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const STATE = ".e2e-accounts.json";

interface Refusal {
  attack: string;
  expected: string;
  tx: string;
}
interface State {
  graveX?: number;
  graveY?: number;
  eventId?: number;
  done: string[];
  refusals: Refusal[];
}
const state: State = !args.includes("--fresh") && existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { done: [], refusals: [] };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...m: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...m);

function wallet(name: string): Keypair {
  const p = `.e2e-${name}.json`;
  if (existsSync(p)) return Keypair.fromSecretKey(bs58.decode(JSON.parse(readFileSync(p, "utf8")).secret));
  const k = Keypair.generate();
  writeFileSync(p, JSON.stringify({ secret: bs58.encode(k.secretKey) }));
  return k;
}
const idOf = (k: Keypair) => Buffer.from(k.publicKey.toBytes()).toString("hex");
const sign = (k: Keypair, message: string) => bs58.encode(ed25519.sign(new TextEncoder().encode(message), k.secretKey.slice(0, 32)));

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${APP}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(`${path} → ${res.status}: ${json.error}`), { status: res.status });
  return json;
}

async function tokenBalance(owner: PublicKey, mint: string): Promise<bigint> {
  const b = await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(mint), owner)).catch(() => null);
  return b ? BigInt(b.value.amount) : 0n;
}

async function step(name: string, f: () => Promise<void>) {
  if (state.done.includes(name)) return log(`(done) ${name}`);
  log(`── ${name}`);
  await f();
  state.done.push(name);
  save();
}

/** Send a call straight to the contract (no server pre-checks) and require that it fails. */
async function attack(attack: string, method: string, a: Record<string, unknown>) {
  let tx: string | undefined;
  let reason: string;
  try {
    const r = await callContractRaw(method, a, 60);
    if (!r.failure) throw new Error(`ACCEPTED (bad): ${attack} → ${r.hash}`);
    tx = r.hash;
    reason = JSON.stringify(r.failure).match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? "failed";
  } catch (e) {
    const err = e as Error & { transactionResult?: { transaction?: { hash?: string }; transaction_outcome?: { id?: string } } };
    if (err.message.startsWith("ACCEPTED")) throw err;
    tx = err.transactionResult?.transaction?.hash ?? err.transactionResult?.transaction_outcome?.id;
    if (!tx) throw err;
    reason = err.message.match(/Smart contract panicked: (.+)/)?.[1]?.trim() ?? err.message;
  }
  state.refusals = state.refusals.filter((r) => r.attack !== attack).concat({ attack, expected: reason, tx });
  save();
  log(`refused ✓ ${attack}\n           → "${reason}" (${tx})`);
}

async function bury(u: Keypair, symbol: string): Promise<number> {
  const owner = u.publicKey.toBase58();
  try {
    const f = await call<{ sent: { symbol: string }[] }>("/api/faucet", { sol: owner });
    log("faucet:", f.sent.map((s) => s.symbol).join(", "));
  } catch (e) {
    log("faucet:", (e as Error).message);
  }
  let bag: { address: string; symbol: string; amountRaw: string } | undefined;
  for (let i = 0; i < 10 && !bag; i++) {
    const scan = await call<{ entries: { address: string; symbol: string; amountRaw: string }[] }>(`/api/scan?chain=sol-devnet&address=${owner}`);
    bag = scan.entries.find((e) => e.symbol === symbol);
    if (!bag) await sleep(3_000);
  }
  if (!bag) throw new Error(`no ${symbol} in ${owner}`);
  const prep = await call<{ solanaTx: string; nonce: number; graveAddress: string; amount: string; appraisal: { valueUsd: number; weightUsd: number } }>(
    "/api/bury/prepare",
    { chain: "sol-devnet", token: bag.address, owner, amount: bag.amountRaw },
  );
  log(`${symbol}: vault ${prep.graveAddress}, weight $${prep.appraisal.weightUsd.toFixed(2)}`);
  const tx = Transaction.from(Buffer.from(prep.solanaTx, "base64"));
  tx.partialSign(u);
  const { signature } = await call<{ signature: string }>("/api/bury/submit", { chain: "sol-devnet", tx: tx.serialize({ requireAllSignatures: true }).toString("base64") });
  log("deposit", signature);
  for (let i = 0; i < 60; i++) {
    const r = await call<{ stage: string; graveId?: number; reason?: string; nearTx?: string }>("/api/bury/confirm", {
      chain: "sol-devnet",
      token: bag.address,
      owner,
      nonce: prep.nonce,
      amount: prep.amount,
      tx: signature,
    });
    if (r.stage === "buried") {
      log(`buried → grave ${r.graveId} (near ${r.nearTx ?? "?"})`);
      return r.graveId!;
    }
    if (r.stage === "failed") throw new Error(r.reason);
    await sleep(r.stage === "finalizing" ? 5_000 : 3_000);
  }
  throw new Error("timed out waiting for burial");
}

async function seance(graveId: number): Promise<number> {
  const g = await registry.grave(graveId);
  for (let i = 0; i < 16; i++) {
    const r = await call<{ state?: { kind: string; event_id?: number }; skipped?: string; waitSeconds?: number; transition?: string; risen?: boolean }>("/api/seance", {
      plotId: g!.plot_id,
      mode: "revive",
    });
    log("séance:", r.skipped ?? r.transition, r.state?.kind ?? "");
    if (r.risen || r.state?.kind === "RISEN") {
      const plot = await registry.plot(g!.plot_id);
      if (plot?.state.kind === "RISEN") return plot.state.event_id;
    }
    await sleep(((r.waitSeconds ?? 0) + 62) * 1000);
  }
  throw new Error("plot did not rise");
}

(async () => {
  const seller = wallet("seller");
  const buyer = wallet("buyer");
  const riser = wallet("riser");
  const [S, B] = [idOf(seller), idOf(buyer)];
  log(`seller ${seller.publicKey.toBase58()} · buyer ${buyer.publicKey.toBase58()} · riser ${riser.publicKey.toBase58()}`);

  await step("seller buries COPIUM", async () => {
    state.graveX = await bury(seller, "COPIUM");
  });
  const X = state.graveX!;
  const gX = graveAccountId(X);
  await step("riser buries PHOENIX", async () => {
    state.graveY = await bury(riser, "PHOENIX");
  });
  const Y = state.graveY!;
  log(`grave X = ${X} (${gX} holds ${Number(await registry.bonesBalance(gX)) / 1e6} BONES) · grave Y = ${Y}`);

  await step("PHOENIX rises", async () => {
    state.eventId = await seance(Y);
    log(`risen: event ${state.eventId}`);
  });
  const E = state.eventId!;
  const share = await registry.bonesShare(E, gX);
  log(`gX's share of rising ${E}: ${share?.amount ?? share?.reason} (held ${Number(share?.balance_at_rising ?? 0) / 1e6} of ${Number(share?.supply_at_rising ?? 0) / 1e6} BONES)`);

  await step("attacks before the raise", async () => {
    await attack("A relayer moves a grave's BONES with no signature from its holder", "exhume_bones", { grave_id: X, amount: "1", auth: null });
    await attack("Claim a share before the risen coin's tithe has reached the ossuary", "claim_bones", {
      event_id: E,
      holder: gX,
      recipient: null,
      auth: null,
      solana: { fee_payer: riser.publicKey.toBase58(), blockhash: riser.publicKey.toBase58() },
      evm: null,
    });
  });

  await step("raise grave Y", async () => {
    const r = await call<{ txs: string[]; nearTx?: string }>("/api/raise", { graveId: Y });
    log("raised: near", r.nearTx, "solana", r.txs.join(", "));
  });

  await step("seller sells grave X to buyer", async () => {
    const nonce = Number(await registry.nonce(S));
    const message = actionMessage("transfer_grave", X, [["receiver", B]], nonce);
    const r = await call<{ nearTx: string }>("/api/owner", { action: "transfer_grave", graveId: X, value: B, nonce, signature: sign(seller, message) });
    log("transferred: near", r.nearTx);
    const g = await registry.grave(X);
    if (g?.owner_id !== B) throw new Error("transfer did not land");
  });

  await step("the crypt", async () => {
    const issued = Math.floor(Date.now() / 1000);
    const msg = cryptMessage(X, issued);
    const theSeller = await call("/api/crypt", { graveId: X, issued, signature: sign(seller, msg), signer: S }).then(
      () => "OPENED (bad)",
      (e: Error) => e.message,
    );
    log("seller at the crypt →", theSeller);
    if (theSeller.startsWith("OPENED")) throw new Error("the crypt let the seller in");
    const c = await call<{ holder: string; checkedAt: { height: number } }>("/api/crypt", { graveId: X, issued, signature: sign(buyer, msg), signer: B });
    log(`buyer at the crypt → opened at block #${c.checkedAt.height}`);
  });

  await step("attacks by the seller after the sale", async () => {
    // The seller signs with the grave's current nonce, so only the signature can stop them.
    const n = () => registry.nonce(B).then(Number);
    let nonce = await n();
    await attack("After the sale, the seller exhumes the grave's BONES", "exhume_bones", {
      grave_id: X,
      amount: "1000000",
      auth: { nonce, signature: sign(seller, actionMessage("exhume_bones", X, [["amount", "1000000"]], nonce)) },
    });
    nonce = await n();
    const sellerKey = seller.publicKey.toBase58();
    await attack("After the sale, the seller points the grave's payouts at their own wallet", "set_payout_address", {
      grave_id: X,
      address: sellerKey,
      auth: { nonce, signature: sign(seller, actionMessage("set_payout_address", X, [["address", sellerKey]], nonce)) },
    });
    nonce = await n();
    await attack("After the sale, the seller claims the grave's share to their own wallet", "claim_bones", {
      event_id: E,
      holder: gX,
      recipient: sellerKey,
      auth: { nonce, signature: sign(seller, actionMessage("claim_bones", X, [["event", String(E)], ["recipient", sellerKey]], nonce)) },
      solana: { fee_payer: riser.publicKey.toBase58(), blockhash: riser.publicKey.toBase58() },
      evm: null,
    });
    nonce = await n();
    await attack("After the sale, the seller sells the grave again", "transfer_grave", {
      grave_id: X,
      receiver_id: S,
      auth: { nonce, signature: sign(seller, actionMessage("transfer_grave", X, [["receiver", S]], nonce)) },
    });
  });

  await step("claim pays the buyer", async () => {
    const ev = (await registry.events()).find((e) => e.id === E)!;
    const before = await tokenBalance(buyer.publicKey, ev.token);
    const sellerBefore = await tokenBalance(seller.publicKey, ev.token);
    const r = await call<{ txs: string[]; nearTx: string }>("/api/bones/claim", { eventId: E, holder: gX });
    log("claimed: near", r.nearTx, "solana", r.txs.join(", "));
    await sleep(10_000);
    const after = await tokenBalance(buyer.publicKey, ev.token);
    const sellerAfter = await tokenBalance(seller.publicKey, ev.token);
    log(`buyer $${ev.symbol}: ${before} → ${after} (+${after - before}) · seller: ${sellerBefore} → ${sellerAfter}`);
    if (after <= before) throw new Error("the buyer was not paid");
    if (sellerAfter !== sellerBefore) throw new Error("the seller was paid");
  });

  await step("buyer exhumes, and replays are refused", async () => {
    await attack("Claim the same share twice", "claim_bones", {
      event_id: E,
      holder: gX,
      recipient: null,
      auth: null,
      solana: { fee_payer: riser.publicKey.toBase58(), blockhash: riser.publicKey.toBase58() },
      evm: null,
    });
    const nonce = Number(await registry.nonce(B));
    const amount = "5000000";
    const signature = sign(buyer, actionMessage("exhume_bones", X, [["amount", amount]], nonce));
    const r = await call<{ nearTx: string }>("/api/owner", { action: "exhume_bones", graveId: X, value: amount, nonce, signature });
    log("buyer exhumed 5 BONES: near", r.nearTx, `· buyer now holds ${Number(await registry.bonesBalance(B)) / 1e6} BONES`);
    await attack("Replay the buyer's signed exhume", "exhume_bones", { grave_id: X, amount, auth: { nonce, signature } });
  });

  // Publish the refusals for /verify.
  writeFileSync(
    "testnet-refused.json",
    JSON.stringify(
      {
        about: "Attacks sent straight to the contract on testnet by scripts/e2e-accounts.ts, skipping our server's own checks. Each transaction failed with the contract's error.",
        sender: process.env.SEXTON_NEAR_ACCOUNT,
        graves: { sold: X, risen: Y, event: E },
        refusals: state.refusals,
      },
      null,
      2,
    ) + "\n",
  );
  log("history of grave X:");
  for (const h of await registry.graveHistory(X)) log(`  ${h.kind.padEnd(14)} ${h.amount ?? ""} ${h.symbol ?? ""} ${h.account ?? ""} ${h.note ?? ""}`);
  log(`${state.refusals.length} attacks refused. Done.`);
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
