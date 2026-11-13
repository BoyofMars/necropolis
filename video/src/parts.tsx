import type { CSSProperties, ReactNode } from "react";
import { Ease, clamp, lerp, ramp, spring } from "./kit";
import { C, F, Words } from "./ui";

/** Frosted panel. */
export function Card({ children, color = C.ember, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <div
      style={{
        borderRadius: 26,
        padding: "26px 30px",
        background: "linear-gradient(160deg, rgba(40,33,28,.92), rgba(18,14,12,.92))",
        border: `1.5px solid ${color}55`,
        boxShadow: `0 30px 80px rgba(0,0,0,.55), 0 0 60px ${color}22, inset 0 1px 0 rgba(255,255,255,.06)`,
        color: C.ink,
        fontFamily: F.sans,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children, color = C.ink3 }: { children: ReactNode; color?: string }) {
  return <div style={{ fontFamily: F.mono, fontSize: 18, letterSpacing: "0.22em", textTransform: "uppercase", color }}>{children}</div>;
}

/** Big section headline at the top-left, words rising in. */
export function Title({ t, at = 0, text, sub, color = C.ink, out, top = 90, left = 120, size = 92 }: { t: number; at?: number; text: string; sub?: string; color?: string; out?: number; top?: number; left?: number; size?: number }) {
  const o = out !== undefined ? ramp(t, out, out + 0.3, Ease.inCubic) : 0;
  return (
    <div style={{ position: "absolute", left, top, right: 120, opacity: 1 - o, transform: `translateY(${-o * 30}px)` }}>
      <div style={{ fontFamily: F.sans, fontWeight: 800, fontSize: size, letterSpacing: "-0.045em", lineHeight: 1.02, color }}>
        <Words text={text} t={t} at={at} stagger={0.055} style={{ justifyContent: "flex-start" }} />
      </div>
      {sub && (
        <div style={{ marginTop: 18, fontFamily: F.sans, fontWeight: 500, fontSize: 38, letterSpacing: "-0.015em", color: C.ink2, maxWidth: 1300 }}>
          <Words text={sub} t={t} at={at + 0.35} stagger={0.025} dur={0.45} style={{ justifyContent: "flex-start" }} />
        </div>
      )}
    </div>
  );
}

/** A connector that draws itself, then carries pulses from a to b. */
export function Wire({ t, at, x1, y1, x2, y2, color = C.mint, curve = 0, pulses = 3, width = 5, dashed = false }: { t: number; at: number; x1: number; y1: number; x2: number; y2: number; color?: string; curve?: number; pulses?: number; width?: number; dashed?: boolean }) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - curve;
  const d = `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`;
  const k = ramp(t, at, at + 0.6, Ease.inOutCubic);
  const len = Math.hypot(x2 - x1, y2 - y1) * 1.15 + Math.abs(curve);
  const point = (u: number) => {
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    return [a * x1 + b * mx + c * x2, a * y1 + b * my + c * y2];
  };
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={1} height={1}>
      <path d={d} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={width + 8} strokeDasharray={len} strokeDashoffset={len * (1 - k)} strokeLinecap="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dashed ? "14 12" : len} strokeDashoffset={dashed ? -t * 60 : len * (1 - k)} strokeLinecap="round" opacity={dashed ? k : 1} />
      {k >= 1 &&
        Array.from({ length: pulses }, (_, i) => {
          const u = (((t - at - 0.6) * 0.9 + i / pulses) % 1 + 1) % 1;
          const [px, py] = point(u);
          return <circle key={i} cx={px} cy={py} r={9} fill={C.ink} style={{ filter: `drop-shadow(0 0 10px ${color}) drop-shadow(0 0 20px ${color})` }} />;
        })}
    </svg>
  );
}

export function Check({ size = 40, color = C.mint, k = 1 }: { size?: number; color?: string; k?: number }) {
  const len = 30;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="18" fill={`${color}22`} stroke={color} strokeWidth="2.5" opacity={clamp(k * 2)} />
      <path d="M11 21 L17.5 27.5 L29.5 13.5" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={len * (1 - k)} />
    </svg>
  );
}

export function Cross({ size = 40, color = C.danger }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="18" fill={`${color}22`} stroke={color} strokeWidth="2.5" />
      <path d="M13 13 L27 27 M27 13 L13 27" stroke={color} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** A rubber stamp that slams down on the beat. */
export function Stamp({ t, at, text = "REFUSED", color = C.danger, rotate = -8, size = 44 }: { t: number; at: number; text?: string; color?: string; rotate?: number; size?: number }) {
  if (t < at) return null;
  const s = spring(t - at, { stiffness: 520, damping: 22 });
  return (
    <div
      style={{
        display: "inline-block",
        transform: `rotate(${rotate}deg) scale(${lerp(2.6, 1, s)})`,
        opacity: clamp((t - at) / 0.05),
        border: `5px solid ${color}`,
        borderRadius: 12,
        padding: "4px 18px",
        fontFamily: F.sans,
        fontWeight: 900,
        fontSize: size,
        letterSpacing: "0.08em",
        color,
        background: `${color}14`,
        boxShadow: `0 0 30px ${color}55`,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );
}

export function Lock({ size = 64, k = 1, color = C.mint }: { size?: number; k?: number; color?: string }) {
  // k = 0 open shackle, 1 closed.
  const lift = (1 - k) * 14;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ overflow: "visible" }}>
      <path d={`M18 ${30 - lift} V${20 - lift} a14 14 0 0 1 28 0 V${30 - lift * 0.2}`} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
      <rect x="10" y="28" width="44" height="32" rx="7" fill={color} />
      <circle cx="32" cy="42" r="4.5" fill="#0b0907" />
      <rect x="30" y="44" width="4" height="8" rx="2" fill="#0b0907" />
    </svg>
  );
}

export function Mono({ children, color = C.ink2, size = 24, style }: { children: ReactNode; color?: string; size?: number; style?: CSSProperties }) {
  return <span style={{ fontFamily: F.mono, fontSize: size, color, letterSpacing: "-0.01em", ...style }}>{children}</span>;
}

export const short = (s: string, a = 6, b = 6) => (s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);
