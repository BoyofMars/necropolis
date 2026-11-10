/**
 * Resurrection ("the Rite").
 *
 * A plot (all graves of one token) rises only when the token sustains a real
 * recovery. This module is a byte-for-byte mirror of the state machine the
 * NEAR contract enforces (`contract/src/rite.rs`). The contract is the source
 * of truth; this copy exists so the UI can show progress and explain *why*.
 *
 * Coroners report raw vital signs. The contract — not the coroner — decides.
 *
 * Evidence behind the thresholds:
 *  - Revival = volume back to >=10% of the pre-death peak (Feder et al. / Gandal et al.)
 *  - Liquidity floor $50k (Chainplay death marker, inverted)
 *  - 14-day window: TROLL's April-2025 "revival" reversed 99% within weeks, and
 *    wash campaigns recur on a ~16 day cadence (arXiv 2507.01963)
 *  - Volume/liquidity <= 20x: above that, vendors treat volume as likely wash
 *  - Flagged (non-organic) volume share <= 30%
 */

export interface RiteTerms {
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  /** volume must also reach this share of the plot's pre-death peak daily volume (bps) */
  minPeakVolumeShareBps: number;
  minTraders24h: number;
  /** maximum volume / liquidity ratio, in hundredths (2000 = 20.00x) */
  maxVolumeToLiquidityX100: number;
  /** market cap must reach this multiple of the plot's burial baseline (x100) */
  minMcapMultipleX100: number;
  minMcapUsd: number;
  maxFlaggedShareBps: number;
  minSources: number;
  windowSecs: number;
  maxGapSecs: number;
  minObservations: number;
}

export const MAINNET_TERMS: RiteTerms = {
  minLiquidityUsd: 50_000,
  minVolume24hUsd: 25_000,
  minPeakVolumeShareBps: 1_000,
  minTraders24h: 100,
  maxVolumeToLiquidityX100: 2_000,
  minMcapMultipleX100: 500,
  minMcapUsd: 250_000,
  maxFlaggedShareBps: 3_000,
  minSources: 2,
  windowSecs: 14 * 86_400,
  maxGapSecs: 36 * 3_600,
  minObservations: 14,
};

/** Testnet: identical thresholds, compressed timers so the full rite is demoable. */
export const TESTNET_TERMS: RiteTerms = {
  ...MAINNET_TERMS,
  windowSecs: 6 * 60,
  maxGapSecs: 3 * 60,
  minObservations: 3,
};

export interface Observation {
  /** unix seconds */
  t: number;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  traders24h: number;
  flaggedShareBps: number;
  sources: number;
}

export interface PlotBaseline {
  /** market cap at plot opening (dead-period median), USD */
  baselineMcapUsd: number;
  /** pre-death peak daily volume (7d rolling avg), USD */
  peakDailyVolumeUsd: number;
}

export type PlotState =
  | { kind: "RESTING"; falseDawns: number; lastObservedAt?: number }
  | { kind: "STIRRING"; since: number; lastAt: number; count: number; falseDawns: number }
  | { kind: "RISEN"; at: number; falseDawns: number };

export type CriterionKey =
  | "liquidity"
  | "volume"
  | "traders"
  | "washRatio"
  | "marketCap"
  | "organic"
  | "sources";

export interface CriterionCheck {
  key: CriterionKey;
  label: string;
  pass: boolean;
  /** progress toward threshold 0..1 (1 = met) */
  progress: number;
  measured: string;
  required: string;
}

