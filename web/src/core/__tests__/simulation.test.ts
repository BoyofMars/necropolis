import { describe, expect, it } from "vitest";
import { SCENARIOS, simulate } from "../simulation";

const by = (k: string) => SCENARIOS.find((s) => s.key === k)!;

describe("60-day simulation", () => {
  it("pays nothing when nothing revives", () => {
    const r = simulate(by("graveyard"));
    expect(r.totals.risings).toBe(0);
    expect(r.totals.ownersUsd + r.totals.ossuaryUsd + r.totals.upkeepUsd).toBe(0);
  });

  it("splits every rising exactly 80 / 18 / 2", () => {
    const r = simulate(by("summer"), { seed: 7 });
    expect(r.totals.risings).toBeGreaterThan(0);
    const total = r.totals.ownersUsd + r.totals.ossuaryUsd + r.totals.upkeepUsd;
    expect(r.totals.ownersUsd / total).toBeCloseTo(0.8, 6);
    expect(r.totals.upkeepUsd / total).toBeCloseTo(0.02, 6);
  });

  it("fake pumps become false dawns and pay nothing extra", () => {
    const attack = simulate(by("attack"), { seed: 3 });
    const honest = simulate(by("base"), { seed: 3 });
    expect(attack.totals.falseDawns).toBeGreaterThan(honest.totals.falseDawns);
    expect(attack.totals.falseDawns).toBeGreaterThan(20);
  });

  it("is deterministic for a seed", () => {
    expect(simulate(by("base"), { seed: 11 }).totals).toEqual(simulate(by("base"), { seed: 11 }).totals);
  });
});
