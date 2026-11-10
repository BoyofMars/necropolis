/**
 * Death classification ("the autopsy").
 *
 * Death is never a vibe. Every diagnosis is a weighted combination of measured
 * components, each normalised to 0 (alive) .. 1 (dead), with explicit anchors
 * taken from published research:
 *
 *  - Liquidity < $1k is "essentially worthless"            (Solidus Labs, 7M+ Solana tokens)
 *  - Dead if avg daily volume <= 1% of past peak            (Feder et al. 2018; Gandal et al. 2021)
 *  - Pool inactive after 30 days without transactions       (Chainalysis 2025)
 *  - 24h volume < $1k / liquidity < $50k as death markers   (Chainplay 2024)
 *  - -90% from ATH is NOT death on its own (large live coins sit there), so
 *    drawdown carries a deliberately low weight.
 *
 * Weights and log-scale endpoints are judgement calls; they are versioned
 * (MODEL_VERSION) and shown to users verbatim on the methodology page.
 */
import type { Candle, TokenDossier, DataSource } from "./vitals";
import { val } from "./vitals";

export const MODEL_VERSION = "dm-1.0";

export type Condition = "ALIVE" | "FADING" | "CRITICAL" | "DEAD" | "UNKNOWN";

export type ComponentKey =
  | "liquidity"
  | "volumeDecay"
  | "volume7d"
  | "activity"
  | "dormancy"
  | "drawdown";

export interface ComponentResult {
  key: ComponentKey;
  label: string;
  weight: number;
  /** 0 = alive .. 1 = dead; undefined when the input is missing */
  score?: number;
  /** Human-readable measured value, e.g. "$412" or "-99.4% from ATH" */
  measured?: string;
  /** What the anchors are, e.g. "$50k → alive, $1k → dead (log)" */
  anchors: string;
  source?: DataSource | "history";
}

export type CauseOfDeath =
  | "STILLBORN"
  | "SUDDEN_COLLAPSE"
  | "ABANDONED"
  | "SLOW_BLEED"
  | "UNDETERMINED";

export interface Diagnosis {
  modelVersion: string;
  /** 0..100, higher = more dead. undefined when evidence is insufficient */
  deathScore?: number;
  condition: Condition;
  /** Share of total component weight that had data, 0..1 */
  evidence: number;
  components: ComponentResult[];
  cause: { code: CauseOfDeath; title: string; detail: string };
  /** Estimated start of the final dead run (unix s), if any */
  timeOfDeath?: number;
  daysDead?: number;
  /** Most recent day with meaningful trading (unix s) */
  lastSignOfLife?: { t: number; volumeUsd: number };
  athPriceUsd?: number;
  athAt?: number;
  drawdownFromAth?: number;
  peakDailyVolumeUsd?: number;
  /** History starts after the token's launch (provider window), so peaks are window peaks */
  historyTruncated: boolean;
  /** Already dead on the first day of available history: daysDead is a lower bound */
  deadBeforeRecords: boolean;
  /** Overrides / caveats applied, shown verbatim */
  notes: string[];
  /** Short epitaph-style summary line */
  headline: string;
}

export const WEIGHTS: Record<ComponentKey, number> = {
  liquidity: 0.25,
  volumeDecay: 0.2,
  volume7d: 0.15,
  activity: 0.15,
  dormancy: 0.15,
  drawdown: 0.1,
};

export const THRESHOLDS = {
  fading: 35,
  critical: 60,
  dead: 80,
  /** Minimum share of weight with data before we diagnose at all */
  minEvidence: 0.55,
  /** Daily volume (USD) that counts as "meaningful trading" */
  meaningfulDailyVolume: 50,
  /** A dead run must have at most max(1% of peak, $100) daily volume */
  deadRunVolumeFloor: 100,
  deadRunPeakShare: 0.01,
  /** Activity floor: tokens with this much organic life cannot be DEAD/CRITICAL */
  activityFloorTraders24h: 50,
  activityFloorDailyVolume: 1_000,
  /** Fast-path: liquidity below this AND no meaningful trade for N days */
  fastPathLiquidity: 1_000,
  fastPathDormantDays: 30,
  /** Under this many days of history we decline to pronounce (unless fast-path) */
  minHistoryDays: 7,
} as const;

