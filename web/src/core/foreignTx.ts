/**
 * NEAR MPC foreign-chain transaction verification (MPC contract v3.18.0).
 *
 * The MPC network can attest that a transaction happened on Solana or Base.
 * It signs sha256(borsh(ForeignTxSignPayload::V1 { request, values })), and if
 * the caller supplies `expected_payload_hash`, the MPC contract rejects any
 * response whose hash differs. So a contract that computes the expected hash
 * from the *claimed* deposit gets a cryptographic yes/no from the MPC network.
 *
 * This file is a faithful borsh encoder for the subset we use, transcribed
 * from `near-mpc-contract-interface/src/types/foreign_chain.rs`. The Rust
 * contract has an identical encoder (`contract/src/foreign.rs`); both are
 * tested against the same vectors.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

class BorshWriter {
  private chunks: number[] = [];
  u8(v: number) {
    this.chunks.push(v & 0xff);
    return this;
  }
  bool(v: boolean) {
    return this.u8(v ? 1 : 0);
  }
  u32(v: number) {
    for (let i = 0; i < 4; i++) this.chunks.push((v >>> (8 * i)) & 0xff);
    return this;
  }
  u64(v: bigint | number) {
    let x = BigInt(v);
    for (let i = 0; i < 8; i++) {
      this.chunks.push(Number(x & 0xffn));
      x >>= 8n;
    }
    return this;
  }
  fixed(bytes: Uint8Array, len: number) {
    if (bytes.length !== len) throw new Error(`expected ${len} bytes, got ${bytes.length}`);
    for (const b of bytes) this.chunks.push(b);
    return this;
  }
  bytes(bytes: Uint8Array) {
    this.u32(bytes.length);
    for (const b of bytes) this.chunks.push(b);
    return this;
  }
  string(s: string) {
    return this.bytes(new TextEncoder().encode(s));
  }
  toBytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

export type EvmFinality = "Latest" | "Safe" | "Finalized";
export type SvmFinality = "Confirmed" | "Finalized";

const EVM_FINALITY: Record<EvmFinality, number> = { Latest: 0, Safe: 1, Finalized: 2 };
const SVM_FINALITY: Record<SvmFinality, number> = { Confirmed: 0, Finalized: 1 };

/** ForeignChainRpcRequest variant indices (declaration order). */
const RPC_VARIANT = { Solana: 2, Base: 6 } as const;
/** ExtractedValue variant indices (declaration order). */
const VALUE_VARIANT = { Evm: 1, Svm: 6 } as const;

export interface BaseLogRequest {
  chain: "Base";
  txHash: string; // 0x + 64 hex
  logIndex: number;
  finality: EvmFinality;
}

export interface SolanaAccountRequest {
  chain: "Solana";
  /** base58 signature decoded to 64 bytes, as hex. The anchor: it must exist
   *  and have succeeded. Accounts are read at their *current* state, at a slot
   *  no earlier than this transaction's. */
  txSignatureHex: string;
  /** account pubkeys (32 bytes each) as hex, one AccountState extractor each */
  accountsHex: string[];
  finality: SvmFinality;
}

export type ForeignRequest = BaseLogRequest | SolanaAccountRequest;

export interface EvmLogValue {
  removed: boolean;
  logIndex: number;
  transactionIndex: number;
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
  address: string; // 0x + 40 hex
  data: string; // as returned by eth_getTransactionReceipt
  topics: string[];
}

export interface SvmAccountValue {
  /** program owner of the account, 32 bytes hex */
  ownerHex: string;
  /** raw account data, hex */
  dataHex: string;
}

const strip0x = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const hx = (h: string) => hexToBytes(strip0x(h).toLowerCase());

export function encodeRequest(w: BorshWriter, req: ForeignRequest) {
  if (req.chain === "Base") {
    w.u8(RPC_VARIANT.Base);
    w.fixed(hx(req.txHash), 32);
    w.u32(1); // extractors: one Log extractor
    w.u8(1).u64(req.logIndex); // EvmExtractor::Log = 1 (explicit discriminant)
    w.u8(EVM_FINALITY[req.finality]);
  } else {
    w.u8(RPC_VARIANT.Solana);
    w.fixed(hx(req.txSignatureHex), 64);
    w.u8(SVM_FINALITY[req.finality]);
    w.u32(req.accountsHex.length); // extractors: one AccountState per account
    for (const a of req.accountsHex) w.u8(2).fixed(hx(a), 32); // SvmExtractor::AccountState = 2
  }
}

