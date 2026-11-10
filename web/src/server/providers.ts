/**
 * Market-data providers (server-side). Each returns normalised, sourced data.
 *
 *  DexScreener   pairs, liquidity, volume, txns          300 req/min, 30 tokens/call
 *  Jupiter v2    Solana: holders, unique traders, audit  0.5 rps keyless, 100 mints/call
 *  GeckoTerminal daily OHLCV history (ATH, decay)        ~5 req/min keyless, ~6-12 months
 *  Blockscout    Base: wallet ERC-20 balances, holders   no key
 *  RugCheck      Solana safety                           no key
 *  honeypot.is   Base safety (tax / honeypot sim)        no key
 */
import type { ChainId } from "@/core/chains";
import { CHAINS } from "@/core/chains";
import type { Candle, SafetyFlag, SafetyReport, Sourced, TokenProfile, VitalSigns } from "@/core/vitals";
import { cached, getJson, rpc, throttle } from "./http";

const now = () => Date.now();
const s = <T>(value: T, source: Sourced<T>["source"], observedAt = now()): Sourced<T> => ({ value, source, observedAt });

// ---------------------------------------------------------------- DexScreener

export interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  labels?: string[];
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  txns?: { h24?: { buys: number; sells: number }; h6?: { buys: number; sells: number } };
  priceChange?: { h24?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string; websites?: { url: string; label?: string }[]; socials?: { url: string; type: string }[] };
}

export async function dexPairsForTokens(chain: ChainId, addresses: string[]): Promise<Map<string, DexPair[]>> {
  const slug = CHAINS[chain].dexscreener;
  const out = new Map<string, DexPair[]>();
  if (!slug || addresses.length === 0) return out;
  for (let i = 0; i < addresses.length; i += 30) {
    const batch = addresses.slice(i, i + 30);
    const pairs = await cached(`dex:${chain}:${batch.join(",")}`, 30_000, () =>
      getJson<DexPair[]>("dexscreener", `https://api.dexscreener.com/tokens/v1/${slug}/${batch.join(",")}`),
    );
    for (const p of pairs ?? []) {
      const key = chain === "base" ? p.baseToken.address.toLowerCase() : p.baseToken.address;
      if (!batch.some((a) => (chain === "base" ? a.toLowerCase() : a) === key)) continue;
      const list = out.get(key) ?? [];
      list.push(p);
      out.set(key, list);
    }
  }
  return out;
}

export async function dexSearch(query: string): Promise<DexPair[]> {
  const q = encodeURIComponent(query.trim());
  const res = await cached(`dexsearch:${q}`, 60_000, () =>
    getJson<{ pairs: DexPair[] }>("dexscreener", `https://api.dexscreener.com/latest/dex/search?q=${q}`),
  );
  return (res.pairs ?? []).filter((p) => p.chainId === "solana" || p.chainId === "base");
}

export function summarisePairs(pairs: DexPair[]) {
  const sorted = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const top = sorted[0];
  const liq = sorted.reduce((t, p) => t + (p.liquidity?.usd ?? 0), 0);
  const vol = sorted.reduce((t, p) => t + (p.volume?.h24 ?? 0), 0);
  const trades = sorted.reduce((t, p) => t + (p.txns?.h24 ? p.txns.h24.buys + p.txns.h24.sells : 0), 0);
  const created = sorted.reduce<number | undefined>(
    (m, p) => (p.pairCreatedAt && (!m || p.pairCreatedAt < m) ? p.pairCreatedAt : m),
    undefined,
  );
  const bondingOnly = sorted.length > 0 && sorted.every((p) => p.dexId === "pumpfun" || p.dexId === "moonshot");
  return { top, liq, vol, trades, created, bondingOnly, count: sorted.length };
}

// ---------------------------------------------------------------- Jupiter (Solana)