const DAY = 86_400;

/** 0 at >= alive, 1 at <= dead, log-interpolated between. */
export function logScaleDead(value: number, alive: number, dead: number): number {
  if (!(value > 0)) return 1;
  if (value >= alive) return 0;
  if (value <= dead) return 1;
  const t = (Math.log10(alive) - Math.log10(value)) / (Math.log10(alive) - Math.log10(dead));
  return clamp01(t);
}

export function linearScaleDead(value: number, alive: number, dead: number): number {
  if (value <= alive) return 0;
  if (value >= dead) return 1;
  return clamp01((value - alive) / (dead - alive));
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function usd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  if (a >= 1) return `$${n.toFixed(0)}`;
  if (a === 0) return "$0";
  return `$${n.toPrecision(2)}`;
}

/** Highest 7-day rolling average of daily volume. */
export function peakRollingVolume(history: Candle[], window = 7): number {
  if (history.length === 0) return 0;
  let best = 0;
  let sum = 0;
  for (let i = 0; i < history.length; i++) {
    sum += history[i].v;
    if (i >= window) sum -= history[i - window].v;
    const n = Math.min(i + 1, window);
    best = Math.max(best, sum / n);
  }
  return best;
}

/**
 * Fill calendar gaps: providers omit days with no trades. A missing day is a
 * day with zero volume at the previous close.
 */
export function densify(history: Candle[], until?: number): Candle[] {
  if (history.length === 0) return [];
  const out: Candle[] = [];
  const end = until ?? history[history.length - 1].t;
  let idx = 0;
  let prev = history[0];
  for (let t = history[0].t; t <= end; t += DAY) {
    if (idx < history.length && Math.abs(history[idx].t - t) < DAY / 2) {
      prev = history[idx];
      out.push(history[idx]);
      idx++;
    } else {
      out.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
    }
  }
  return out;
}

function avgVolume(days: Candle[]): number {
  if (days.length === 0) return 0;
  return days.reduce((s, d) => s + d.v, 0) / days.length;
}

export interface DiagnoseOptions {
  /** Reference "now" (unix s). Defaults to Date.now(). */
  now?: number;
}

