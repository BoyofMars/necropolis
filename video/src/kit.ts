/** Motion maths. Everything is a pure function of time, so any frame renders the same way twice. */

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type Easing = (t: number) => number;
export const Ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuart: (t: number) => 1 - (1 - t) ** 4,
  outQuint: (t: number) => 1 - (1 - t) ** 5,
  inOutQuint: (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
  inExpo: (t: number) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutExpo: (t: number) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
};

/** 0 → 1 between t0 and t1, eased, clamped. */
export function ramp(t: number, t0: number, t1: number, ease: Easing = Ease.outCubic) {
  if (t1 <= t0) return t >= t1 ? 1 : 0;
  return ease(clamp((t - t0) / (t1 - t0)));
}

/** Piecewise interpolation through keyframes, eased per segment, clamped at the ends. */
export function keys(t: number, times: number[], values: number[], ease: Easing = Ease.inOutCubic) {
  if (t <= times[0]) return values[0];
  for (let i = 1; i < times.length; i++) {
    if (t <= times[i]) return lerp(values[i - 1], values[i], ease((t - times[i - 1]) / (times[i] - times[i - 1])));
  }
  return values[values.length - 1];
}

/** Damped spring from 0 to 1, started at time 0 (t in seconds). Overshoots when lightly damped. */
export function spring(t: number, { stiffness = 180, damping = 14, mass = 1 } = {}) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

/** Deterministic pseudo-random in [0, 1). */
export function rand(seed: number | string) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h += h << 13;
  h ^= h >>> 7;
  h += h << 3;
  h ^= h >>> 17;
  h += h << 5;
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

/** A visible-window helper: opacity that fades in at a and out at b. */
export function life(t: number, a: number, b: number, fadeIn = 0.25, fadeOut = 0.25) {
  return Math.min(ramp(t, a, a + fadeIn, Ease.outCubic), 1 - ramp(t, b - fadeOut, b, Ease.inCubic));
}

export const fmt = (n: number, digits = 0) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