export interface JupToken {
  id: string;
  name: string;
  symbol: string;
  icon?: string;
  decimals: number;
  tokenProgram?: string;
  holderCount?: number;
  usdPrice?: number;
  liquidity?: number;
  mcap?: number;
  fdv?: number;
  createdAt?: string;
  firstPool?: { id: string; createdAt: string };
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number };
  organicScore?: number;
  organicScoreLabel?: string;
  stats24h?: {
    numTraders?: number;
    numBuys?: number;
    numSells?: number;
    buyVolume?: number;
    sellVolume?: number;
    buyOrganicVolume?: number;
    sellOrganicVolume?: number;
    holderChange?: number;
  };
}

export async function jupiterTokens(mints: string[]): Promise<Map<string, JupToken>> {
  const out = new Map<string, JupToken>();
  for (let i = 0; i < mints.length; i += 100) {
    const batch = mints.slice(i, i + 100);
    const list = await cached(`jup:${batch.join(",")}`, 60_000, async () => {
      await throttle("jupiter", 30);
      return getJson<JupToken[]>("jupiter", `https://lite-api.jup.ag/tokens/v2/search?query=${batch.join(",")}`);
    });
    for (const t of list ?? []) out.set(t.id, t);
  }
  return out;
}

// ---------------------------------------------------------------- GeckoTerminal history

export async function dailyHistory(chain: ChainId, pool: string): Promise<Candle[]> {
  const net = CHAINS[chain].geckoterminal;
  if (!net) return [];
  return cached(`gt:${chain}:${pool}`, 6 * 3_600_000, async () => {
    await throttle("geckoterminal", 4, 20_000);
    const res = await getJson<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(
      "geckoterminal",
      `https://api.geckoterminal.com/api/v2/networks/${net}/pools/${pool}/ohlcv/day?limit=1000&currency=usd`,
      { revalidate: 21_600, timeoutMs: 12_000 },
    );
    const list = res.data?.attributes?.ohlcv_list ?? [];
    const byDay = new Map<number, Candle>();
    for (const [t, o, h, l, c, v] of list) {
      if (!Number.isFinite(c)) continue;
      const day = Math.floor(t / 86_400) * 86_400;
      const prev = byDay.get(day);
      // providers occasionally return the same day twice; merge volumes, keep the latest close
      byDay.set(day, prev ? { ...prev, h: Math.max(prev.h, h), l: Math.min(prev.l, l), c, v: prev.v + v } : { t: day, o, h, l, c, v });
    }
    return [...byDay.values()].sort((a, b) => a.t - b.t);
  });
}

// ---------------------------------------------------------------- Safety

interface RugSummary {
  score?: number;
  risks?: { name: string; description: string; level: string }[];
  tokenProgram?: string;
}

