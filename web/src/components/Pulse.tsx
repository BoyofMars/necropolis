"use client";

import { useId, useMemo } from "react";

/**
 * The vital-signs trace. Each beat is one day; its height is that day's
 * trading volume on a log scale. A dead token literally flatlines.
 */
export function beatsFromVolumes(volumes: number[], take = 48): number[] {
  const v = volumes.slice(-take);
  const max = Math.max(1, ...v);
  return v.map((x) => (x <= 1 ? 0 : Math.log10(1 + x) / Math.log10(1 + max)));
}

export function syntheticBeats(state: "dead" | "stirring" | "alive" | "risen", n = 32, seed = 7): number[] {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) => {
    if (state === "dead") return r() < 0.04 ? 0.06 : 0;
    if (state === "stirring") return i > n * 0.55 ? (r() < 0.55 ? 0.25 + r() * 0.45 : 0.03) : r() < 0.08 ? 0.1 : 0;
    if (state === "risen") return 0.55 + r() * 0.45;
    return 0.35 + r() * 0.5;
  });
}

function tracePath(beats: number[], w: number, h: number): string {
  const mid = h * 0.58;
  const seg = w / Math.max(1, beats.length);
  let d = `M0 ${mid.toFixed(2)}`;
  beats.forEach((a, i) => {
    const x = i * seg;
    const p = (f: number, dy: number) => `L${(x + f * seg).toFixed(2)} ${(mid + dy * h).toFixed(2)}`;
    if (a < 0.02) {
      d += ` ${p(0.5, 0)} ${p(1, 0)}`;
      return;
    }
    d += [
      p(0.28, 0),
      p(0.34, -0.07 * a),
      p(0.4, 0),
      p(0.46, 0.06 * a),
      p(0.51, -0.52 * a),
      p(0.56, 0.2 * a),
      p(0.61, 0),
      p(0.74, -0.1 * a),
      p(0.84, 0),
      p(1, 0),
    ].join(" ");
  });
  return d;
}

export function Pulse({
  beats,
  width = 640,
  height = 96,
  color = "var(--bone-3)",
  glow,
  animate = true,
  scan = false,
  className,
  label,
}: {
  beats: number[];
  width?: number;
  height?: number;
  color?: string;
  glow?: boolean;
  animate?: boolean;
  scan?: boolean;
  className?: string;
  label?: string;
}) {
  const id = useId().replace(/:/g, "");
  const d = useMemo(() => tracePath(beats, width, height), [beats, width, height]);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label={label ?? "Vital signs trace"}
    >
      <defs>
        <linearGradient id={`fade-${id}`} x1="0" x2="1">
          <stop offset="0" stopColor={color} stopOpacity="0" />
          <stop offset="0.12" stopColor={color} stopOpacity="0.9" />
          <stop offset="1" stopColor={color} stopOpacity="1" />
        </linearGradient>
        {glow && (
          <filter id={`glow-${id}`} x="-10%" y="-50%" width="120%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      <line x1="0" x2={width} y1={height * 0.58} y2={height * 0.58} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 6" />
      <path
        d={d}
        fill="none"
        stroke={`url(#fade-${id})`}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        filter={glow ? `url(#glow-${id})` : undefined}
        style={
          animate
            ? { strokeDasharray: 1, strokeDashoffset: 1, animation: "pulse-draw 2.4s var(--ease-out) forwards" }
            : undefined
        }
      />
      {scan && (
        <circle r="2.6" fill={color} filter={glow ? `url(#glow-${id})` : undefined}>
          <animateMotion dur="5s" repeatCount="indefinite" path={d} />
        </circle>
      )}
      <style>{`@keyframes pulse-draw { to { stroke-dashoffset: 0; } }`}</style>
    </svg>
  );
}
