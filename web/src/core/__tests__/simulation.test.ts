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

  it("$BONES supply grows with every burial and burns only on a rising", () => {
    const dead = simulate(by("graveyard"));
    expect(dead.totals.bonesBurned).toBe(0);
    expect(dead.totals.bonesSupply).toBeCloseTo(dead.totals.buriedUsd, 6); // 1 BONES per $1
    expect(dead.totals.earnedPerBones).toBe(0);
    const summer = simulate(by("summer"), { seed: 7 });
    expect(summer.totals.bonesBurned).toBeGreaterThan(0);
    expect(summer.totals.bonesSupply).toBeCloseTo(summer.totals.bonesMinted - summer.totals.bonesBurned, 6);
    // supply only drops on days with a rising
    for (let i = 1; i < summer.days.length; i++) {
      const [a, b] = [summer.days[i - 1], summer.days[i]];
      if (b.bonesBurned > a.bonesBurned) expect(b.risen).toBeGreaterThan(a.risen);
    }
    expect(summer.totals.earnedPerBones).toBeGreaterThan(0);
  });

  it("is deterministic for a seed", () => {
    expect(simulate(by("base"), { seed: 11 }).totals).toEqual(simulate(by("base"), { seed: 11 }).totals);
  });
});