export async function solanaSafety(mint: string, jup?: JupToken): Promise<SafetyReport> {
  const flags: SafetyFlag[] = [];
  const sources: SafetyReport["source"] = [];
  if (jup?.audit) {
    sources.push("jupiter");
    if (jup.audit.freezeAuthorityDisabled === false)
      flags.push({ code: "FREEZE_AUTHORITY", severity: "ineligible", detail: "The issuer can still freeze token accounts, including a grave." });
    if (jup.audit.mintAuthorityDisabled === false)
      flags.push({ code: "MINT_AUTHORITY", severity: "warning", detail: "The issuer can still mint new supply." });
  }
  try {
    const r = await cached(`rug:${mint}`, 3_600_000, () =>
      getJson<RugSummary>("rugcheck", `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, { timeoutMs: 7_000 }),
    );
    sources.push("rugcheck");
    for (const risk of r.risks ?? []) {
      const n = risk.name.toLowerCase();
      if (n.includes("permanent delegate"))
        flags.push({ code: "PERMANENT_DELEGATE", severity: "ineligible", detail: "A permanent delegate can move tokens out of any account." });
      else if (n.includes("transfer hook"))
        flags.push({ code: "TRANSFER_HOOK", severity: "ineligible", detail: "Custom code runs on every transfer." });
      else if (n.includes("transfer fee"))
        flags.push({ code: "TRANSFER_FEE", severity: "ineligible", detail: "Transfers are taxed, which breaks grave accounting." });
      else if (n.includes("freeze") && !flags.some((f) => f.code === "FREEZE_AUTHORITY"))
        flags.push({ code: "FREEZE_AUTHORITY", severity: "ineligible", detail: risk.description });
    }
  } catch {
    // RugCheck is a second opinion; Jupiter audit still applies.
  }
  return { flags, source: sources, observedAt: now() };
}

interface HoneypotRes {
  honeypotResult?: { isHoneypot?: boolean };
  simulationResult?: { buyTax?: number; sellTax?: number; transferTax?: number };
  contractCode?: { openSource?: boolean; isProxy?: boolean };
}

export async function baseSafety(token: string): Promise<SafetyReport> {
  const flags: SafetyFlag[] = [];
  try {
    const r = await cached(`hp:${token}`, 3_600_000, () =>
      getJson<HoneypotRes>("honeypot", `https://api.honeypot.is/v2/IsHoneypot?address=${token}&chainID=8453`, {
        timeoutMs: 8_000,
      }),
    );
    if (r.honeypotResult?.isHoneypot)
      flags.push({ code: "HONEYPOT", severity: "ineligible", detail: "A simulated sell fails: holders cannot exit." });
    const tax = Math.max(r.simulationResult?.transferTax ?? 0, 0);
    if (tax > 0)
      flags.push({ code: "TRANSFER_TAX", severity: "ineligible", detail: `Transfers are taxed ${tax.toFixed(1)}%.` });
    if (r.contractCode?.isProxy)
      flags.push({ code: "UPGRADEABLE_PROXY", severity: "warning", detail: "The token contract is upgradeable." });
    if (r.contractCode?.openSource === false)
      flags.push({ code: "UNVERIFIED_CONTRACT", severity: "warning", detail: "Source code is not verified." });
    return { flags, source: ["honeypot"], observedAt: now() };
  } catch {
    return { flags, source: [], observedAt: now() };
  }
}

// ---------------------------------------------------------------- Balances

export interface Holding {
  address: string;
  amountRaw: string;
  decimals: number;
  uiAmount: number;
  tokenProgram?: string;
  name?: string;
  symbol?: string;
  icon?: string;
}

const SOL_RPC = {
  sol: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  "sol-devnet": process.env.SOLANA_DEVNET_RPC_URL || "https://api.devnet.solana.com",
} as const;

export function solanaRpcUrl(chain: "sol" | "sol-devnet") {
  return SOL_RPC[chain];
}

interface JupHoldings {
  tokens?: Record<string, { account: string; amount: string; uiAmount: number; decimals: number; programId: string }[]>;
}

/** Mainnet fallback when the public RPC rate-limits us: Jupiter's holdings endpoint. */
async function jupiterHoldings(owner: string): Promise<Holding[]> {
  const res = await cached(`jupbal:${owner}`, 20_000, async () => {
    await throttle("jupiter", 30);
    return getJson<JupHoldings>("jupiter", `https://lite-api.jup.ag/ultra/v1/holdings/${owner}`);
  });
  const out: Holding[] = [];
  for (const [mint, accts] of Object.entries(res.tokens ?? {})) {
    const raw = accts.reduce((s, a) => s + BigInt(a.amount), 0n);
    if (raw === 0n) continue;
    out.push({
      address: mint,
      amountRaw: raw.toString(),
      decimals: accts[0].decimals,
      uiAmount: accts.reduce((s, a) => s + a.uiAmount, 0),
      tokenProgram: accts[0].programId,
    });
  }
  return out;
}

export async function solanaHoldings(chain: "sol" | "sol-devnet", owner: string): Promise<Holding[]> {
  try {
    return await solanaHoldingsRpc(chain, owner);
  } catch (e) {
    if (chain !== "sol") throw e;
    return jupiterHoldings(owner);
  }
}

