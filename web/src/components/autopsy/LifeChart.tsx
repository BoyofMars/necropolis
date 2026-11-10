"use client";

import { useMemo, useState } from "react";
import type { Candle } from "@/core/vitals";

const fmtP = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toPrecision(3)}`);
const fmtD = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });

/**
 * Log-scale price line with volume bars beneath; ATH and time of death marked.
 * Accessible: a summary is provided for screen readers via aria-label.
 */
export function LifeChart({
  history,
  athAt,
  timeOfDeath,
  height = 260,
  athLabel = "ATH",
}: {
  history: Candle[];
  athAt?: number;
  timeOfDeath?: number;
  height?: number;
  athLabel?: string;
}) {
  const W = 900;
  const H = height;
  const priceH = H * 0.72;
  const [hover, setHover] = useState<number | null>(null);
  const geo = useMemo(() => {
    const pts = history.filter((d) => d.c > 0);
    if (pts.length < 2) return null;
    const lo = Math.log10(Math.min(...pts.map((d) => d.c)));
    const hi = Math.log10(Math.max(...pts.map((d) => d.c)));
    const span = Math.max(1e-9, hi - lo);
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
    const y = (p: number) => 12 + (1 - (Math.log10(p) - lo) / span) * (priceH - 24);
    const vmax = Math.max(1, ...pts.map((d) => d.v));
    const line = pts.map((d, i) => `${i ? "L" : "M"}${x(d.t).toFixed(1)} ${y(d.c).toFixed(1)}`).join(" ");
    const area = `${line} L${W} ${priceH} L0 ${priceH} Z`;
    return { pts, x, y, line, area, vmax };
  }, [history, priceH]);

  if (!geo) {
    return (
      <div className="flex h-40 items-center justify-center rounded-[12px] border border-dashed border-line-strong text-sm text-bone-3">
        No price history available for this token.
      </div>
    );
  }
  const { pts, x, y, line, area, vmax } = geo;
  const deathX = timeOfDeath ? x(timeOfDeath) : undefined;
  const athPt = athAt ? pts.find((d) => d.t === athAt) : undefined;
  const h = hover !== null ? pts[hover] : undefined;
  const first = pts[0];
  const last = pts[pts.length - 1];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none"
        role="img"
        aria-label={`Price from ${fmtD(first.t)} (${fmtP(first.c)}) to ${fmtD(last.t)} (${fmtP(last.c)})${athPt ? `, all-time high ${fmtP(athPt.c)} on ${fmtD(athPt.t)}` : ""}.`}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          for (let i = 0; i < pts.length; i++) if (Math.abs(x(pts[i].t) - px) < Math.abs(x(pts[best].t) - px)) best = i;
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="lifefill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--bone-2)" stopOpacity="0.16" />
            <stop offset="1" stopColor="var(--bone-2)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {deathX !== undefined && (
          <rect x={deathX} y={0} width={W - deathX} height={H} fill="rgba(140,134,124,.06)" />
        )}
        <path d={area} fill="url(#lifefill)" />
        <path d={line} fill="none" stroke="var(--bone-2)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        {pts.map((d) => {
          const bh = (Math.log10(1 + d.v) / Math.log10(1 + vmax)) * (H - priceH - 8);
          return <rect key={d.t} x={x(d.t)} y={H - bh} width={Math.max(1, W / pts.length - 1)} height={bh} fill="var(--line-strong)" />;
        })}
        {athPt && (
          <g>
            <circle cx={x(athPt.t)} cy={y(athPt.c)} r="4" fill="var(--ember)" />
            <text x={Math.min(W - 70, x(athPt.t) + 8)} y={Math.max(28, y(athPt.c) + 4)} fill="var(--ember)" fontSize="13" fontFamily="var(--font-ui)">
              {athLabel}
            </text>
          </g>
        )}
        {deathX !== undefined && (
          <g>
            <line x1={deathX} x2={deathX} y1={0} y2={H} stroke="var(--dead)" strokeDasharray="3 4" />
            <text x={Math.min(W - 110, deathX + 6)} y={16} fill="var(--dead)" fontSize="13" fontFamily="var(--font-ui)">
              time of death
            </text>
          </g>
        )}
        {h && (
          <g>
            <line x1={x(h.t)} x2={x(h.t)} y1={0} y2={H} stroke="var(--bone-4)" />
            <circle cx={x(h.t)} cy={y(h.c)} r="3.5" fill="var(--bone)" />
          </g>
        )}
      </svg>
      <div className="mt-2 flex items-center justify-between text-xs text-bone-3 tabular">
        <span>{fmtD(first.t)}</span>
        {h ? (
          <span className="text-bone-2">
            {fmtD(h.t)} · {fmtP(h.c)} · ${Math.round(h.v).toLocaleString()} volume
          </span>
        ) : (
          <span>log price · daily volume</span>
        )}
        <span>{fmtD(last.t)}</span>
      </div>
    </div>
  );
}
