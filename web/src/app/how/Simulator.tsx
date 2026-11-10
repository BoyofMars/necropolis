"use client";

import { useMemo, useState } from "react";
import { cx } from "@/components/ui";
import { SCENARIOS, simulate } from "@/core/simulation";

// Validated with the dataviz palette checker against the dark surface #121110.
const OWNERS = "#c97d1e";
const OSSUARY = "#3fa585";

const k = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`);

export function Simulator() {
  const [key, setKey] = useState("base");
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const s = SCENARIOS.find((x) => x.key === key)!;
  const res = useMemo(() => simulate(s, { seed: 42 }), [s]);
  const W = 720;
  const H = 240;
  const pad = { l: 56, r: 92, t: 12, b: 28 };
  const max = Math.max(1, ...res.days.map((d) => Math.max(d.ownersUsd, d.ossuaryUsd)));
  const x = (day: number) => pad.l + ((day - 1) / (res.days.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = (f: (d: (typeof res.days)[number]) => number) => res.days.map((d, i) => `${i ? "L" : "M"}${x(d.day).toFixed(1)} ${y(f(d)).toFixed(1)}`).join(" ");
  const last = res.days[res.days.length - 1];
  const h = hover !== null ? res.days[hover] : null;
  const t = res.totals;

  return (
    <div className="rounded-[16px] border border-line bg-loam-1 p-5">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Scenario">
        {SCENARIOS.map((x) => (
          <button
            key={x.key}
            role="radio"
            aria-checked={key === x.key}
            onClick={() => setKey(x.key)}
            className={cx("rounded-full border px-3 py-1.5 text-sm", key === x.key ? "border-bone-3 bg-loam-3 text-bone" : "border-line text-bone-3 hover:text-bone")}
          >
            {x.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-bone-3">{s.blurb}</p>

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Plots risen", `${t.risings} of ${t.plots}`],
          ["False dawns caught", `${t.falseDawns}`],
          ["Returned to owners", k(t.ownersUsd)],
          ["Shared by the ossuary", k(t.ossuaryUsd)],
        ].map(([a, b]) => (
          <div key={a}>
            <dt className="eyebrow">{a}</dt>
            <dd className="mt-1 font-display text-2xl text-bone tabular">{b}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-bone-3" aria-hidden>
        <span className="flex items-center gap-2"><span className="h-0.5 w-5 rounded" style={{ background: OWNERS }} />Returned to owners (80%)</span>
        <span className="flex items-center gap-2"><span className="h-0.5 w-5 rounded" style={{ background: OSSUARY }} />Shared via the ossuary (18%)</span>
        <span className="ml-auto text-bone-4">cumulative USD at revived prices · 60 days</span>
      </div>

      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label={`${s.label}: after 60 days ${k(last.ownersUsd)} returned to owners and ${k(last.ossuaryUsd)} shared through the ossuary; ${t.falseDawns} fake pumps ended as false dawns.`}
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (res.days.length - 1));
            setHover(Math.max(0, Math.min(res.days.length - 1, i)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" strokeWidth="1" />
              <text x={pad.l - 8} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="var(--bone-4)">{k(max * f)}</text>
            </g>
          ))}
          {[1, 15, 30, 45, 60].map((d) => (
            <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--bone-4)">day {d}</text>
          ))}
          <path d={path((d) => d.ownersUsd)} fill="none" stroke={OWNERS} strokeWidth="2" strokeLinejoin="round" />
          <path d={path((d) => d.ossuaryUsd)} fill="none" stroke={OSSUARY} strokeWidth="2" strokeLinejoin="round" />
          {t.risings > 0 && (
            <>
              <text x={W - pad.r + 8} y={y(last.ownersUsd) + 4} fontSize="11" fill="var(--bone-2)">owners</text>
              <text x={W - pad.r + 8} y={Math.min(H - pad.b, y(last.ossuaryUsd) + 4 + (Math.abs(y(last.ownersUsd) - y(last.ossuaryUsd)) < 14 ? 14 : 0))} fontSize="11" fill="var(--bone-2)">ossuary</text>
            </>
          )}
          {t.risings === 0 && (
            <text x={(W - pad.r + pad.l) / 2} y={H / 2} textAnchor="middle" fontSize="13" fill="var(--bone-3)">
              Nothing rose. Nothing was paid. Every grave keeps resting.
            </text>
          )}
          {h && (
            <g>
              <line x1={x(h.day)} x2={x(h.day)} y1={pad.t} y2={H - pad.b} stroke="var(--bone-4)" />
              <circle cx={x(h.day)} cy={y(h.ownersUsd)} r="4" fill={OWNERS} stroke="var(--loam-1)" strokeWidth="2" />
              <circle cx={x(h.day)} cy={y(h.ossuaryUsd)} r="4" fill={OSSUARY} stroke="var(--loam-1)" strokeWidth="2" />
            </g>
          )}
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute top-2 rounded-[8px] border border-line-strong bg-loam-2 px-3 py-2 text-xs shadow-lg"
            style={{ left: `${Math.min(70, (x(h.day) / W) * 100)}%` }}
            role="status"
          >
            <div className="font-semibold text-bone">Day {h.day}</div>
            <div className="mt-1 flex items-center gap-2 text-bone-2"><span className="h-2 w-2 rounded-full" style={{ background: OWNERS }} />Owners {k(h.ownersUsd)}</div>
            <div className="flex items-center gap-2 text-bone-2"><span className="h-2 w-2 rounded-full" style={{ background: OSSUARY }} />Ossuary {k(h.ossuaryUsd)}</div>
            <div className="text-bone-3">{h.risen} risen · {h.falseDawns} false dawns</div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-bone-4">
        <span>
          {t.graves.toLocaleString()} graves · {k(t.buriedUsd)} buried at burial prices · {t.gravesPaid.toLocaleString()} graves received something
          {t.gravesPaid > 0 && ` (median ${k(t.medianPaidGraveUsd)})`}. Seed 42; illustrative, not a forecast.
        </span>
        <button className="text-ember hover:underline" onClick={() => setTable((v) => !v)} aria-expanded={table}>
          {table ? "Hide" : "Show"} data table
        </button>
      </div>
      {table && (
        <div className="mt-3 max-h-64 overflow-auto rounded-[10px] border border-line">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-loam-2 text-bone-3">
              <tr>
                <th className="px-3 py-2">Day</th>
                <th className="px-3 py-2 text-right">To owners</th>
                <th className="px-3 py-2 text-right">Via ossuary</th>
                <th className="px-3 py-2 text-right">Risen</th>
                <th className="px-3 py-2 text-right">False dawns</th>
              </tr>
            </thead>
            <tbody>
              {res.days.filter((d) => d.day % 5 === 0 || d.day === 1).map((d) => (
                <tr key={d.day} className="border-t border-line text-bone-2">
                  <td className="px-3 py-1.5">{d.day}</td>
                  <td className="px-3 py-1.5 text-right tabular">{k(d.ownersUsd)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{k(d.ossuaryUsd)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{d.risen}</td>
                  <td className="px-3 py-1.5 text-right tabular">{d.falseDawns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
