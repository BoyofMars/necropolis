import { describe, expect, it } from "vitest";
import { leftLine, obituaryOf, risenLine, type ObituaryEntry } from "@/core/obituary";

const e = (symbol: string, condition: ObituaryEntry["diagnosis"]["condition"], deathScore?: number, valueUsd?: number): ObituaryEntry => ({
  address: symbol,
  symbol,
  valueUsd,
  diagnosis: { condition, deathScore },
});

describe("wallet obituary", () => {
  const entries = [e("ALIVE1", "ALIVE", 10, 500), e("RUG", "DEAD", 99, 0.4), e("COPE", "CRITICAL", 72, 12.5), e("BLEED", "DEAD", 88, 30), e("MEH", "FADING", 40, 5)];

  it("counts the departed, deadest first, and sums only what they're worth today", () => {
    const o = obituaryOf("owner", entries);
    expect(o.departed.map((d) => d.symbol)).toEqual(["RUG", "BLEED", "COPE"]);
    expect([o.dead, o.critical, o.survivors, o.total]).toEqual([2, 1, 2, 5]);
    expect(o.leftUsd).toBeCloseTo(42.9);
    expect(o.headline).toBe("Here lie 3 coins.");
    expect(leftLine(o)).toBe("$42.90 left between them.");
  });

  it("moves a coin whose plot rose out of the departed", () => {
    const withRisen = [...entries, { ...e("NGMI", "DEAD", 86, 9000), risen: true }];
    const o = obituaryOf("owner", withRisen);
    expect(o.departed.map((d) => d.symbol)).toEqual(["RUG", "BLEED", "COPE"]);
    expect(o.leftUsd).toBeCloseTo(42.9);
    expect(risenLine(o)).toBe("1 came back: $NGMI.");
    expect(risenLine(obituaryOf("owner", entries))).toBeNull();
  });

  it("says the same epitaph for the same wallet every time", () => {
    expect(obituaryOf("wallet-A", entries).epitaph).toBe(obituaryOf("wallet-A", entries).epitaph);
  });

  it("handles one corpse, worthless corpses and a healthy wallet", () => {
    expect(obituaryOf("x", [e("RUG", "DEAD", 99, 0.2)]).headline).toBe("Here lies 1 coin.");
    expect(leftLine(obituaryOf("x", [e("RUG", "DEAD", 99, 0.2)]))).toBe("Less than a dollar left in it.");
    expect(leftLine(obituaryOf("x", [e("A", "DEAD", 99), e("B", "DEAD", 90)]))).toBe("Nothing left between them.");
    const healthy = obituaryOf("x", [e("OK", "ALIVE", 5, 100)]);
    expect(healthy.headline).toBe("Everyone made it.");
    expect(leftLine(healthy)).toBe("1 token, all still breathing.");
  });
});
