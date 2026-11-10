import type { ChainId, TokenRef } from "@/core/chains";
import { CHAINS, normalizeToken } from "@/core/chains";
import { diagnose, type Diagnosis } from "@/core/death";
import { simulatedDossier, testBag, TEST_BAGS } from "@/core/testnet";
import type { TokenDossier } from "@/core/vitals";
import { cached } from "./http";
import {
  baseHoldings,
  baseSafety,
  dailyHistory,
  dexPairsForTokens,
  jupiterTokens,
  profileFromPairs,
  solanaHoldings,
  solanaSafety,
  vitalsFromPairs,
  type Holding,
} from "./providers";

export interface DossierOptions {
  history?: boolean;
  safety?: boolean;
}

export async function getDossier(chain: ChainId, address: string, opts: DossierOptions = {}): Promise<TokenDossier> {
  const ref = normalizeToken(chain, address);
  if (CHAINS[ref.chain].network === "testnet") {
    const bag = testBag(ref.chain, ref.address);
    if (!bag) {
      return {
        profile: { ref, name: "Unknown testnet token", symbol: "???" },
        vitals: {},
        history: [],
        fetchedAt: Date.now(),
        gaps: ["Only Proving Grounds test bags have (simulated) markets on testnet."],
      };
    }
    return simulatedDossier(bag);
  }
  return cached(`dossier:${ref.chain}:${ref.address}:${opts.history ? 1 : 0}${opts.safety ? 1 : 0}`, 60_000, () =>
    mainnetDossier(ref, opts),
  );
}

async function mainnetDossier(ref: TokenRef, opts: DossierOptions): Promise<TokenDossier> {
  const gaps: string[] = [];
  const [pairsMap, jupMap] = await Promise.all([
    dexPairsForTokens(ref.chain, [ref.address]).catch((e) => {
      gaps.push(`DexScreener unavailable (${(e as Error).message}).`);
      return new Map();
    }),
    ref.chain === "sol"
      ? jupiterTokens([ref.address]).catch((e) => {
          gaps.push(`Jupiter unavailable (${(e as Error).message}).`);
          return new Map();
        })
      : Promise.resolve(new Map()),
  ]);
  const pairs = pairsMap.get(ref.address) ?? [];
  const jup = jupMap.get(ref.address);
  const profile = profileFromPairs(ref.chain, ref.address, pairs, jup);
  const vitals = vitalsFromPairs(pairs, jup);
  if (pairs.length === 0 && !jup) gaps.push("No markets found on DexScreener or Jupiter.");

  let history: TokenDossier["history"] = [];
  let historySource: TokenDossier["historySource"];
  if (opts.history && profile.primaryPool) {
    try {
      history = await dailyHistory(ref.chain, profile.primaryPool.address);
      historySource = "geckoterminal";
      if (history.length === 0) gaps.push("GeckoTerminal returned no price history for the main pool.");
    } catch (e) {
      gaps.push(`Price history unavailable right now (${(e as Error).message}). Showing triage only.`);
    }
  }
  let safety: TokenDossier["safety"];
  if (opts.safety) {
    safety = ref.chain === "sol" ? await solanaSafety(ref.address, jup) : await baseSafety(ref.address);
  }
  return { profile, vitals, history, historySource, safety, fetchedAt: Date.now(), gaps };
}

export interface ScanEntry {
  address: string;
  symbol: string;
  name: string;
  icon?: string;
  amountRaw: string;
  decimals: number;
  uiAmount: number;
  valueUsd?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  diagnosis: Pick<Diagnosis, "condition" | "deathScore" | "evidence" | "headline" | "notes"> & {
    reasons: { label: string; measured?: string; score?: number }[];
  };
  testBag?: boolean;
}

export interface ScanResult {
  chain: ChainId;
  owner: string;
  entries: ScanEntry[];
  counts: { total: number; dead: number; critical: number; fading: number; alive: number; unknown: number };
  gaps: string[];
  scannedAt: number;
}

