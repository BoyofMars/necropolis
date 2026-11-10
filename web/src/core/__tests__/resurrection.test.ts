import { describe, expect, it } from "vitest";
import { MAINNET_TERMS, TESTNET_TERMS, advance, checkObservation, passes, requiredMcap, requiredVolume, type Observation, type PlotState } from "../resurrection";

const base = { baselineMcapUsd: 40_000, peakDailyVolumeUsd: 900_000 };
const alive = (t: number): Observation => ({
  t,
  priceUsd: 1,
  marketCapUsd: 2_000_000,
  liquidityUsd: 120_000,
  volume24hUsd: 400_000,
  traders24h: 450,
  flaggedShareBps: 500,
  sources: 2,
});

describe("the rite (mirror of contract/src/rite.rs)", () => {
  it("scales volume and market-cap requirements from the burial baseline", () => {
    expect(requiredVolume(MAINNET_TERMS, base)).toBe(90_000);
    expect(requiredMcap(MAINNET_TERMS, base)).toBe(250_000);
    expect(requiredMcap(MAINNET_TERMS, { ...base, baselineMcapUsd: 1_000_000 })).toBe(5_000_000);
  });

  it("rejects a 100x pump from dust with thin liquidity and few traders", () => {
    const o: Observation = { ...alive(1), liquidityUsd: 8_000, volume24hUsd: 30_000, marketCapUsd: 400_000, traders24h: 30 };
    expect(passes(MAINNET_TERMS, base, o)).toBe(false);
    const failing = checkObservation(MAINNET_TERMS, base, o).filter((c) => !c.pass).map((c) => c.key);
    expect(failing).toEqual(expect.arrayContaining(["liquidity", "volume", "traders"]));
  });

  it("rejects wash-traded volume", () => {
    expect(passes(MAINNET_TERMS, base, { ...alive(1), volume24hUsd: 3_000_000, liquidityUsd: 100_000 })).toBe(false);
    expect(passes(MAINNET_TERMS, base, { ...alive(1), flaggedShareBps: 3_500 })).toBe(false);
    expect(passes(MAINNET_TERMS, base, { ...alive(1), sources: 1 })).toBe(false);
  });

  it("rises only after a sustained window with enough observations", () => {
    let s: PlotState = { kind: "RESTING", falseDawns: 0 };
    s = advance(TESTNET_TERMS, base, s, alive(1_000));
    expect(s.kind).toBe("STIRRING");
    s = advance(TESTNET_TERMS, base, s, alive(1_150));
    s = advance(TESTNET_TERMS, base, s, alive(1_300));
    expect(s.kind).toBe("STIRRING");
    s = advance(TESTNET_TERMS, base, s, alive(1_400));
    expect(s.kind).toBe("RISEN");
  });

  it("a single bad day is a false dawn", () => {
    let s: PlotState = { kind: "STIRRING", since: 0, lastAt: 0, count: 2, falseDawns: 0 };
    s = advance(TESTNET_TERMS, base, s, { ...alive(100), liquidityUsd: 10 });
    expect(s).toEqual({ kind: "RESTING", falseDawns: 1, lastObservedAt: 100 });
  });

  it("refuses observations that go back in time", () => {
    const s: PlotState = { kind: "RESTING", falseDawns: 0, lastObservedAt: 500 };
    expect(() => advance(TESTNET_TERMS, base, s, alive(400))).toThrow();
  });
});
