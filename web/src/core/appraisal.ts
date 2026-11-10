/**
 * Eligibility + appraisal: may this token be buried, and how much ossuary
 * weight does a grave carry?
 *
 * Weight is the grave's *salvage value* at burial: amount × 7-day average
 * price. A plot's total weight is capped at its real on-chain liquidity
 * (min $50, max $25k), because that is the most value the buried supply could
 * ever have been sold for. This is the sybil limit: inventing dead tokens to
 * farm ossuary shares costs real, locked liquidity.
 */
import type { Diagnosis } from "./death";
import type { TokenDossier } from "./vitals";

export const APPRAISAL_VERSION = "ap-1.0";
export const WEIGHT_CAP_MIN_USD = 50;
export const WEIGHT_CAP_MAX_USD = 25_000;
export const MIN_DEATH_SCORE_FOR_WEIGHT = 60;

export type Eligibility =
  | { ok: true; kind: "ranked" | "unmarked"; notes: string[] }
  | { ok: false; reason: string; code: "ALIVE" | "UNSAFE" | "NO_MARKET" | "GATES_CLOSED" };

export function eligibility(d: Diagnosis, dossier: TokenDossier, plotState?: "RESTING" | "STIRRING" | "RISEN"): Eligibility {
  if (plotState === "STIRRING") {
    return { ok: false, code: "GATES_CLOSED", reason: "This plot is stirring. Burials pause while the rite is under way." };
  }
  if (plotState === "RISEN") {
    return { ok: false, code: "GATES_CLOSED", reason: "This token has already risen. Its graves are being raised." };
  }
  const blocking = dossier.safety?.flags.filter((f) => f.severity === "ineligible") ?? [];
  if (blocking.length > 0) {
    return { ok: false, code: "UNSAFE", reason: blocking.map((f) => f.detail).join(" ") };
  }
  if (d.condition === "ALIVE" || d.condition === "FADING") {
    return {
      ok: false,
      code: "ALIVE",
      reason:
        d.condition === "ALIVE"
          ? "This token is alive. Necropolis only accepts the dead."
          : "This token still has a pulse. Come back when it flatlines.",
    };
  }
  if (!dossier.vitals.priceUsd && dossier.history.length === 0) {
    return { ok: false, code: "NO_MARKET", reason: "We cannot find any market for this token, so we cannot appraise it." };
  }
  const notes: string[] = [];
  const warnings = dossier.safety?.flags.filter((f) => f.severity === "warning") ?? [];
  for (const w of warnings) notes.push(w.detail);
  if (d.condition === "UNKNOWN" || (d.deathScore ?? 0) < MIN_DEATH_SCORE_FOR_WEIGHT) {
    notes.push("Not enough evidence of death: this grave is unmarked and carries no ossuary weight.");
    return { ok: true, kind: "unmarked", notes };
  }
  return { ok: true, kind: "ranked", notes };
}

export function twapPrice(dossier: TokenDossier, days = 7): number | undefined {
  const h = dossier.history.slice(-days);
  if (h.length > 0) return h.reduce((s, c) => s + c.c, 0) / h.length;
  return dossier.vitals.priceUsd?.value;
}

export function plotWeightCapUsd(dossier: TokenDossier): number {
  const liq = dossier.vitals.liquidityUsd?.value ?? 0;
  return Math.min(WEIGHT_CAP_MAX_USD, Math.max(WEIGHT_CAP_MIN_USD, liq));
}

export interface AppraisalJson {
  symbol: string;
  name: string;
  decimals: number;
  image: string | null;
  value_usd_e6: string;
  weight_usd_e6: string;
  death_score: number;
  model_version: string;
  plot: { baseline_mcap_usd: string; peak_daily_volume_usd: string; weight_cap_usd_e6: string } | null;
}

/** Build the on-chain appraisal for a burial of `uiAmount` tokens. */
export function appraise(
  dossier: TokenDossier,
  d: Diagnosis,
  uiAmount: number,
  decimals: number,
  opensPlot: boolean,
): { json: AppraisalJson; valueUsd: number; weightUsd: number; priceUsd: number; capUsd: number } {
  const price = twapPrice(dossier) ?? 0;
  const value = Math.max(0, uiAmount * price);
  const cap = plotWeightCapUsd(dossier);
  const ranked = d.condition === "DEAD" || d.condition === "CRITICAL";
  const weight = ranked && (d.deathScore ?? 0) >= MIN_DEATH_SCORE_FOR_WEIGHT ? Math.min(value, cap) : 0;
  const e6 = (usd: number) => String(Math.max(0, Math.round(usd * 1e6)));
  const mcap = dossier.vitals.marketCapUsd?.value ?? 0;
  return {
    valueUsd: value,
    weightUsd: weight,
    priceUsd: price,
    capUsd: cap,
    json: {
      symbol: dossier.profile.symbol.slice(0, 16),
      name: dossier.profile.name.slice(0, 48),
      decimals,
      image: dossier.profile.imageUrl?.slice(0, 300) ?? null,
      value_usd_e6: e6(value),
      weight_usd_e6: e6(weight),
      death_score: Math.round(d.deathScore ?? 0),
      model_version: `${d.modelVersion}/${APPRAISAL_VERSION}`,
      plot: opensPlot
        ? {
            baseline_mcap_usd: String(Math.round(mcap)),
            peak_daily_volume_usd: String(Math.round(d.peakDailyVolumeUsd ?? 0)),
            weight_cap_usd_e6: e6(cap),
          }
        : null,
    },
  };
}
