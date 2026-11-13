import type { CSSProperties, ReactNode } from "react";
import { clamp, keys } from "./kit";
import { C, F } from "./ui";

export type ClipMeta = { clip: string; duration: number; frames: [string, number][]; marks: { name: string; t: number }[] };
declare global {
  interface Window {
    __META: Record<string, ClipMeta>;
  }
}

const meta = (clip: string) => {
  const m = window.__META?.[clip];
  if (!m) throw new Error(`no footage: ${clip}`);
  return m;
};

/** Seconds into a clip where a named moment happened. */
export const mark = (clip: string, name: string, fallback = 0) => meta(clip).marks.find((m) => m.name === name)?.t ?? fallback;
export const clipDuration = (clip: string) => meta(clip).duration;

/** The captured frame showing at `t` seconds into the clip. */
export function frameUrl(clip: string, t: number) {
  const f = meta(clip).frames;
  let lo = 0;
  let hi = f.length - 1;
  const tt = clamp(t, 0, meta(clip).duration);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (f[mid][1] <= tt) lo = mid;
    else hi = mid - 1;
  }
  return `/footage-raw/${clip}/${f[lo][0]}`;
}

/** Play clip time a→b over d seconds of video, segment after segment. */
export type Seg = { a: number; b: number; d: number };
export function remap(t: number, segs: Seg[]) {
  let acc = 0;
  for (const s of segs) {
    if (t <= acc + s.d) return s.a + (s.b - s.a) * clamp((t - acc) / s.d);
    acc += s.d;
  }
  return segs[segs.length - 1].b;
}
export const segsDuration = (segs: Seg[]) => segs.reduce((a, s) => a + s.d, 0);

export function Footage({ clip, t, style }: { clip: string; t: number; style?: CSSProperties }) {
  return <img src={frameUrl(clip, t)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", ...style }} />;
}

/** A camera over a 16:9 surface: centre (cx, cy in 0..1) and zoom, keyframed. */
export type Shot = { t: number; cx: number; cy: number; z: number };
export function Camera({ t, shots, w, h, children }: { t: number; shots: Shot[]; w: number; h: number; children: ReactNode }) {
  const times = shots.map((s) => s.t);
  const z = keys(t, times, shots.map((s) => s.z));
  const cx = clamp(keys(t, times, shots.map((s) => s.cx)), 0.5 / z, 1 - 0.5 / z);
  const cy = clamp(keys(t, times, shots.map((s) => s.cy)), 0.5 / z, 1 - 0.5 / z);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transformOrigin: "0 0", transform: `translate(${w / 2 - cx * w * z}px, ${h / 2 - cy * h * z}px) scale(${z})` }}>
        {children}
      </div>
    </div>
  );
}

function Lock({ color = C.ink2 }: { color?: string }) {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16">
      <rect x="1" y="7" width="12" height="8.5" rx="2" fill={color} />
      <path d="M3.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

/** A browser window around 16:9 footage. */
export function Browser({ url, width, children, glow = C.ember, style }: { url: string; width: number; children: ReactNode; glow?: string; style?: CSSProperties }) {
  const h = (width * 9) / 16;
  return (
    <div
      style={{
        width,
        borderRadius: 20,
        overflow: "hidden",
        background: "#15110f",
        boxShadow: `0 60px 140px rgba(0,0,0,.65), 0 0 0 1.5px rgba(255,255,255,.09), 0 0 120px ${glow}30`,
        ...style,
      }}
    >
      <div style={{ height: 50, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", background: "linear-gradient(180deg,#221d19,#1a1613)", borderBottom: "1px solid #2c2621" }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 14, height: 14, borderRadius: 99, background: c, opacity: 0.9 }} />
        ))}
        <div
          style={{
            flex: 1,
            margin: `0 ${width * 0.16}px`,
            height: 32,
            borderRadius: 9,
            background: "#0e0b0a",
            border: "1px solid #2c2621",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            fontFamily: F.mono,
            fontSize: 17,
            color: C.ink2,
          }}
        >
          <Lock />
          {url}
        </div>
      </div>
      <div style={{ width, height: h, position: "relative", overflow: "hidden", background: "#0c0b0a" }}>{children}</div>
    </div>
  );
}

/** A phone around portrait footage (390×844 CSS). */
export function Phone({ width = 420, children, glow = C.mint, style }: { width?: number; children: ReactNode; glow?: string; style?: CSSProperties }) {
  const h = (width * 844) / 390;
  const bez = 14;
  return (
    <div
      style={{
        width: width + bez * 2,
        height: h + bez * 2,
        borderRadius: 64,
        padding: bez,
        background: "linear-gradient(145deg,#3a3430,#141110)",
        boxShadow: `0 60px 140px rgba(0,0,0,.7), 0 0 0 2px #4a433d, 0 0 100px ${glow}33`,
        ...style,
      }}
    >
      <div style={{ width, height: h, borderRadius: 52, overflow: "hidden", position: "relative", background: "#0c0b0a" }}>
        {children}
        <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", width: 120, height: 34, borderRadius: 20, background: "#000" }} />
      </div>
    </div>
  );
}