async function solanaHoldingsRpc(chain: "sol" | "sol-devnet", owner: string): Promise<Holding[]> {
  const url = SOL_RPC[chain];
  const programs = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
  type Acc = {
    account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number; uiAmount: number } } } } };
  };
  const all: Holding[] = [];
  for (const programId of programs) {
    const res = await cached(`solbal:${chain}:${owner}:${programId}`, 20_000, () =>
      rpc<{ value: Acc[] }>("solana-rpc", url, "getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed" }]),
    );
    for (const a of res.value) {
      const info = a.account.data.parsed.info;
      if (info.tokenAmount.amount === "0") continue;
      all.push({
        address: info.mint,
        amountRaw: info.tokenAmount.amount,
        decimals: info.tokenAmount.decimals,
        uiAmount: info.tokenAmount.uiAmount,
        tokenProgram: programId,
      });
    }
  }
  // merge duplicates (multiple token accounts for one mint)
  const merged = new Map<string, Holding>();
  for (const h of all) {
    const prev = merged.get(h.address);
    if (prev) {
      prev.amountRaw = (BigInt(prev.amountRaw) + BigInt(h.amountRaw)).toString();
      prev.uiAmount += h.uiAmount;
    } else merged.set(h.address, { ...h });
  }
  return [...merged.values()];
}

interface BlockscoutTokenItem {
  value: string;
  token: {
    address_hash: string;
    name?: string;
    symbol?: string;
    decimals?: string;
    icon_url?: string | null;
    type: string;
    holders_count?: string;
  };
}

/**
 * Base balances: keyless Blockscout first; if Cloudflare challenges us, fall
 * back to Blockscout PRO or Alchemy when a (free-tier) key is configured.
 */
export async function baseHoldings(chain: "base" | "base-sepolia", owner: string): Promise<Holding[]> {
  try {
    return await blockscoutHoldings(chain, owner);
  } catch (e) {
    if (process.env.BLOCKSCOUT_API_KEY) {
      try {
        return await blockscoutHoldings(chain, owner, process.env.BLOCKSCOUT_API_KEY);
      } catch {
        /* fall through */
      }
    }
    if (process.env.ALCHEMY_API_KEY) return alchemyHoldings(chain, owner, process.env.ALCHEMY_API_KEY);
    throw e;
  }
}

async function alchemyHoldings(chain: "base" | "base-sepolia", owner: string, key: string): Promise<Holding[]> {
  const url = `https://${chain === "base" ? "base-mainnet" : "base-sepolia"}.g.alchemy.com/v2/${key}`;
  const bal = await cached(`alc:${chain}:${owner}`, 30_000, () =>
    rpc<{ tokenBalances: { contractAddress: string; tokenBalance: string }[] }>("alchemy", url, "alchemy_getTokenBalances", [owner, "erc20"]),
  );
  const nonzero = bal.tokenBalances.filter((b) => b.tokenBalance && BigInt(b.tokenBalance) > 0n).slice(0, 80);
  const metas = await Promise.all(
    nonzero.map((b) =>
      cached(`alcmeta:${chain}:${b.contractAddress}`, 86_400_000, () =>
        rpc<{ name?: string; symbol?: string; decimals?: number; logo?: string }>("alchemy", url, "alchemy_getTokenMetadata", [b.contractAddress]),
      ).catch(() => ({}) as { name?: string; symbol?: string; decimals?: number; logo?: string }),
    ),
  );
  return nonzero.map((b, i) => {
    const m = metas[i];
    const decimals = m.decimals ?? 18;
    const raw = BigInt(b.tokenBalance);
    return {
      address: b.contractAddress.toLowerCase(),
      amountRaw: raw.toString(),
      decimals,
      uiAmount: Number(raw) / 10 ** decimals,
      name: m.name,
      symbol: m.symbol,
      icon: m.logo ?? undefined,
    };
  });
}