export function diagnose(dossier: TokenDossier, opts: DiagnoseOptions = {}): Diagnosis {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const today = Math.floor(now / DAY) * DAY;
  const v = dossier.vitals;
  const notes: string[] = [];
  const hist = densify(
    [...dossier.history].sort((a, b) => a.t - b.t),
    dossier.history.length ? today : undefined,
  );
  const hasHistory = hist.length >= 2;

  const liquidity = val(v.liquidityUsd);
  const vol24 = val(v.volume24hUsd);
  const traders24 = val(v.traders24h);
  const trades24 = val(v.trades24h);
  const price = val(v.priceUsd) ?? (hasHistory ? hist[hist.length - 1].c : undefined);

  // --- history-derived facts
  const peak = hasHistory ? peakRollingVolume(hist) : undefined;
  const last7 = hasHistory ? hist.slice(-7) : [];
  const last30 = hasHistory ? hist.slice(-30) : [];
  const vol7dAvg = hasHistory ? avgVolume(last7) : vol24;
  let athPrice: number | undefined;
  let athAt: number | undefined;
  for (const d of hist) {
    if (athPrice === undefined || d.c > athPrice) {
      athPrice = d.c;
      athAt = d.t;
    }
  }
  const drawdown =
    athPrice && price !== undefined && athPrice > 0 ? clamp01(1 - price / athPrice) : undefined;

  let lastSignOfLife: Diagnosis["lastSignOfLife"];
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].v >= THRESHOLDS.meaningfulDailyVolume) {
      lastSignOfLife = { t: hist[i].t, volumeUsd: hist[i].v };
      break;
    }
  }
  let dormantDays: number | undefined;
  if (hasHistory) {
    dormantDays = lastSignOfLife ? Math.max(0, Math.round((today - lastSignOfLife.t) / DAY)) : hist.length;
  } else if (trades24 !== undefined) {
    dormantDays = trades24 === 0 ? 1 : 0; // we only know about the last 24h
  }

  // --- components
  const components: ComponentResult[] = [
    {
      key: "liquidity",
      label: "Liquidity",
      weight: WEIGHTS.liquidity,
      score: liquidity !== undefined ? logScaleDead(liquidity, 50_000, 1_000) : undefined,
      measured: liquidity !== undefined ? usd(liquidity) : undefined,
      anchors: "$50k → alive · $1k → dead (log scale)",
      source: v.liquidityUsd?.source,
    },
    {
      key: "volumeDecay",
      label: "Volume vs. peak",
      weight: WEIGHTS.volumeDecay,
      score:
        hasHistory && peak && peak > 0
          ? logScaleDead(avgVolume(last30) / peak, 0.1, 0.01)
          : undefined,
      measured:
        hasHistory && peak && peak > 0
          ? `${((avgVolume(last30) / peak) * 100).toFixed(peak > 0 && avgVolume(last30) / peak < 0.01 ? 2 : 1)}% of peak`
          : undefined,
      anchors: "30d avg ÷ peak 7d avg: 10% → alive · 1% → dead",
      source: "history",
    },
    {
      key: "volume7d",
      label: "Daily volume (7d avg)",
      weight: WEIGHTS.volume7d,
      score: vol7dAvg !== undefined ? logScaleDead(vol7dAvg, 10_000, 10) : undefined,
      measured: vol7dAvg !== undefined ? `${usd(vol7dAvg)}/day` : undefined,
      anchors: "$10k/day → alive · $10/day → dead (log)",
      source: hasHistory ? "history" : v.volume24hUsd?.source,
    },
    {
      key: "activity",
      label: traders24 !== undefined ? "Unique traders (24h)" : "Trades (24h)",
      weight: WEIGHTS.activity,
      score:
        traders24 !== undefined
          ? logScaleDead(traders24, 200, 5)
          : trades24 !== undefined
            ? logScaleDead(trades24, 400, 8)
            : undefined,
      measured:
        traders24 !== undefined
          ? `${traders24} traders`
          : trades24 !== undefined
            ? `${trades24} trades`
            : undefined,
      anchors:
        traders24 !== undefined ? "200 traders → alive · 5 → dead" : "400 trades → alive · 8 → dead",
      source: (traders24 !== undefined ? v.traders24h : v.trades24h)?.source,
    },
    {
      key: "dormancy",
      label: "Since last meaningful trade",
      weight: WEIGHTS.dormancy,
      score: dormantDays !== undefined ? clamp01(dormantDays / 30) : undefined,
      measured:
        dormantDays !== undefined
          ? dormantDays === 0
            ? "traded today"
            : `${dormantDays} day${dormantDays === 1 ? "" : "s"}`
          : undefined,
      anchors: `0 days → alive · 30 days → dead (≥${usd(THRESHOLDS.meaningfulDailyVolume)}/day)`,
      source: hasHistory ? "history" : v.trades24h?.source,
    },
    {
      key: "drawdown",
      label: "Drawdown from ATH",
      weight: WEIGHTS.drawdown,
      score: drawdown !== undefined ? linearScaleDead(drawdown, 0.8, 0.99) : undefined,
      measured: drawdown !== undefined ? `-${(drawdown * 100).toFixed(drawdown > 0.99 ? 2 : 1)}%` : undefined,
      anchors: "-80% → alive · -99% → dead (low weight: -90% coins can be alive)",
      source: "history",
    },
  ];

  const known = components.filter((c) => c.score !== undefined);
  const evidence = known.reduce((s, c) => s + c.weight, 0);
  const rawScore =
    evidence > 0 ? (known.reduce((s, c) => s + c.weight * (c.score as number), 0) / evidence) * 100 : undefined;

  // --- was the history window cut off by the provider (e.g. 6 months keyless)?
  const createdSecs = dossier.profile.createdAt ? Math.floor(dossier.profile.createdAt / 1000) : undefined;
  const historyTruncated =
    hasHistory && (createdSecs !== undefined ? hist[0].t - createdSecs > 3 * DAY : hist.length >= 180);

  // --- time of death: start of the final run of days below the dead-run floor
  let timeOfDeath: number | undefined;
  let deadBeforeRecords = false;
  if (hasHistory && peak !== undefined) {
    const floor = Math.max(THRESHOLDS.deadRunVolumeFloor, peak * THRESHOLDS.deadRunPeakShare);
    let i = hist.length - 1;
    while (i >= 0 && hist[i].v <= floor) i--;
    if (i < hist.length - 1) {
      if (i < 0 && historyTruncated) deadBeforeRecords = true;
      else timeOfDeath = hist[i + 1].t;
    }
  }
  const daysDead = deadBeforeRecords
    ? Math.round((today - hist[0].t) / DAY)
    : timeOfDeath !== undefined
      ? Math.round((today - timeOfDeath) / DAY)
      : undefined;
  if (historyTruncated) {
    notes.push(
      `Price history only covers the last ${hist.length} days, so peaks and drawdown are measured within that window.`,
    );
  }

  // --- condition with overrides
  let condition: Condition;
  let deathScore: number | undefined = rawScore !== undefined ? Math.round(rawScore) : undefined;
  const fastPath =
    liquidity !== undefined &&
    liquidity < THRESHOLDS.fastPathLiquidity &&
    dormantDays !== undefined &&
    dormantDays >= THRESHOLDS.fastPathDormantDays;
  const stillborn = dossier.profile.bondingCurveOnly === true && (dormantDays ?? 0) >= 7;

  if (fastPath || stillborn) {
    condition = "DEAD";
    deathScore = Math.max(deathScore ?? 0, THRESHOLDS.dead);
    notes.push(
      fastPath
        ? `Fast-path: liquidity under ${usd(THRESHOLDS.fastPathLiquidity)} and no meaningful trade for ${dormantDays} days.`
        : "Fast-path: never left the launchpad bonding curve and no trades for 7+ days.",
    );
  } else if (rawScore === undefined || evidence < THRESHOLDS.minEvidence) {
    condition = "UNKNOWN";
    deathScore = undefined;
    notes.push("Not enough evidence to pronounce. We only diagnose with most of the vital signs present.");
  } else if (hasHistory && hist.length < THRESHOLDS.minHistoryDays) {
    condition = "UNKNOWN";
    notes.push(`Too young to pronounce: under ${THRESHOLDS.minHistoryDays} days of trading history.`);
  } else {
    const s = rawScore;
    condition =
      s >= THRESHOLDS.dead ? "DEAD" : s >= THRESHOLDS.critical ? "CRITICAL" : s >= THRESHOLDS.fading ? "FADING" : "ALIVE";
  }

  const activityFloor =
    (traders24 !== undefined && traders24 >= THRESHOLDS.activityFloorTraders24h) ||
    (vol7dAvg !== undefined && vol7dAvg >= THRESHOLDS.activityFloorDailyVolume);
  if (activityFloor && (condition === "DEAD" || condition === "CRITICAL") && !stillborn) {
    condition = "FADING";
    notes.push(
      "Activity floor: real traders are still here, so this token is capped at Fading no matter how far it has fallen.",
    );
  }
  if (!hasHistory && condition !== "UNKNOWN") {
    notes.push("Triage only: price history not loaded, so drawdown and volume-decay are excluded.");
  }

  const cause =
    (deadBeforeRecords || (historyTruncated && peakIndex(hist) === 0)) && (condition === "DEAD" || condition === "CRITICAL")
      ? {
          code: "UNDETERMINED" as const,
          title: "Died before our records begin",
          detail: `It was already dying when our ${hist.length}-day price record starts, so we won't guess how it died.`,
        }
      : causeOfDeath(dossier, hist, condition, { peak, timeOfDeath });

  return {
    modelVersion: MODEL_VERSION,
    deathScore,
    condition,
    evidence: Math.round(evidence * 100) / 100,
    components,
    cause,
    timeOfDeath,
    daysDead,
    lastSignOfLife,
    athPriceUsd: athPrice,
    athAt,
    drawdownFromAth: drawdown,
    peakDailyVolumeUsd: peak,
    historyTruncated,
    deadBeforeRecords,
    notes,
    headline: headlineFor(condition, deathScore, daysDead, deadBeforeRecords),
  };
}

