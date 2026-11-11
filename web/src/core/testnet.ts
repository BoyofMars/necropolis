/**
 * The Proving Grounds: test bags on Solana devnet and Base Sepolia.
 *
 * Burials, MPC verification, grave NFTs and payouts on testnet are all real.
 * Only the *market* is simulated: devnet tokens have no DEX history, so each
 * test bag has a deterministic, labelled life story (launch → ATH → death),
 * and the testnet Séance feeds simulated recovery vitals to the coroner so the
 * resurrection rite can be demonstrated end-to-end on compressed timers.
 */
import type { ChainId } from "./chains";
import type { Candle, TokenDossier, VitalSigns } from "./vitals";
import deployed from "./testnet-addresses.json";

const DEPLOYED = deployed as Record<string, string>;

export type LifePattern = "rug" | "bleed" | "abandoned" | "flatline";

export interface TestBag {
  chain: ChainId;
  /** filled in by scripts/create-test-bags.ts */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  supply: number;
  pattern: LifePattern;
  launchedDaysAgo: number;
  athDay: number;
  athMcapUsd: number;
  deathDay: number;
  epitaphHint: string;
  /** amount the faucet gives each wallet (whole tokens) */
  faucetAmount: number;
}

const BAGS: TestBag[] = [
  {
    chain: "sol-devnet",
    address: "",
    symbol: "HOPIUM",
    name: "Hopium",
    decimals: 6,
    supply: 1_000_000_000,
    pattern: "bleed",
    launchedDaysAgo: 214,
    athDay: 9,
    athMcapUsd: 4_800_000,
    deathDay: 71,
    epitaphHint: "It was always two more weeks.",
    faucetAmount: 2_400_000,
  },
  {
    chain: "sol-devnet",
    address: "",
    symbol: "FUMBLE",
    name: "Fumble",
    decimals: 6,
    supply: 1_000_000_000,
    pattern: "rug",
    launchedDaysAgo: 131,
    athDay: 4,
    athMcapUsd: 1_900_000,
    deathDay: 5,
    epitaphHint: "Dev was a little guy. Then he wasn't.",
    faucetAmount: 9_100_000,
  },
  {
    chain: "sol-devnet",
    address: "",
    symbol: "COPIUM",
    name: "Copium",
    decimals: 6,
    supply: 690_000_000,
    pattern: "abandoned",
    launchedDaysAgo: 302,
    athDay: 22,
    athMcapUsd: 12_400_000,
    deathDay: 40,
    epitaphHint: "Inhaled deeply. Exhaled never.",
    faucetAmount: 1_300_000,
  },
  {
    chain: "sol-devnet",
    address: "",
    symbol: "NGMI",
    name: "Not Gonna Make It",
    decimals: 6,
    supply: 1_000_000_000,
    pattern: "flatline",
    launchedDaysAgo: 388,
    athDay: 2,
    athMcapUsd: 310_000,
    deathDay: 14,
    epitaphHint: "Said so on the tin.",
    faucetAmount: 40_000_000,
  },
  {
    chain: "sol-devnet",
    address: "",
    symbol: "LAZARUS",
    name: "Lazarus",
    decimals: 6,
    supply: 777_000_000,
    pattern: "abandoned",
    launchedDaysAgo: 160,
    athDay: 11,
    athMcapUsd: 2_600_000,
    deathDay: 48,
    epitaphHint: "Back by popular demand.",
    faucetAmount: 8_000_000,
  },
  {
    chain: "sol-devnet",
    address: "",
    symbol: "PHOENIX",
    name: "Phoenix",
    decimals: 6,
    supply: 900_000_000,
    pattern: "abandoned",
    launchedDaysAgo: 190,
    athDay: 15,
    athMcapUsd: 3_100_000,
    deathDay: 52,
    epitaphHint: "Ashes, mostly.",
    faucetAmount: 6_000_000,
  },
  {
    chain: "base-sepolia",
    address: "",
    symbol: "BASEDCOPE",
    name: "Based Cope",
    decimals: 18,
    supply: 1_000_000_000,
    pattern: "bleed",
    launchedDaysAgo: 176,
    athDay: 12,
    athMcapUsd: 2_700_000,
    deathDay: 63,
    epitaphHint: "Onchain summer. Offchain winter.",
    faucetAmount: 5_000_000,
  },
  {
    chain: "base-sepolia",
    address: "",
    symbol: "WENLAMBO",
    name: "Wen Lambo",
    decimals: 18,
    supply: 420_690_000,
    pattern: "rug",
    launchedDaysAgo: 98,
    athDay: 3,
    athMcapUsd: 880_000,
    deathDay: 4,
    epitaphHint: "Lambo was a rental.",
    faucetAmount: 3_000_000,
  },
];

/** Test bags with their deployed addresses (only those that have been created). */
export const TEST_BAGS: TestBag[] = BAGS.map((b) => ({ ...b, address: DEPLOYED[`${b.chain}:${b.symbol}`] ?? "" })).filter(
  (b) => b.address !== "",
);
export const ALL_TEST_BAG_SPECS = BAGS;

/** The real devnet AMM pool a test bag trades in, if it has one (scripts/create-test-pool.ts). */
export function testPool(chain: string, symbol: string): string | null {
  return DEPLOYED[`${chain}:${symbol}:pool`] ?? null;
}

