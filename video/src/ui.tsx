import type { CSSProperties, ReactNode } from "react";
import { Ease, clamp, keys, lerp, ramp, rand, spring } from "./kit";

export const C = {
  bg: "#090706",
  ink: "#f6f1e6",
  ink2: "#cfc6b4",
  ink3: "#8e8676",
  ember: "#ff9a2e",
  emberHi: "#ffd08a",
  emberDeep: "#e0640f",
  mint: "#33e8a6",
  mintHi: "#a6ffde",
  violet: "#8f6bff",
  magenta: "#ff4d8d",
  danger: "#ff4b42",
  sky: "#4db8ff",
  sol: "#a35bff",
  base: "#2f6bff",
};

export const F = {
  display: "'Cormorant Garamond', Georgia, serif",
  sans: "'Hanken Grotesk', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

export const fill: CSSProperties = { position: "absolute", inset: 0 };

/** Moving colour fields. `mix` picks a palette; palettes cross-fade by weight. */
export type Palette = [string, string, string];
export function Background({ T, palette, intensity = 1 }: { T: number; palette: Palette; intensity?: number }) {
  const [a, b, c] = palette;
  const x1 = 30 + 18 * Math.sin(T * 0.21);
  const y1 = 35 + 14 * Math.cos(T * 0.17);
  const x2 = 72 + 16 * Math.cos(T * 0.15 + 1);
  const y2 = 62 + 18 * Math.sin(T * 0.19 + 2);
  const x3 = 50 + 30 * Math.sin(T * 0.11 + 4);
  const y3 = 90 + 10 * Math.cos(T * 0.13);
  return (
    <div
      style={{
        ...fill,
        background: `radial-gradient(42% 52% at ${x1}% ${y1}%, ${a}${hexA(0.55 * intensity)} 0%, transparent 70%),
          radial-gradient(40% 50% at ${x2}% ${y2}%, ${b}${hexA(0.5 * intensity)} 0%, transparent 70%),
          radial-gradient(60% 40% at ${x3}% ${y3}%, ${c}${hexA(0.45 * intensity)} 0%, transparent 70%),
          ${C.bg}`,
      }}
    />
  );
}

export const hexA = (a: number) =>
  Math.round(clamp(a) * 255)
    .toString(16)
    .padStart(2, "0");

let grainUrl = "";
function grainTexture() {
  if (grainUrl) return grainUrl;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rand(i) * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainUrl = c.toDataURL();
  return grainUrl;
}

export function Grain({ frame, opacity = 0.07 }: { frame: number; opacity?: number }) {
  const ox = Math.floor(rand(`gx${frame}`) * 256);
  const oy = Math.floor(rand(`gy${frame}`) * 256);
  return (
    <div
      style={{
        ...fill,
        backgroundImage: `url(${grainTexture()})`,
        backgroundPosition: `${ox}px ${oy}px`,
        mixBlendMode: "overlay",
        opacity,
        pointerEvents: "none",
      }}
    />
  );
}

export function Vignette({ strength = 0.75 }: { strength?: number }) {
  return <div style={{ ...fill, background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${strength}) 100%)`, pointerEvents: "none" }} />;
}

/** Words rise out of masks, one after another. */
export function Words({
  text,
  t,
  at = 0,
  stagger = 0.06,
  dur = 0.55,
  style,
  wordStyle,
  out,
  color,
}: {
  text: string;
  t: number;
  at?: number;
  stagger?: number;
  dur?: number;
  style?: CSSProperties;
  wordStyle?: (i: number, word: string) => CSSProperties | undefined;
  out?: number;
  color?: string;
}) {
  const words = text.split(" ");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: "0.24em", ...style }}>
      {words.map((w, i) => {
        const k = ramp(t, at + i * stagger, at + i * stagger + dur, Ease.outQuint);
        const o = out !== undefined ? ramp(t, out + i * stagger * 0.5, out + i * stagger * 0.5 + 0.3, Ease.inCubic) : 0;
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: "0.08em", marginBottom: "-0.08em" }}>
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${(1 - k) * 105 - o * 105}%) rotate(${(1 - k) * 6}deg)`,
                opacity: k * (1 - o),
                color,
                ...wordStyle?.(i, w),
              }}
            >
              {w}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Letters that slam in from big and blurred to sharp. */