function peakIndex(hist: Candle[]): number {
  let best = 0;
  for (let i = 1; i < hist.length; i++) if (hist[i].v > hist[best].v) best = i;
  return best;
}

function causeOfDeath(
  dossier: TokenDossier,
  hist: Candle[],
  condition: Condition,
  ctx: { peak?: number; timeOfDeath?: number },
): Diagnosis["cause"] {
  if (condition !== "DEAD" && condition !== "CRITICAL") {
    return { code: "UNDETERMINED", title: "No cause of death", detail: "This token is not dead." };
  }
  if (dossier.profile.bondingCurveOnly) {
    return {
      code: "STILLBORN",
      title: "Stillborn",
      detail: "Never graduated from its launchpad bonding curve to an open market.",
    };
  }
  // Largest single-day collapse (close vs previous close)
  let worst = 0;
  let worstAt: number | undefined;
  for (let i = 1; i < hist.length; i++) {
    const prev = hist[i - 1].c;
    if (prev > 0) {
      const drop = 1 - hist[i].c / prev;
      if (drop > worst) {
        worst = drop;
        worstAt = hist[i].t;
      }
    }
  }
  if (worst >= 0.8 && worstAt !== undefined) {
    return {
      code: "SUDDEN_COLLAPSE",
      title: "Sudden collapse",
      detail: `Lost ${(worst * 100).toFixed(0)}% in a single day (${isoDay(worstAt)}). A pattern consistent with liquidity removal or a coordinated dump.`,
    };
  }
  if (ctx.peak && hist.length > 0) {
    let peakIdx = 0;
    let best = 0;
    for (let i = 0; i < hist.length; i++) {
      if (hist[i].v > best) {
        best = hist[i].v;
        peakIdx = i;
      }
    }
    const deathIdx = ctx.timeOfDeath ? hist.findIndex((d) => d.t === ctx.timeOfDeath) : hist.length - 1;
    const bleedDays = Math.max(0, deathIdx - peakIdx);
    if (bleedDays >= 21) {
      return {
        code: "SLOW_BLEED",
        title: "Slow bleed",
        detail: `Volume drained for ${bleedDays} days after its peak before trading stopped.`,
      };
    }
    return {
      code: "ABANDONED",
      title: "Abandoned",
      detail:
        bleedDays > 0
          ? `Traders left within ${bleedDays} day${bleedDays === 1 ? "" : "s"} of peak activity.`
          : "Trading interest vanished and never returned.",
    };
  }
  return {
    code: "UNDETERMINED",
    title: "Undetermined",
    detail: "Price history is too thin to establish how it died.",
  };
}

function headlineFor(c: Condition, score?: number, daysDead?: number, lowerBound = false): string {
  switch (c) {
    case "DEAD":
      return daysDead && daysDead > 0 ? `Clinically dead for ${daysDead}${lowerBound ? "+" : ""} days` : "Clinically dead";
    case "CRITICAL":
      return "Critical: barely breathing";
    case "FADING":
      return "Fading, but still has a pulse";
    case "ALIVE":
      return "Alive and trading";
    default:
      return score === undefined ? "Not enough evidence" : "Undetermined";
  }
}

export function isoDay(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

export const CONDITION_COPY: Record<Condition, { label: string; short: string }> = {
  ALIVE: { label: "Alive", short: "Has a pulse" },
  FADING: { label: "Fading", short: "Weak pulse" },
  CRITICAL: { label: "Critical", short: "Barely breathing" },
  DEAD: { label: "Dead", short: "No pulse" },
  UNKNOWN: { label: "Unknown", short: "Not enough evidence" },
};