export function testBag(chain: ChainId, address: string): TestBag | undefined {
  const a = chain.startsWith("base") ? address.toLowerCase() : address;
  return TEST_BAGS.find((b) => b.chain === chain && (b.chain.startsWith("base") ? b.address.toLowerCase() : b.address) === a);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const DAY = 86_400;

/** Deterministic daily history for a test bag, ending today. */
export function simulateHistory(bag: TestBag, nowSecs = Math.floor(Date.now() / 1000)): Candle[] {
  const rand = mulberry32(seedOf(bag.symbol + bag.chain));
  const today = Math.floor(nowSecs / DAY) * DAY;
  const start = today - bag.launchedDaysAgo * DAY;
  const athPrice = bag.athMcapUsd / bag.supply;
  const floorPrice = athPrice * (bag.pattern === "flatline" ? 0.002 : bag.pattern === "rug" ? 0.0015 : 0.004);
  const out: Candle[] = [];
  let prev = athPrice * 0.02;
  for (let d = 0; d <= bag.launchedDaysAgo; d++) {
    let target: number;
    if (d <= bag.athDay) {
      const k = d / Math.max(1, bag.athDay);
      target = athPrice * (0.02 + 0.98 * k ** 1.6);
    } else if (d <= bag.deathDay) {
      const k = (d - bag.athDay) / Math.max(1, bag.deathDay - bag.athDay);
      const curve = bag.pattern === "rug" ? 1 - Math.min(1, k * 1.2) : (1 - k) ** 2.4;
      target = floorPrice + (athPrice - floorPrice) * Math.max(0, curve);
    } else {
      target = floorPrice * (0.75 + 0.5 * rand());
    }
    const noise = 1 + (rand() - 0.5) * (d > bag.deathDay ? 0.18 : 0.32);
    const c = Math.max(floorPrice * 0.4, target * noise);
    const o = prev;
    const h = Math.max(o, c) * (1 + rand() * 0.12);
    const l = Math.min(o, c) * (1 - rand() * 0.12);
    const mcap = c * bag.supply;
    let v: number;
    if (d <= bag.deathDay) v = mcap * (0.25 + rand() * 0.6) * (d <= bag.athDay ? 1.4 : 0.8);
    else v = rand() < 0.18 ? rand() * 60 : rand() * 6;
    out.push({ t: start + d * DAY, o, h, l, c, v });
    prev = c;
  }
  return out;
}

export function simulatedVitals(bag: TestBag, history: Candle[], now = Date.now()): VitalSigns {
  const last = history[history.length - 1];
  const price = last?.c ?? 0;
  const rand = mulberry32(seedOf(bag.symbol + "vitals"));
  const sim = <T>(value: T) => ({ value, source: "simulated" as const, observedAt: now });
  return {
    priceUsd: sim(price),
    marketCapUsd: sim(price * bag.supply),
    fdvUsd: sim(price * bag.supply),
    liquidityUsd: sim(180 + Math.round(rand() * 520)),
    volume24hUsd: sim(Math.round(last?.v ?? 0)),
    trades24h: sim(Math.round(rand() * 3)),
    traders24h: sim(Math.round(rand() * 2)),
    holderCount: sim(400 + Math.round(rand() * 3000)),
    poolCount: sim(1),
  };
}

export function simulatedDossier(bag: TestBag, nowSecs = Math.floor(Date.now() / 1000)): TokenDossier {
  const history = simulateHistory(bag, nowSecs);
  return {
    profile: {
      ref: { chain: bag.chain, address: bag.address },
      name: bag.name,
      symbol: bag.symbol,
      decimals: bag.decimals,
      primaryPool: { address: "simulated", dex: "simulated" },
      createdAt: (nowSecs - bag.launchedDaysAgo * DAY) * 1000,
    },
    vitals: simulatedVitals(bag, history),
    history,
    historySource: "simulated",
    safety: { flags: [], source: ["simulated"], observedAt: Date.now() },
    fetchedAt: Date.now(),
    gaps: ["Testnet token: market history is simulated (devnet tokens have no DEX market)."],
  };
}

/** Simulated "signs of life" the testnet séance reports while a plot is being revived. */
export function seanceObservation(baselineMcap: number, step: number, nowSecs: number) {
  const mcap = Math.max(420_000, baselineMcap * 8) * (1 + step * 0.07);
  return {
    t: String(nowSecs),
    price_usd_e18: "1000000000000",
    market_cap_usd: String(Math.round(mcap)),
    liquidity_usd: String(Math.round(118_000 * (1 + step * 0.05))),
    volume_24h_usd: String(Math.round(410_000 * (1 + step * 0.04))),
    traders_24h: 420 + step * 37,
    flagged_share_bps: 600,
    sources: 2,
  };
}

/** A failing observation, for demonstrating a false dawn. */
export function falseDawnObservation(nowSecs: number) {
  return {
    t: String(nowSecs),
    price_usd_e18: "1000000000",
    market_cap_usd: "190000",
    liquidity_usd: "21000",
    volume_24h_usd: "880000",
    traders_24h: 61,
    flagged_share_bps: 4_100,
    sources: 2,
  };
}