export function Slam({ text, t, at = 0, stagger = 0.035, style }: { text: string; t: number; at?: number; stagger?: number; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", ...style }}>
      {[...text].map((ch, i) => {
        const lt = t - at - i * stagger;
        const s = spring(lt, { stiffness: 260, damping: 18 });
        const blur = (1 - clamp(lt / 0.18)) * 18;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `scale(${lerp(2.4, 1, s)}) translateY(${(1 - s) * -20}px)`,
              opacity: clamp(lt / 0.08),
              filter: blur > 0.2 ? `blur(${blur}px)` : undefined,
              whiteSpace: "pre",
            }}
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
}

/** Spring pop-in (and optional fade-out). */
export function Pop({ t, at = 0, children, from = 0.5, out, style, origin = "center" }: { t: number; at?: number; children: ReactNode; from?: number; out?: number; style?: CSSProperties; origin?: string }) {
  const s = spring(t - at, { stiffness: 220, damping: 15 });
  const o = out !== undefined ? ramp(t, out, out + 0.3, Ease.inCubic) : 0;
  return (
    <div style={{ transform: `scale(${lerp(from, 1, s) * (1 - o * 0.2)})`, opacity: clamp((t - at) / 0.12) * (1 - o), transformOrigin: origin, ...style }}>{children}</div>
  );
}

export function FadeUp({ t, at = 0, dur = 0.6, dist = 40, children, out, style }: { t: number; at?: number; dur?: number; dist?: number; children: ReactNode; out?: number; style?: CSSProperties }) {
  const k = ramp(t, at, at + dur, Ease.outQuint);
  const o = out !== undefined ? ramp(t, out, out + 0.35, Ease.inCubic) : 0;
  return <div style={{ transform: `translateY(${(1 - k) * dist - o * dist * 0.5}px)`, opacity: k * (1 - o), filter: k < 1 ? `blur(${(1 - k) * 8}px)` : undefined, ...style }}>{children}</div>;
}

export function Chip({ children, color = C.ember, style, dot = true }: { children: ReactNode; color?: string; style?: CSSProperties; dot?: boolean }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 22px",
        borderRadius: 999,
        background: `linear-gradient(180deg, ${color}2e, ${color}14)`,
        border: `1.5px solid ${color}88`,
        color: C.ink,
        fontFamily: F.sans,
        fontWeight: 700,
        fontSize: 26,
        letterSpacing: "-0.01em",
        boxShadow: `0 0 40px ${color}33, inset 0 1px 0 ${color}55`,
        backdropFilter: "blur(8px)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot && <span style={{ width: 12, height: 12, borderRadius: 99, background: color, boxShadow: `0 0 14px ${color}` }} />}
      {children}
    </div>
  );
}

export function Counter({ t, at, dur, from = 0, to, format }: { t: number; at: number; dur: number; from?: number; to: number; format: (n: number) => string }) {
  const k = ramp(t, at, at + dur, Ease.outExpo);
  return <>{format(lerp(from, to, k))}</>;
}

/** Gradient-filled headline text. */
export function Grad({ children, from = C.emberHi, to = C.ember, style }: { children: ReactNode; from?: string; to?: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        backgroundImage: `linear-gradient(180deg, ${from}, ${to})`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** A hospital-monitor trace that scrolls; spikes at `beats`, flat after `flatAt`. */
export function ECG({
  T,
  beats,
  flatAt = Infinity,
  width = 1920,
  height = 260,
  color = C.mint,
  span = 3.2,
  headX = 0.72,
  amp = 1,
}: {
  T: number;
  beats: number[];
  flatAt?: number;
  width?: number;
  height?: number;
  color?: string;
  span?: number;
  headX?: number;
  amp?: number;
}) {
  const y = (time: number) => {
    if (time >= flatAt) return 0;
    let v = 0;
    for (const b of beats) {
      const d = time - b;
      if (d < -0.12 || d > 0.4) continue;
      if (d < -0.04) v += -6 * Math.sin(((d + 0.12) / 0.08) * Math.PI); // P
      else if (d < -0.015) v += 0;
      else if (d < 0.0) v += 14 * ((d + 0.015) / 0.015); // Q
      else if (d < 0.025) v += lerp(14, -88, d / 0.025); // R up
      else if (d < 0.05) v += lerp(-88, 28, (d - 0.025) / 0.025); // S
      else if (d < 0.07) v += lerp(28, 0, (d - 0.05) / 0.02);
      else if (d > 0.16 && d < 0.32) v += -16 * Math.sin(((d - 0.16) / 0.16) * Math.PI); // T
    }
    return v * amp;
  };
  const pts: string[] = [];
  const hx = width * headX;
  const step = 2;
  for (let x = 0; x <= hx; x += step) {
    const time = T - ((hx - x) / hx) * span;
    pts.push(`${x.toFixed(1)},${(height / 2 + y(time)).toFixed(1)}`);
  }
  const headY = height / 2 + y(T);
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="ecgfade" x1="0" x2="1">
          <stop offset="0" stopColor={color} stopOpacity="0" />
          <stop offset="0.55" stopColor={color} stopOpacity="0.55" />
          <stop offset="1" stopColor={color} stopOpacity="1" />
        </linearGradient>
        <filter id="ecgglow" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <polyline points={pts.join(" ")} fill="none" stroke="url(#ecgfade)" strokeWidth={4} strokeLinejoin="round" filter="url(#ecgglow)" />
      <circle cx={hx} cy={headY} r={9} fill={C.ink} filter="url(#ecgglow)" />
      <circle cx={hx} cy={headY} r={22} fill={color} opacity={0.25} />
    </svg>
  );
}

/** Ember particles drifting up; `burst` sends them outward from the centre at a time. */
export function Embers({ T, count = 40, burstAt, seed = "e", color = C.ember, area = { w: 1920, h: 1080 } }: { T: number; count?: number; burstAt?: number; seed?: string; color?: string; area?: { w: number; h: number } }) {
  return (
    <div style={{ ...fill, pointerEvents: "none" }}>
      {Array.from({ length: count }, (_, i) => {
        const r1 = rand(`${seed}${i}a`);
        const r2 = rand(`${seed}${i}b`);
        const r3 = rand(`${seed}${i}c`);
        const size = 2 + r3 * 5;
        let x: number;
        let y: number;
        let o: number;
        if (burstAt !== undefined && T >= burstAt) {
          const bt = T - burstAt;
          const ang = r1 * Math.PI * 2;
          const sp = 300 + r2 * 900;
          const k = 1 - Math.exp(-bt * 2.2);
          x = area.w / 2 + Math.cos(ang) * sp * k;
          y = area.h / 2 + Math.sin(ang) * sp * k - bt * 40;
          o = Math.max(0, 1 - bt / (1.4 + r3));
        } else {
          const speed = 30 + r2 * 60;
          x = r1 * area.w + Math.sin(T * (0.5 + r3) + i) * 30;
          y = area.h - (((T * speed + r3 * area.h) % (area.h + 100)) - 50);
          o = 0.25 + 0.6 * r3;
        }
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: 99,
              background: color,
              boxShadow: `0 0 ${size * 3}px ${color}`,
              opacity: o,
            }}
          />
        );
      })}
    </div>
  );
}

export const shade = (t: number, a: number, b: number) => keys(t, [a, b], [0, 1]);
