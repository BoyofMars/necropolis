/**
 * Vital signs: the raw, sourced measurements every classification is built on.
 * Every number carries provenance so the UI can show where it came from and
 * how fresh it is. Nothing downstream is allowed to invent a value.
 */
import type { TokenRef } from "./chains";

export type DataSource =
  | "dexscreener"
  | "geckoterminal"
  | "jupiter"
  | "blockscout"
  | "rugcheck"
  | "honeypot"
  | "goplus"
  | "solana-rpc"
  | "evm-rpc"
  | "simulated";

export interface Sourced<T> {
  value: T;
  source: DataSource;
  /** unix ms when the provider produced / we fetched the value */
  observedAt: number;
}

/** One daily candle, USD-denominated. `t` is the unix seconds of the day open. */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** volume in USD */
  v: number;
}

export interface TokenProfile {
  ref: TokenRef;
  name: string;
  symbol: string;
  decimals?: number;
  imageUrl?: string;
  /** Primary market (highest-liquidity pool) */
  primaryPool?: { address: string; dex: string; quoteSymbol?: string };
  /** True if the token only trades on a launchpad bonding curve (never graduated) */
  bondingCurveOnly?: boolean;
  createdAt?: number;
  links?: { label: string; url: string }[];
}

export interface VitalSigns {
  priceUsd?: Sourced<number>;
  marketCapUsd?: Sourced<number>;
  fdvUsd?: Sourced<number>;
  /** Sum of liquidity across indexed pools */
  liquidityUsd?: Sourced<number>;
  volume24hUsd?: Sourced<number>;
  /** buys + sells over 24h */
  trades24h?: Sourced<number>;
  /** unique traders over 24h, if the provider reports it */
  traders24h?: Sourced<number>;
  /** Volume flagged as non-organic (wash / bot) over 24h, 0..1, if known */
  flaggedVolumeShare24h?: Sourced<number>;
  holderCount?: Sourced<number>;
  poolCount?: Sourced<number>;
}

export interface SafetyReport {
  /** Ineligible flags make a token un-buriable (custody risk). */
  flags: SafetyFlag[];
  source: DataSource[];
  observedAt: number;
}

export type SafetyFlagCode =
  | "FREEZE_AUTHORITY"
  | "MINT_AUTHORITY"
  | "PERMANENT_DELEGATE"
  | "TRANSFER_HOOK"
  | "TRANSFER_FEE"
  | "NON_TRANSFERABLE"
  | "DEFAULT_FROZEN"
  | "PAUSABLE"
  | "HONEYPOT"
  | "TRANSFER_TAX"
  | "BLACKLIST"
  | "OWNER_CAN_CHANGE_BALANCE"
  | "UPGRADEABLE_PROXY"
  | "HIDDEN_OWNER"
  | "UNVERIFIED_CONTRACT";

export interface SafetyFlag {
  code: SafetyFlagCode;
  severity: "ineligible" | "warning";
  detail: string;
}

export interface TokenDossier {
  profile: TokenProfile;
  vitals: VitalSigns;
  /** Daily candles, ascending by time. May be empty if history is unavailable. */
  history: Candle[];
  historySource?: DataSource;
  safety?: SafetyReport;
  fetchedAt: number;
  /** Non-fatal problems while assembling the dossier (rate limits, missing data) */
  gaps: string[];
}

export function val<T>(s: Sourced<T> | undefined): T | undefined {
  return s?.value;
}
