/**
 * The Sexton: Necropolis's relayer + coroner keys. Server-only.
 *
 * Trust model (see README → Security):
 *  - It pays NEAR gas and Solana fees so users never need NEAR or SOL.
 *  - As coroner it appraises burials and reports vital signs. It can NOT mint a
 *    grave without an MPC-verified deposit, and it can NOT move buried tokens:
 *    only the contract can request signatures for grave addresses, and only for
 *    payouts to the grave's owner + the ossuary.
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { Account, type KeyPairString } from "near-api-js";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACT_ID, NEAR_RPC } from "@/core/near";

export class SextonConfigError extends Error {}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new SextonConfigError(`Server is missing ${name}. See .env.example.`);
  return v;
}

let nearAccount: Account | null = null;
export function sextonNear(): Account {
  if (!nearAccount) {
    nearAccount = new Account(
      need("SEXTON_NEAR_ACCOUNT"),
      process.env.NEAR_RPC_URL ?? NEAR_RPC,
      need("SEXTON_NEAR_PRIVATE_KEY") as KeyPairString,
    );
  }
  return nearAccount;
}

export function sextonSolana(): Keypair {
  return Keypair.fromSecretKey(bs58.decode(need("SEXTON_SOLANA_SECRET")));
}

export function sextonEvm() {
  return privateKeyToAccount(need("SEXTON_EVM_PRIVATE_KEY") as `0x${string}`);
}

export function sextonConfigured(): { near: boolean; solana: boolean; evm: boolean } {
  return {
    near: !!process.env.SEXTON_NEAR_ACCOUNT && !!process.env.SEXTON_NEAR_PRIVATE_KEY,
    solana: !!process.env.SEXTON_SOLANA_SECRET,
    evm: !!process.env.SEXTON_EVM_PRIVATE_KEY,
  };
}

const TGAS = 1_000_000_000_000n;

/** Call the Necropolis contract as the Sexton and return the final value of the receipt chain. */
export async function callContract<T>(method: string, args: Record<string, unknown>, tgas = 300, deposit = 0n): Promise<T> {
  return sextonNear().callFunction<T & object>({
    contractId: CONTRACT_ID,
    methodName: method,
    args,
    gas: BigInt(tgas) * TGAS,
    deposit,
  }) as Promise<T>;
}

/** Same, but return the raw outcome so callers can read logs and the tx hash. */
export async function callContractRaw(method: string, args: Record<string, unknown>, tgas = 300) {
  const res = await sextonNear().callFunctionRaw({
    contractId: CONTRACT_ID,
    methodName: method,
    args,
    gas: BigInt(tgas) * TGAS,
    deposit: 0n,
  });
  const r = res as unknown as {
    transaction?: { hash?: string };
    transaction_outcome?: { id?: string };
    status?: { SuccessValue?: string; Failure?: unknown };
    receipts_outcome?: { outcome: { logs: string[]; status: { Failure?: unknown } } }[];
  };
  const logs = (r.receipts_outcome ?? []).flatMap((o) => o.outcome.logs);
  const value = r.status?.SuccessValue !== undefined ? decodeValue(r.status.SuccessValue) : undefined;
  const failure = r.status?.Failure ?? (r.receipts_outcome ?? []).find((o) => o.outcome.status.Failure)?.outcome.status.Failure;
  return { hash: r.transaction?.hash ?? r.transaction_outcome?.id ?? "", logs, value, failure };
}

function decodeValue(b64: string): unknown {
  if (!b64) return null;
  const s = Buffer.from(b64, "base64").toString("utf8");
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Parse NEP-297 EVENT_JSON logs emitted by the contract. */
export function parseEvents(logs: string[]): { event: string; data: Record<string, unknown> }[] {
  const out: { event: string; data: Record<string, unknown> }[] = [];
  for (const l of logs) {
    if (!l.startsWith("EVENT_JSON:")) continue;
    try {
      const e = JSON.parse(l.slice("EVENT_JSON:".length)) as { event: string; data: Record<string, unknown>[] };
      for (const d of e.data) out.push({ event: e.event, data: d });
    } catch {
      /* ignore malformed logs */
    }
  }
  return out;
}