export async function scanWallet(chain: ChainId, owner: string): Promise<ScanResult> {
  const info = CHAINS[chain];
  const gaps: string[] = [];
  let holdings: Holding[] = [];
  if (info.family === "solana") holdings = await solanaHoldings(chain as "sol" | "sol-devnet", owner);
  else holdings = await baseHoldings(chain as "base" | "base-sepolia", owner);

  const entries: ScanEntry[] = [];
  if (info.network === "testnet") {
    for (const h of holdings) {
      const bag = testBag(chain, h.address);
      if (!bag) continue; // only test bags have (simulated) markets
      const dossier = simulatedDossier(bag);
      entries.push(entryFor(h, dossier, diagnose(dossier), true));
    }
    if (holdings.length > 0 && entries.length === 0) gaps.push("Only Proving Grounds test bags are recognised on testnet.");
  } else {
    const addrs = holdings.map((h) => h.address).slice(0, 60);
    if (holdings.length > 60) gaps.push(`Showing the first 60 of ${holdings.length} tokens.`);
    const [pairsMap, jupMap] = await Promise.all([
      dexPairsForTokens(chain, addrs).catch((e) => {
        gaps.push(`DexScreener unavailable (${(e as Error).message}).`);
        return new Map();
      }),
      chain === "sol"
        ? jupiterTokens(addrs).catch((e) => {
            gaps.push(`Jupiter unavailable (${(e as Error).message}).`);
            return new Map();
          })
        : Promise.resolve(new Map()),
    ]);
    for (const h of holdings.filter((x) => addrs.includes(x.address))) {
      const pairs = pairsMap.get(h.address) ?? [];
      const jup = jupMap.get(h.address);
      const dossier: TokenDossier = {
        profile: profileFromPairs(chain, h.address, pairs, jup),
        vitals: vitalsFromPairs(pairs, jup),
        history: [],
        fetchedAt: Date.now(),
        gaps: [],
      };
      if (!dossier.profile.symbol || dossier.profile.symbol === "???") {
        dossier.profile.symbol = h.symbol ?? "???";
        dossier.profile.name = h.name ?? dossier.profile.name;
      }
      if (!dossier.profile.imageUrl && h.icon) dossier.profile.imageUrl = h.icon;
      entries.push(entryFor(h, dossier, diagnose(dossier), false));
    }
  }
  const order = { DEAD: 0, CRITICAL: 1, FADING: 2, UNKNOWN: 3, ALIVE: 4 } as const;
  entries.sort((a, b) => order[a.diagnosis.condition] - order[b.diagnosis.condition] || (b.diagnosis.deathScore ?? 0) - (a.diagnosis.deathScore ?? 0));
  const counts = { total: entries.length, dead: 0, critical: 0, fading: 0, alive: 0, unknown: 0 };
  for (const e of entries) {
    const k = e.diagnosis.condition.toLowerCase() as keyof typeof counts;
    counts[k]++;
  }
  return { chain, owner, entries, counts, gaps, scannedAt: Date.now() };
}

function entryFor(h: Holding, dossier: TokenDossier, d: Diagnosis, isTest: boolean): ScanEntry {
  const price = dossier.vitals.priceUsd?.value;
  return {
    address: h.address,
    symbol: dossier.profile.symbol,
    name: dossier.profile.name,
    icon: dossier.profile.imageUrl,
    amountRaw: h.amountRaw,
    decimals: h.decimals,
    uiAmount: h.uiAmount,
    valueUsd: price !== undefined ? price * h.uiAmount : undefined,
    liquidityUsd: dossier.vitals.liquidityUsd?.value,
    volume24hUsd: dossier.vitals.volume24hUsd?.value,
    diagnosis: {
      condition: d.condition,
      deathScore: d.deathScore,
      evidence: d.evidence,
      headline: d.headline,
      notes: d.notes,
      reasons: d.components
        .filter((c) => c.score !== undefined)
        .map((c) => ({ label: c.label, measured: c.measured, score: c.score })),
    },
    testBag: isTest,
  };
}

export function testBagsFor(chain: ChainId) {
  return TEST_BAGS.filter((b) => b.chain === chain);
}