async function blockscoutHoldings(chain: "base" | "base-sepolia", owner: string, proKey?: string): Promise<Holding[]> {
  const host = proKey
    ? `api.blockscout.com/${chain === "base" ? "8453" : "84532"}`
    : chain === "base"
      ? "base.blockscout.com"
      : "base-sepolia.blockscout.com";
  const out: Holding[] = [];
  type Page = { items: BlockscoutTokenItem[]; next_page_params: Record<string, string> | null };
  let next: Record<string, string> | null = null;
  for (let page = 0; page < 4; page++) {
    const qs: URLSearchParams = new URLSearchParams({ type: "ERC-20", ...(next ?? {}), ...(proKey ? { apikey: proKey } : {}) });
    const res: Page = await cached<Page>(`bs:${chain}:${owner}:${qs}`, 30_000, () =>
      getJson<Page>(
        "blockscout",
        `https://${host}/api/v2/addresses/${owner}/tokens?${qs}`,
      ),
    );
    for (const it of res.items) {
      if (it.token.type !== "ERC-20" || it.value === "0") continue;
      const decimals = Number(it.token.decimals ?? 18);
      out.push({
        address: it.token.address_hash.toLowerCase(),
        amountRaw: it.value,
        decimals,
        uiAmount: Number(BigInt(it.value)) / 10 ** decimals,
        name: it.token.name,
        symbol: it.token.symbol,
        icon: it.token.icon_url ?? undefined,
      });
    }
    next = res.next_page_params;
    if (!next) break;
  }
  return out;
}

// ---------------------------------------------------------------- Assembly helpers

export function profileFromPairs(chain: ChainId, address: string, pairs: DexPair[], jup?: JupToken): TokenProfile {
  const sum = summarisePairs(pairs);
  return {
    ref: { chain, address },
    name: jup?.name ?? sum.top?.baseToken.name ?? "Unknown token",
    symbol: jup?.symbol ?? sum.top?.baseToken.symbol ?? "???",
    decimals: jup?.decimals,
    imageUrl: jup?.icon ?? sum.top?.info?.imageUrl,
    primaryPool: sum.top ? { address: sum.top.pairAddress, dex: sum.top.dexId, quoteSymbol: sum.top.quoteToken.symbol } : undefined,
    bondingCurveOnly: sum.bondingOnly,
    createdAt: jup?.createdAt ? Date.parse(jup.createdAt) : sum.created,
    links: [
      ...(sum.top?.info?.websites ?? []).map((w) => ({ label: w.label ?? "Website", url: w.url })),
      ...(sum.top?.info?.socials ?? []).map((x) => ({ label: x.type, url: x.url })),
    ],
  };
}

export function vitalsFromPairs(pairs: DexPair[], jup?: JupToken): VitalSigns {
  const sum = summarisePairs(pairs);
  const v: VitalSigns = {};
  if (sum.count > 0) {
    v.liquidityUsd = s(sum.liq, "dexscreener");
    v.volume24hUsd = s(sum.vol, "dexscreener");
    v.trades24h = s(sum.trades, "dexscreener");
    v.poolCount = s(sum.count, "dexscreener");
    if (sum.top?.priceUsd) v.priceUsd = s(Number(sum.top.priceUsd), "dexscreener");
    if (sum.top?.marketCap ?? sum.top?.fdv) v.marketCapUsd = s((sum.top.marketCap ?? sum.top.fdv) as number, "dexscreener");
    if (sum.top?.fdv) v.fdvUsd = s(sum.top.fdv, "dexscreener");
  }
  if (jup) {
    if (jup.holderCount !== undefined) v.holderCount = s(jup.holderCount, "jupiter");
    if (jup.stats24h?.numTraders !== undefined) v.traders24h = s(jup.stats24h.numTraders, "jupiter");
    const total = (jup.stats24h?.buyVolume ?? 0) + (jup.stats24h?.sellVolume ?? 0);
    const organic = (jup.stats24h?.buyOrganicVolume ?? 0) + (jup.stats24h?.sellOrganicVolume ?? 0);
    if (total > 0) v.flaggedVolumeShare24h = s(Math.max(0, Math.min(1, 1 - organic / total)), "jupiter");
    if (sum.count === 0) {
      if (jup.liquidity !== undefined) v.liquidityUsd = s(jup.liquidity, "jupiter");
      if (jup.usdPrice !== undefined) v.priceUsd = s(jup.usdPrice, "jupiter");
      if (jup.mcap !== undefined) v.marketCapUsd = s(jup.mcap, "jupiter");
    }
  }
  return v;
}
