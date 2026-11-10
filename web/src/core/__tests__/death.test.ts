import { describe, expect, it } from "vitest";
import { diagnose, logScaleDead, peakRollingVolume } from "../death";
import type { Candle, TokenDossier, VitalSigns } from "../vitals";

const DAY = 86_400;
const NOW = 1_800_000_000; // fixed clock
const today = Math.floor(NOW / DAY) * DAY;

function series(days: number, fn: (i: number) => Partial<Candle>): Candle[] {
  return Array.from({ length: days }, (_, i) => {
    const c = { t: today - (days - 1 - i) * DAY, o: 1, h: 1, l: 1, c: 1, v: 0, ...fn(i) };
    return c as Candle;
  });
}

const sv = <T>(value: T) => ({ value, source: "dexscreener" as const, observedAt: NOW * 1000 });

function dossier(history: Candle[], vitals: VitalSigns, createdDaysAgo?: number): TokenDossier {
  return {
    profile: {
      ref: { chain: "sol", address: "x" },
      name: "Test",
      symbol: "TEST",
      createdAt: createdDaysAgo !== undefined ? (today - createdDaysAgo * DAY) * 1000 : undefined,
    },
    vitals,
    history,
    fetchedAt: NOW * 1000,
    gaps: [],
  };
}

describe("death classification", () => {
  it("pronounces a rugged, abandoned token dead", () => {
    const h = series(120, (i) => (i < 20 ? { c: 1, v: 400_000 } : i === 20 ? { c: 0.01, v: 900_000 } : { c: 0.008, v: i % 9 === 0 ? 20 : 0 }));
    const d = diagnose(dossier(h, { liquidityUsd: sv(420), volume24hUsd: sv(0), trades24h: sv(1), priceUsd: sv(0.008) }, 120), { now: NOW });
    expect(d.condition).toBe("DEAD");
    expect(d.deathScore).toBeGreaterThanOrEqual(80);
    expect(d.cause.code).toBe("SUDDEN_COLLAPSE");
    expect(d.timeOfDeath).toBeDefined();
    expect(d.daysDead).toBeGreaterThan(90);
  });

  it("refuses to call a low-cap but actively traded token dead (activity floor)", () => {
    // -99.6% from peak, $1.2k liquidity, volume a sliver of its peak: dead on paper…
    const h = series(90, (i) => ({ c: i < 10 ? 1 : 0.004, v: i < 10 ? 2_000_000 : 1_200 }));
    // …but 80 real traders a day are still showing up.
    const d = diagnose(dossier(h, { liquidityUsd: sv(1_200), volume24hUsd: sv(1_100), traders24h: sv(80), priceUsd: sv(0.004) }, 90), { now: NOW });
    expect(d.condition).toBe("FADING");
    expect(d.notes.join(" ")).toMatch(/Activity floor/);
  });

  it("says 'not enough evidence' instead of guessing", () => {
    const d = diagnose(dossier([], { priceUsd: sv(0.001) }), { now: NOW });
    expect(d.condition).toBe("UNKNOWN");
    expect(d.deathScore).toBeUndefined();
  });

  it("does not invent a time of death when history starts after launch", () => {
    // 180-day window, token launched 400 days ago, already flat the entire window
    const h = series(180, () => ({ c: 0.0001, v: 3 }));
    const d = diagnose(dossier(h, { liquidityUsd: sv(90), volume24hUsd: sv(0), trades24h: sv(0), priceUsd: sv(0.0001) }, 400), { now: NOW });
    expect(d.historyTruncated).toBe(true);
    expect(d.deadBeforeRecords).toBe(true);
    expect(d.timeOfDeath).toBeUndefined();
    expect(d.headline).toMatch(/\d+\+ days/);
    expect(d.cause.title).toMatch(/before our records/);
  });

  it("fast-path: no liquidity and a month without trades is death even without history", () => {
    const h = series(60, (i) => ({ c: 0.5, v: i < 20 ? 10_000 : 0 }));
    const d = diagnose(dossier(h, { liquidityUsd: sv(200), volume24hUsd: sv(0), trades24h: sv(0) }, 60), { now: NOW });
    expect(d.condition).toBe("DEAD");
    expect(d.notes.join(" ")).toMatch(/Fast-path/);
  });

  it("log-scale anchors behave at the edges", () => {
    expect(logScaleDead(50_000, 50_000, 1_000)).toBe(0);
    expect(logScaleDead(1_000, 50_000, 1_000)).toBe(1);
    expect(logScaleDead(0, 50_000, 1_000)).toBe(1);
    const mid = logScaleDead(Math.sqrt(50_000 * 1_000), 50_000, 1_000);
    expect(mid).toBeCloseTo(0.5, 5);
  });

  it("peak rolling volume uses a 7-day average", () => {
    const h = series(14, (i) => ({ v: i === 7 ? 7_000 : 0 }));
    expect(peakRollingVolume(h)).toBeCloseTo(1_000, 5);
  });
});