const fmt = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`;

export function requiredVolume(terms: RiteTerms, base: PlotBaseline): number {
  return Math.max(terms.minVolume24hUsd, (base.peakDailyVolumeUsd * terms.minPeakVolumeShareBps) / 10_000);
}

export function requiredMcap(terms: RiteTerms, base: PlotBaseline): number {
  return Math.max(terms.minMcapUsd, (base.baselineMcapUsd * terms.minMcapMultipleX100) / 100);
}

export function checkObservation(terms: RiteTerms, base: PlotBaseline, o: Observation): CriterionCheck[] {
  const vReq = requiredVolume(terms, base);
  const mReq = requiredMcap(terms, base);
  const ratioX100 = o.liquidityUsd > 0 ? Math.floor((o.volume24hUsd * 100) / o.liquidityUsd) : Infinity;
  const p = (have: number, need: number) => (need <= 0 ? 1 : Math.min(1, Math.max(0, have / need)));
  return [
    {
      key: "liquidity",
      label: "Liquidity",
      pass: o.liquidityUsd >= terms.minLiquidityUsd,
      progress: p(o.liquidityUsd, terms.minLiquidityUsd),
      measured: fmt(o.liquidityUsd),
      required: `≥ ${fmt(terms.minLiquidityUsd)}`,
    },
    {
      key: "volume",
      label: "24h volume",
      pass: o.volume24hUsd >= vReq,
      progress: p(o.volume24hUsd, vReq),
      measured: fmt(o.volume24hUsd),
      required: `≥ ${fmt(vReq)}`,
    },
    {
      key: "traders",
      label: "Unique traders (24h)",
      pass: o.traders24h >= terms.minTraders24h,
      progress: p(o.traders24h, terms.minTraders24h),
      measured: `${o.traders24h}`,
      required: `≥ ${terms.minTraders24h}`,
    },
    {
      key: "marketCap",
      label: "Market cap",
      pass: o.marketCapUsd >= mReq,
      progress: p(o.marketCapUsd, mReq),
      measured: fmt(o.marketCapUsd),
      required: `≥ ${fmt(mReq)}`,
    },
    {
      key: "washRatio",
      label: "Volume ÷ liquidity",
      pass: ratioX100 <= terms.maxVolumeToLiquidityX100,
      progress: ratioX100 <= terms.maxVolumeToLiquidityX100 ? 1 : 0,
      measured: Number.isFinite(ratioX100) ? `${(ratioX100 / 100).toFixed(1)}×` : "∞",
      required: `≤ ${(terms.maxVolumeToLiquidityX100 / 100).toFixed(0)}×`,
    },
    {
      key: "organic",
      label: "Flagged (wash) volume",
      pass: o.flaggedShareBps <= terms.maxFlaggedShareBps,
      progress: o.flaggedShareBps <= terms.maxFlaggedShareBps ? 1 : 0,
      measured: `${(o.flaggedShareBps / 100).toFixed(0)}%`,
      required: `≤ ${(terms.maxFlaggedShareBps / 100).toFixed(0)}%`,
    },
    {
      key: "sources",
      label: "Independent sources agreeing",
      pass: o.sources >= terms.minSources,
      progress: p(o.sources, terms.minSources),
      measured: `${o.sources}`,
      required: `≥ ${terms.minSources}`,
    },
  ];
}

export function passes(terms: RiteTerms, base: PlotBaseline, o: Observation): boolean {
  return checkObservation(terms, base, o).every((c) => c.pass);
}

export class ObservationError extends Error {}

/** Advance the plot state machine by one observation. Mirrors `Plot::observe` in the contract. */
export function advance(
  terms: RiteTerms,
  base: PlotBaseline,
  state: PlotState,
  o: Observation,
): PlotState {
  if (state.kind === "RISEN") throw new ObservationError("Plot has already risen");
  const last = state.kind === "STIRRING" ? state.lastAt : state.lastObservedAt;
  if (last !== undefined && o.t <= last) throw new ObservationError("Observations must move forward in time");
  const ok = passes(terms, base, o);
  if (state.kind === "RESTING") {
    if (!ok) return { kind: "RESTING", falseDawns: state.falseDawns, lastObservedAt: o.t };
    return { kind: "STIRRING", since: o.t, lastAt: o.t, count: 1, falseDawns: state.falseDawns };
  }
  // STIRRING
  const gapOk = o.t - state.lastAt <= terms.maxGapSecs;
  if (!ok || !gapOk) {
    return { kind: "RESTING", falseDawns: state.falseDawns + 1, lastObservedAt: o.t };
  }
  const count = state.count + 1;
  if (o.t - state.since >= terms.windowSecs && count >= terms.minObservations) {
    return { kind: "RISEN", at: o.t, falseDawns: state.falseDawns };
  }
  return { kind: "STIRRING", since: state.since, lastAt: o.t, count, falseDawns: state.falseDawns };
}

/** Overall progress 0..1 combining the weakest criterion and the elapsed window. */
export function riteProgress(
  terms: RiteTerms,
  base: PlotBaseline,
  state: PlotState,
  latest?: Observation,
  now = Math.floor(Date.now() / 1000),
): { vitals: number; window: number; overall: number } {
  if (state.kind === "RISEN") return { vitals: 1, window: 1, overall: 1 };
  const vitals = latest ? Math.min(...checkObservation(terms, base, latest).map((c) => c.progress)) : 0;
  const window =
    state.kind === "STIRRING" ? Math.min(1, (Math.min(now, state.lastAt) - state.since) / terms.windowSecs) : 0;
  // Vitals carry 60% until met; the window carries the remainder.
  const overall = state.kind === "STIRRING" ? 0.6 + 0.4 * window : 0.6 * vitals;
  return { vitals, window, overall };
}

export function describeWindow(terms: RiteTerms): string {
  const d = terms.windowSecs / 86_400;
  if (d >= 1) return `${d} consecutive days`;
  return `${Math.round(terms.windowSecs / 60)} consecutive minutes (testnet timer)`;
}
