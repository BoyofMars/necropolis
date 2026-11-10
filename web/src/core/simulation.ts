/**
 * 60-day cemetery simulation. Same payout rules as the contract:
 * risen plot → 80% to its owners, 20% tithe → 10% of tithe upkeep, rest shared
 * pro rata by weight among graves resting in *other* plots at that moment.
 * Fake pumps are modelled as observation streaks that break before the window
 * completes (false dawns), which is what the rite does to wash trading.
 */

export interface Scenario {
  key: string;
  label: string;
  blurb: string;
  /** probability a plot begins a genuine, sustained revival on a given day */
  genuineDaily: number;
  /** probability a plot gets a fake pump (wash trading) on a given day */
  fakeDaily: number;
  /** revived price multiple vs burial (min..max) */
  revivalMultiple: [number, number];
}

export const SCENARIOS: Scenario[] = [
  { key: "graveyard", label: "Graveyard", blurb: "Nothing ever comes back. The honest base case for most dead coins.", genuineDaily: 0, fakeDaily: 0, revivalMultiple: [1, 1] },
  { key: "base", label: "Rare revivals", blurb: "About 1 in 150 plots stages a real recovery within 60 days.", genuineDaily: 0.0001, fakeDaily: 0.002, revivalMultiple: [6, 40] },
  { key: "summer", label: "Memecoin summer", blurb: "Community takeovers everywhere: about 4% of plots recover.", genuineDaily: 0.0007, fakeDaily: 0.004, revivalMultiple: [8, 80] },
  { key: "attack", label: "Wash-trading attack", blurb: "Bots fake pumps on 15% of plots to trigger payouts. Same genuine rate as rare revivals.", genuineDaily: 0.0001, fakeDaily: 0.03, revivalMultiple: [6, 40] },
];

export interface SimResult {
  days: { day: number; ownersUsd: number; ossuaryUsd: number; upkeepUsd: number; falseDawns: number; risen: number }[];
  totals: {
    graves: number;
    plots: number;
    buriedUsd: number;
    risings: number;
    falseDawns: number;
    ownersUsd: number;
    ossuaryUsd: number;
    upkeepUsd: number;
    gravesPaid: number;
    medianPaidGraveUsd: number;
  };
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface G { plot: number; weight: number; valueUsd: number; buriedDay: number; received: number }
interface P { id: number; risen: boolean; stirringUntil: number | null; fake: boolean; graves: number[] }

export function simulate(s: Scenario, opts: { seed?: number; plots?: number; days?: number; windowDays?: number } = {}): SimResult {
  const r = rng(opts.seed ?? 42);
  const days = opts.days ?? 60;
  const windowDays = opts.windowDays ?? 14;
  const plots: P[] = [];
  const graves: G[] = [];
  const nPlots = opts.plots ?? 300;
  const lognorm = (mu: number, sigma: number) => Math.exp(mu + sigma * Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()));

  const bury = (plot: number, day: number) => {
    const value = Math.min(2_000, lognorm(Math.log(40), 1.1));
    graves.push({ plot, weight: value, valueUsd: value, buriedDay: day, received: 0 });
    plots[plot].graves.push(graves.length - 1);
  };
  for (let i = 0; i < nPlots; i++) {
    plots.push({ id: i, risen: false, stirringUntil: null, fake: false, graves: [] });
    const n = 1 + Math.floor(lognorm(Math.log(6), 0.9));
    for (let k = 0; k < n; k++) bury(i, 0);
  }

  const out: SimResult["days"] = [];
  let ownersUsd = 0, ossuaryUsd = 0, upkeepUsd = 0, falseDawns = 0, risings = 0;
  for (let day = 1; day <= days; day++) {
    // new burials
    const arrivals = Math.floor(lognorm(Math.log(25), 0.4));
    for (let k = 0; k < arrivals; k++) {
      const p = Math.floor(r() * plots.length);
      if (!plots[p].risen && plots[p].stirringUntil === null) bury(p, day);
    }
    let dayFalse = 0, dayRisen = 0, dayOwners = 0, dayOssuary = 0, dayUpkeep = 0;
    for (const p of plots) {
      if (p.risen) continue;
      if (p.stirringUntil === null) {
        if (r() < s.genuineDaily * 1) {
          p.stirringUntil = day + windowDays;
          p.fake = false;
        } else if (r() < s.fakeDaily) {
          // wash pumps last 1–5 days, then the next honest observation fails
          p.stirringUntil = day + 1 + Math.floor(r() * 5);
          p.fake = true;
        }
        continue;
      }
      if (day < p.stirringUntil) continue;
      if (p.fake) {
        // the rite catches it: wash ratio / flagged volume / broken streak
        p.stirringUntil = null;
        p.fake = false;
        dayFalse++;
        continue;
      }
      // genuine rising
      p.risen = true;
      p.stirringUntil = null;
      dayRisen++;
      const mult = s.revivalMultiple[0] + r() * (s.revivalMultiple[1] - s.revivalMultiple[0]);
      const plotValue = p.graves.reduce((t, gi) => t + graves[gi].valueUsd, 0) * mult;
      const tithe = plotValue * 0.2;
      const upkeep = tithe * 0.1;
      const pool = tithe - upkeep;
      dayOwners += plotValue - tithe;
      for (const gi of p.graves) graves[gi].received += graves[gi].valueUsd * mult * 0.8;
      const resting = graves.filter((g) => !plots[g.plot].risen && g.buriedDay < day);
      const W = resting.reduce((t, g) => t + g.weight, 0);
      if (W > 0) {
        for (const g of resting) g.received += (pool * g.weight) / W;
        dayOssuary += pool;
        dayUpkeep += upkeep;
      } else dayUpkeep += tithe;
    }
    ownersUsd += dayOwners;
    ossuaryUsd += dayOssuary;
    upkeepUsd += dayUpkeep;
    falseDawns += dayFalse;
    risings += dayRisen;
    out.push({ day, ownersUsd, ossuaryUsd, upkeepUsd, falseDawns, risen: risings });
  }
  const paid = graves.filter((g) => g.received > 0).map((g) => g.received).sort((a, b) => a - b);
  return {
    days: out,
    totals: {
      graves: graves.length,
      plots: plots.length,
      buriedUsd: graves.reduce((t, g) => t + g.valueUsd, 0),
      risings,
      falseDawns,
      ownersUsd,
      ossuaryUsd,
      upkeepUsd,
      gravesPaid: paid.length,
      medianPaidGraveUsd: paid.length ? paid[Math.floor(paid.length / 2)] : 0,
    },
  };
}
