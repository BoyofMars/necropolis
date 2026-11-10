import type { ObservationJson, PlotJson } from "@/core/near";
import type { Observation, PlotBaseline, PlotState, RiteTerms } from "@/core/resurrection";

export function termsOf(p: PlotJson): RiteTerms {
  const t = p.terms;
  return {
    minLiquidityUsd: Number(t.min_liquidity_usd),
    minVolume24hUsd: Number(t.min_volume_24h_usd),
    minPeakVolumeShareBps: t.min_peak_volume_share_bps,
    minTraders24h: t.min_traders_24h,
    maxVolumeToLiquidityX100: t.max_volume_to_liquidity_x100,
    minMcapMultipleX100: t.min_mcap_multiple_x100,
    minMcapUsd: Number(t.min_mcap_usd),
    maxFlaggedShareBps: t.max_flagged_share_bps,
    minSources: t.min_sources,
    windowSecs: Number(t.window_secs),
    maxGapSecs: Number(t.max_gap_secs),
    minObservations: t.min_observations,
  };
}

export function baseOf(p: PlotJson): PlotBaseline {
  return { baselineMcapUsd: Number(p.baseline_mcap_usd), peakDailyVolumeUsd: Number(p.peak_daily_volume_usd) };
}

export function obsOf(o: ObservationJson): Observation {
  return {
    t: Number(o.t),
    priceUsd: Number(o.price_usd_e18) / 1e18,
    marketCapUsd: Number(o.market_cap_usd),
    liquidityUsd: Number(o.liquidity_usd),
    volume24hUsd: Number(o.volume_24h_usd),
    traders24h: o.traders_24h,
    flaggedShareBps: o.flagged_share_bps,
    sources: o.sources,
  };
}

export function stateOf(p: PlotJson): PlotState {
  const s = p.state;
  if (s.kind === "RESTING") return { kind: "RESTING", falseDawns: s.false_dawns, lastObservedAt: s.last_observed_at ? Number(s.last_observed_at) : undefined };
  if (s.kind === "STIRRING") return { kind: "STIRRING", since: Number(s.since), lastAt: Number(s.last_at), count: s.count, falseDawns: s.false_dawns };
  return { kind: "RISEN", at: Number(s.at), falseDawns: s.false_dawns };
}
