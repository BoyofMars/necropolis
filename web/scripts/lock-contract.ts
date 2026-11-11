/**
 * Lock the contract: delete every access key on the contract account.
 *
 * After this, nobody can deploy new code to the contract, and the owner-only
 * methods (add/remove coroner, NFT base URI, market allowlists, upkeep claims)
 * can never be called again, because the owner is the contract account itself.
 * This is IRREVERSIBLE.
 *
 *   npx tsx scripts/lock-contract.ts          # dry run: shows what would happen
 *   npx tsx scripts/lock-contract.ts --yes    # deletes the keys
 *
 * Signs with the key near-cli keeps in ~/.near-credentials/<network>/<contract>.json.
 * The key itself is never printed.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, type KeyPairString } from "near-api-js";

const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "necropolis.testnet";
const NETWORK = CONTRACT.endsWith(".near") ? "mainnet" : "testnet";
const RPC = process.env.NEAR_RPC_URL ?? (NETWORK === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com");
const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io/txns/" : "https://testnet.nearblocks.io/txns/";

async function rpc<T>(params: Record<string, unknown>): Promise<T> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }),
  });
  const j = (await r.json()) as { result?: T; error?: unknown };
  if (!j.result) throw new Error(`RPC error: ${JSON.stringify(j.error)}`);
  return j.result;
}

async function keys(): Promise<{ public_key: string; access_key: { permission: unknown } }[]> {
  return (await rpc<{ keys: { public_key: string; access_key: { permission: unknown } }[] }>({ request_type: "view_access_key_list", account_id: CONTRACT })).keys;
}

async function view<T>(method: string): Promise<T> {
  const r = await rpc<{ result: number[] }>({
    request_type: "call_function",
    account_id: CONTRACT,
    method_name: method,
    args_base64: Buffer.from("{}").toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString()) as T;
}

async function main() {
  const go = process.argv.includes("--yes");
  const config = await view<{ owner_id: string }>("get_config");
  const coroners = await view<string[]>("get_coroners");
  const before = await keys();

  console.log(`Contract:   ${CONTRACT} (${NETWORK})`);
  console.log(`Owner:      ${config.owner_id}`);
  console.log(`Coroners:   ${coroners.join(", ") || "none"}`);
  console.log(`Access keys (${before.length}):`);
  for (const k of before) console.log(`  ${k.public_key}  ${JSON.stringify(k.access_key.permission)}`);

  if (config.owner_id !== CONTRACT) {
    throw new Error(`The owner is ${config.owner_id}, not the contract itself: deleting the keys would leave that account's admin powers in place. Not locking.`);
  }
  if (before.length === 0) {
    console.log("\nAlready locked: the contract account has no access keys.");
    return;
  }

  const credPath = join(homedir(), ".near-credentials", NETWORK, `${CONTRACT}.json`);
  const cred = JSON.parse(readFileSync(credPath, "utf8")) as { public_key: string; private_key: string };
  const signing = before.find((k) => k.public_key === cred.public_key);
  if (!signing) throw new Error(`The key in ${credPath} is not on ${CONTRACT}.`);
  if (signing.access_key.permission !== "FullAccess") throw new Error("The local key is not a full-access key, so it can't delete keys.");

  // Delete every other key first, then the one we sign with.
  const order = [...before.filter((k) => k.public_key !== cred.public_key), signing];
  console.log(`\nWould delete, in order: ${order.map((k) => k.public_key).join(", ")}`);
  console.log("After this, the contract's code and its owner-only settings can never change.");
  if (!go) {
    console.log("\nDry run. Re-run with --yes to lock.");
    return;
  }

  const account = new Account(CONTRACT, RPC, cred.private_key as KeyPairString);
  for (const k of order) {
    const r = (await account.deleteKey(k.public_key)) as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } };
    const hash = r.transaction?.hash ?? r.transaction_outcome?.id ?? "?";
    console.log(`Deleted ${k.public_key}: ${EXPLORER}${hash}`);
  }

  // The key list is read at a final block, a few seconds behind the deletion.
  let after = await keys();
  for (let i = 0; i < 10 && after.length > 0; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    after = await keys();
  }
  console.log(`\nAccess keys now: ${after.length}${after.length === 0 ? ". Locked." : ". NOT locked."}`);
  if (after.length !== 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
