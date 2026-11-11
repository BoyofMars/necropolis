/**
 * NEAR read access (browser + server). Plain JSON-RPC, no wallet needed:
 * the grave registry is public state anyone can read and verify.
 */
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "necropolis.testnet";
export const MPC_SIGNER = process.env.NEXT_PUBLIC_MPC_SIGNER ?? (NETWORK === "mainnet" ? "v1.signer" : "v1.signer-prod.testnet");
export const NEAR_RPC =
  process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? (NETWORK === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");
export const NEAR_EXPLORER =
  NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

export const nearTxUrl = (hash: string) => `${NEAR_EXPLORER}/txns/${hash}`;
export const nearAccountUrl = (id: string) => `${NEAR_EXPLORER}/address/${id}`;

function b64(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "utf8").toString("base64");
  return btoa(unescape(encodeURIComponent(s)));
}

function decodeBytes(bytes: number[]): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("utf8");
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

export class NearViewError extends Error {}

export async function nearView<T>(
  method: string,
  args: Record<string, unknown> = {},
  contract = CONTRACT_ID,
  init?: { revalidate?: number },
): Promise<T> {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "necropolis",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: contract,
        method_name: method,
        args_base64: b64(JSON.stringify(args)),
      },
    }),
    ...(init?.revalidate !== undefined ? { next: { revalidate: init.revalidate } } : { cache: "no-store" }),
  });
  if (!res.ok) throw new NearViewError(`NEAR RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: { message?: string; data?: string } };
  if (body.error) throw new NearViewError(body.error.data ?? body.error.message ?? "NEAR RPC error");
  if (body.result?.error) throw new NearViewError(body.result.error);
  return JSON.parse(decodeBytes(body.result?.result ?? [])) as T;
}

/** Public key derived for (predecessor, path) by the MPC network. */
export async function derivedPublicKey(path: string, domainId: 0 | 1, predecessor = CONTRACT_ID): Promise<string> {
  return nearView<string>("derived_public_key", { path, predecessor, domain_id: domainId }, MPC_SIGNER, { revalidate: 86_400 });
}

// ---------------------------------------------------------------- contract types (JSON)

export type U64 = string;
export type U128 = string;
export type ContractChain = "sol" | "base" | "sol-devnet" | "base-sepolia";

export type PlotStateJson =
  | { kind: "RESTING"; false_dawns: number; last_observed_at: U64 | null }
  | { kind: "STIRRING"; since: U64; last_at: U64; count: number; false_dawns: number }
  | { kind: "RISEN"; at: U64; false_dawns: number; event_id: number };

export interface TermsJson {
  min_liquidity_usd: U64;
  min_volume_24h_usd: U64;
  min_peak_volume_share_bps: number;
  min_traders_24h: number;
  max_volume_to_liquidity_x100: number;
  min_mcap_multiple_x100: number;
  min_mcap_usd: U64;
  max_flagged_share_bps: number;
  min_sources: number;
  window_secs: U64;
  max_gap_secs: U64;
  min_observations: number;
}

export interface ObservationJson {
  t: U64;
  price_usd_e18: U128;
  market_cap_usd: U64;
  liquidity_usd: U64;
  volume_24h_usd: U64;
  traders_24h: number;
  flagged_share_bps: number;
  sources: number;
}

export interface PlotJson {
  id: string;
  chain: ContractChain;
  token: string;
  symbol: string;
  name: string;
  decimals: number;
  image: string | null;
  terms: TermsJson;
  baseline_mcap_usd: U64;
  peak_daily_volume_usd: U64;
  weight_cap_usd_e6: U64;
  opened_at: U64;
  state: PlotStateJson;
  grave_count: number;
  total_amount: U128;
  total_tithe: U128;
  total_weight_usd_e6: U64;
  observations: number;
  last_observation: ObservationJson | null;
}

export interface GraveJson {
  id: number;
  plot_id: string;
  chain: ContractChain;
  token: string;
  owner_id: string;
  origin_owner: string;
  path: string;
  grave_address: string;
  token_account: string | null;
  token_program: string | null;
  decimals: number;
  amount: U128;
  tithe: U128;
  value_usd_e6: U64;
  weight_usd_e6: U64;
  death_score: number;
  epitaph: string | null;
  buried_at: U64;
  deposit_tx: string;
  deposit_log_index: U64 | null;
  proof_hash: string;
  payout_to: string | null;
  raised: boolean;
}

export interface EventJson {
  id: number;
  plot_id: string;
  chain: ContractChain;
  token: string;
  at: U64;
  pool_amount: U128;
  upkeep_amount: U128;
  pool_weight_usd_e6: U128;
  decimals: number;
  symbol: string;
}

export interface StatsJson {
  graves: number;
  plots: number;
  events: number;
  total_active_weight_usd_e6: U128;
  total_value_buried_usd_e6: U128;
  bones_supply?: U128;
}

export interface SignedPayoutJson {
  kind: string;
  chain: ContractChain;
  unsigned: string[];
  signatures: string[];
  requested_at: U64;
  signed_at: U64 | null;
  recipient: string;
  amounts: U128[];
  path: string;
}

export interface ShareJson {
  grave_id: number;
  event_id: number;
  amount: U128 | null;
  eligible: boolean;
  reason: string | null;
  claimed: boolean;
}

/** $BONES (NEP-141 on the registry contract): 6 decimals, 1 BONES = $1 of ossuary weight. */
export const BONES_DECIMALS = 6;

/** "12.5" BONES in base units, or null for anything that isn't a positive amount. */
export function parseBones(v: string): string | null {
  const m = v.trim().match(/^(\d+)(?:\.(\d{0,6}))?$/);
  if (!m) return null;
  const base = BigInt(m[1]) * 10n ** 6n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
  return base > 0n ? base.toString() : null;
}

/** Base units as a readable BONES amount. */
export const formatBones = (raw: string | bigint) => (Number(raw) / 10 ** BONES_DECIMALS).toLocaleString(undefined, { maximumFractionDigits: 2 });

export interface BonesShareJson {
  event_id: number;
  holder: string;
  balance_at_rising: U128;
  supply_at_rising: U128 | null;
  amount: U128 | null;
  eligible: boolean;
  reason: string | null;
  claimed: boolean;
}

export interface GraveBonesJson {
  minted_to: string;
  amount: U128;
  burned: U128;
  settled: boolean;
}

/** One line of a grave's on-chain history. */
export interface GraveEventJson {
  at: U64;
  kind: "buried" | "bones_minted" | "earned" | "raised" | "bones_burned" | "bones_exhumed" | "transferred" | "epitaph" | string;
  account: string | null;
  amount: U128 | null;
  symbol: string | null;
  note: string | null;
}

/** $BONES as the contract runs it. `setters` is empty: nothing here can change. */
export interface BonesRulesJson {
  symbol: string;
  decimals: number;
  bones_per_usd_of_weight: U128;
  tithe_bps: number;
  upkeep_bps: number;
  min_death_score: number;
  genesis_event: number | null;
  total_supply: U128;
  mints_and_burns: U64;
  rules: string[];
  setters: string[];
}

/** One mint or burn, in order. */
export interface BonesLogJson {
  i: U64;
  at: U64;
  kind: "mint" | "burn";
  account: string;
  amount: U128;
  supply_after: U128;
  grave_id: U64;
  note: string;
}

/** A plot's market, fixed by its first MPC-verified reading. */
export interface PoolBindingJson {
  pool: string;
  program: string;
  token_vault: string;
  quote_vault: string;
  quote_mint: string;
  bound_at: U64;
}

/** The latest market reading the NEAR MPC network confirmed for a plot. */
export interface MarketReadingJson {
  liquidity_usd: U64;
  price_usd_e18: U128;
  market_cap_usd: U64;
  token_reserve: U64;
  quote_reserve: U64;
  supply: U64;
  anchor_tx: string;
  proof_hash: string;
  at: U64;
}

export const registry = {
  stats: () => nearView<StatsJson>("get_stats"),
  plots: (from = 0, limit = 100) => nearView<PlotJson[]>("get_plots", { from_index: from, limit }),
  plot: (plotId: string) => nearView<PlotJson | null>("get_plot", { plot_id: plotId }),
  grave: (id: number) => nearView<GraveJson | null>("get_grave", { grave_id: id }),
  graves: (from = 0, limit = 50, newestFirst = true) =>
    nearView<GraveJson[]>("get_graves", { from_index: from, limit, newest_first: newestFirst }),
  gravesByOwner: (owner: string) => nearView<GraveJson[]>("get_graves_by_owner", { owner_id: owner }),
  gravesByPlot: (plotId: string) => nearView<GraveJson[]>("get_graves_by_plot", { plot_id: plotId, limit: 100 }),
  events: () => nearView<EventJson[]>("get_events"),
  share: (graveId: number, eventId: number) => nearView<ShareJson | null>("get_share", { grave_id: graveId, event_id: eventId }),
  payout: (key: string) => nearView<SignedPayoutJson | null>("get_payout", { key }),
  ossuary: (chain: ContractChain) => nearView<string | null>("get_ossuary", { chain }),
  nonce: (owner: string) => nearView<U64>("get_nonce", { owner_id: owner }),
  graveIdForPath: (path: string) => nearView<number | null>("grave_id_for_path", { path }),
  config: () => nearView<Record<string, unknown>>("get_config"),
  bonesBalance: (account: string) => nearView<U128>("ft_balance_of", { account_id: account }),
  bonesSupply: () => nearView<U128>("ft_total_supply"),
  bonesGenesis: () => nearView<number | null>("get_bones_genesis"),
  bonesShare: (eventId: number, holder: string) => nearView<BonesShareJson | null>("get_bones_share", { event_id: eventId, holder }),
  graveBones: (graveId: number) => nearView<GraveBonesJson | null>("get_grave_bones", { grave_id: graveId }),
  candles: (graveIds: number[]) => nearView<U64[]>("get_candles", { grave_ids: graveIds }),
  hasLit: (graveId: number, mourner: string) => nearView<boolean>("has_lit_candle", { grave_id: graveId, mourner }),
  mostMourned: (limit = 10) => nearView<[number, U64][]>("get_most_mourned", { limit }),
  candleTotal: () => nearView<U64>("get_candle_total"),
  poolBinding: (plotId: string) => nearView<PoolBindingJson | null>("get_pool_binding", { plot_id: plotId }),
  marketReading: (plotId: string) => nearView<MarketReadingJson | null>("get_market_reading", { plot_id: plotId }),
  graveHistory: (graveId: number) => nearView<GraveEventJson[]>("get_grave_history", { grave_id: graveId }),
  bonesRules: () => nearView<BonesRulesJson>("get_bones_rules"),
  bonesLog: (from = 0, limit = 100) => nearView<BonesLogJson[]>("get_bones_log", { from_index: String(from), limit }),
};

/** The keyless NEAR account a grave NFT controls. Mirrors `accounts::grave_account`. */
export const graveAccountId = (graveId: number) => `g${graveId}.${CONTRACT_ID}`;

/** The grave behind a grave account, or null. Mirrors `accounts::grave_id_of`. */
export function graveIdOfAccount(account: string): number | null {
  const m = account.match(/^g(0|[1-9]\d{0,11})\.(.+)$/);
  return m && m[2] === CONTRACT_ID ? Number(m[1]) : null;
}

/** How many access keys an account has. A grave account has none: nobody can sign for it. */
export async function accessKeyCount(accountId: string): Promise<number | null> {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "keys", method: "query", params: { request_type: "view_access_key_list", finality: "final", account_id: accountId } }),
    cache: "no-store",
  });
  const body = (await res.json()) as { result?: { keys?: unknown[] }; error?: unknown };
  return body.result?.keys ? body.result.keys.length : null;
}

/** Same format as the contract's `grave_path`. */
export function gravePath(chain: ContractChain, token: string, originOwner: string, nonce: number): string {
  return `bag/v1/${chain}/${token}/${originOwner}/${nonce}`;
}

export function ossuaryPath(chain: ContractChain): string {
  return `ossuary/v1/${chain}`;
}

export function plotId(chain: ContractChain, token: string): string {
  return `${chain}:${token}`;
}

/** Same format as the contract's `auth::action_message`. */
export function actionMessage(action: string, graveId: number, fields: [string, string][], nonce: number): string {
  let m = `Necropolis v1\ncontract: ${CONTRACT_ID}\naction: ${action}\ngrave: ${graveId}\n`;
  for (const [k, v] of fields) m += `${k}: ${v}\n`;
  return m + `nonce: ${nonce}`;
}

/** Account-level action (no grave line), e.g. a $BONES transfer. Mirrors `auth::account_message`. */
export function accountMessage(action: string, fields: [string, string][], nonce: number): string {
  let m = `Necropolis v1\ncontract: ${CONTRACT_ID}\naction: ${action}\n`;
  for (const [k, v] of fields) m += `${k}: ${v}\n`;
  return m + `nonce: ${nonce}`;
}

/** What a wallet signs to move $BONES. `amount` is in base units (6 decimals). */
export function bonesTransferMessage(receiver: string, amount: string, nonce: number): string {
  return accountMessage("transfer_bones", [["receiver", receiver], ["amount", amount]], nonce);
}

/**
 * What a holder signs to open a grave's crypt. Off-chain and time-boxed (no
 * nonce is spent): the server checks it against the grave's owner *now*.
 */
export function cryptMessage(graveId: number, issued: number): string {
  return `Necropolis v1\ncontract: ${CONTRACT_ID}\naction: open_crypt\ngrave: ${graveId}\nissued: ${issued}`;
}

/** What a mourner signs to light a candle (one per wallet per grave, so nonce 0). */
export function candleMessage(graveId: number, mourner: string): string {
  return actionMessage("light_candle", graveId, [["mourner", mourner]], 0);
}