export function encodeEvmLog(w: BorshWriter, log: EvmLogValue) {
  w.u8(VALUE_VARIANT.Evm);
  w.u8(1); // EvmExtractedValue::Log
  w.bool(log.removed);
  w.u64(log.logIndex);
  w.u64(log.transactionIndex);
  w.fixed(hx(log.transactionHash), 32);
  w.fixed(hx(log.blockHash), 32);
  w.u64(log.blockNumber);
  w.fixed(hx(log.address), 20);
  w.string(log.data);
  w.u32(log.topics.length);
  for (const t of log.topics) w.fixed(hx(t), 32);
}

export function encodeSvmAccount(w: BorshWriter, acc: SvmAccountValue) {
  w.u8(VALUE_VARIANT.Svm);
  w.u8(1); // SvmExtractedValue::AccountState
  w.fixed(hx(acc.ownerHex), 32);
  w.bytes(hx(acc.dataHex));
}

/** One value per extractor, in request order. */
export function payloadBytes(req: ForeignRequest, values: EvmLogValue | SvmAccountValue | (EvmLogValue | SvmAccountValue)[]): Uint8Array {
  const vs = Array.isArray(values) ? values : [values];
  const w = new BorshWriter();
  w.u8(0); // ForeignTxSignPayload::V1
  encodeRequest(w, req);
  w.u32(vs.length); // values: Vec<ExtractedValue>
  for (const v of vs) {
    if (req.chain === "Base") encodeEvmLog(w, v as EvmLogValue);
    else encodeSvmAccount(w, v as SvmAccountValue);
  }
  return w.toBytes();
}

export function expectedPayloadHash(req: ForeignRequest, values: EvmLogValue | SvmAccountValue | (EvmLogValue | SvmAccountValue)[]): string {
  return bytesToHex(sha256(payloadBytes(req, values)));
}

/** JSON args for `verify_foreign_transaction` on the MPC signer contract. */
export function verifyArgs(req: ForeignRequest, expectedHash?: string, domainId = 3) {
  const request =
    req.chain === "Base"
      ? {
          Base: {
            tx_id: strip0x(req.txHash).toLowerCase(),
            extractors: [{ Log: { log_index: req.logIndex } }],
            finality: req.finality,
          },
        }
      : {
          Solana: {
            tx_id: req.txSignatureHex.toLowerCase(),
            finality: req.finality,
            extractors: req.accountsHex.map((a) => ({ AccountState: { pubkey: a.toLowerCase() } })),
          },
        };
  return {
    request: {
      request,
      domain_id: domainId,
      payload_version: 1,
      ...(expectedHash ? { expected_payload_hash: expectedHash } : {}),
    },
  };
}

/** ERC-20 Transfer(address,address,uint256) topic0 */
export const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** Parse a Transfer log into (from, to, amount). Throws on anything else. */
export function parseErc20Transfer(log: EvmLogValue): { token: string; from: string; to: string; amount: bigint } {
  if (log.topics.length !== 3 || log.topics[0].toLowerCase() !== ERC20_TRANSFER_TOPIC) {
    throw new Error("Not an ERC-20 Transfer log");
  }
  const addr = (topic: string) => `0x${strip0x(topic).slice(24).toLowerCase()}`;
  return {
    token: log.address.toLowerCase(),
    from: addr(log.topics[1]),
    to: addr(log.topics[2]),
    amount: BigInt(log.data === "0x" ? 0 : log.data),
  };
}

/** Parse an SPL Token / Token-2022 account's base layout (first 165 bytes). */
export function parseSplTokenAccount(dataHex: string): { mint: string; owner: string; amount: bigint; state: number } {
  const d = hx(dataHex);
  if (d.length < 165) throw new Error("Not an SPL token account");
  const mint = bytesToHex(d.slice(0, 32));
  const owner = bytesToHex(d.slice(32, 64));
  let amount = 0n;
  for (let i = 7; i >= 0; i--) amount = (amount << 8n) | BigInt(d[64 + i]);
  const state = d[108];
  return { mint, owner, amount, state };
}
