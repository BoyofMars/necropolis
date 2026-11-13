/**
 * The soundtrack, synthesised from nothing: no samples, no licences.
 * 120 BPM, A minor (Am · F · C · G). Written against src/timeline.ts so the
 * picture's cuts land on the music's hits.
 *
 *   npx tsx music/compose.ts  →  public/music.wav (48 kHz, 16-bit stereo)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BAR, BEAT, CUES, DURATION, SCENES, bar } from "../src/timeline";

const SR = 48_000;
const N = Math.round(DURATION * SR);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- buses
const dryL = new Float32Array(N);
const dryR = new Float32Array(N);
const pumpL = new Float32Array(N); // ducked by the kick (bass, pads)
const pumpR = new Float32Array(N);
const rev = new Float32Array(N); // mono send to the reverb
const dlyL = new Float32Array(N); // send to the ping-pong delay
const dlyR = new Float32Array(N);
const duck = new Float32Array(N).fill(1);

// ---------------------------------------------------------------- tools
let seed = 0x9e3779b9;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const noise = () => rnd() * 2 - 1;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Zavalishin TPT state-variable filter. */
class SVF {
  private ic1 = 0;
  private ic2 = 0;
  run(x: number, fc: number, q = 0.707): { lp: number; bp: number; hp: number } {
    const g = Math.tan((Math.PI * Math.min(fc, SR * 0.45)) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return { lp: v2, bp: v1, hp: x - k * v1 - v2 };
  }
}

const polyblep = (t: number, dt: number) => {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
};

/** Write a mono signal into a stereo bus with equal-power pan (-1..1). */
function put(L: Float32Array, R: Float32Array, i: number, v: number, pan = 0) {
  if (i < 0 || i >= N) return;
  const a = ((pan + 1) * Math.PI) / 4;
  L[i] += v * Math.cos(a);
  R[i] += v * Math.sin(a);
}
const at = (t: number) => Math.round(t * SR);

// ---------------------------------------------------------------- instruments
const kicks: number[] = [];

function kick(t0: number, gain = 1) {
  kicks.push(t0);
  const len = at(0.5);
  let ph = 0;
  const s0 = at(t0);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 46 + (135 - 46) * Math.exp(-t / 0.032);
    ph += (TAU * f) / SR;
    const amp = t < 0.012 ? 1 : Math.exp(-(t - 0.012) / 0.17);
    let v = Math.sin(ph) * amp;
    if (t < 0.006) v += noise() * 0.35 * (1 - t / 0.006);
    put(dryL, dryR, s0 + i, Math.tanh(v * 1.6) * 0.62 * gain);
  }
}

function clap(t0: number, gain = 1) {
  const f = new SVF();
  const s0 = at(t0);
  const len = at(0.32);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let env = 0;
    for (const o of [0, 0.011, 0.023]) if (t >= o && t < o + 0.008) env = Math.max(env, 1 - (t - o) / 0.008);
    if (t >= 0.03) env = Math.max(env, 0.8 * Math.exp(-(t - 0.03) / 0.085));
    const v = f.run(noise(), 1450, 0.9).bp * env * 0.55 * gain;
    put(dryL, dryR, s0 + i, v, 0.05);
    rev[s0 + i] += v * 0.35;
  }
}

function snare(t0: number, gain = 1) {
  const f = new SVF();
  const s0 = at(t0);
  const len = at(0.22);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += (TAU * 190) / SR;
    const v = (f.run(noise(), 1800).hp * 0.7 * Math.exp(-t / 0.07) + Math.sin(ph) * 0.45 * Math.exp(-t / 0.04)) * 0.42 * gain;
    put(dryL, dryR, s0 + i, v);
    rev[s0 + i] += v * 0.25;
  }
}

function hat(t0: number, open = false, gain = 1) {
  const f = new SVF();
  const s0 = at(t0);
  const len = at(open ? 0.32 : 0.07);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const v = f.run(noise(), 8200, 0.8).hp * Math.exp(-t / (open ? 0.11 : 0.022)) * (open ? 0.16 : 0.13) * gain;
    put(dryL, dryR, s0 + i, v, open ? 0.25 : -0.2);
  }
}

function crash(t0: number, gain = 1) {
  const fl = new SVF();
  const fr = new SVF();
  const s0 = at(t0);
  const len = at(2.8);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.exp(-t / 0.85) * Math.min(1, t / 0.002);
    const l = fl.run(noise(), 5200).hp * env * 0.2 * gain;
    const r = fr.run(noise(), 5200).hp * env * 0.2 * gain;
    if (s0 + i < N) {
      dryL[s0 + i] += l;
      dryR[s0 + i] += r;
      rev[s0 + i] += (l + r) * 0.2;
    }
  }
}

function impact(t0: number, gain = 1) {
  const f = new SVF();
  const s0 = at(t0);
  const len = at(1.8);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const fr = 34 + 46 * Math.exp(-t / 0.25);
    ph += (TAU * fr) / SR;
    const v = (Math.sin(ph) * Math.exp(-t / 0.55) * 0.75 + f.run(noise(), 900).lp * Math.exp(-t / 0.12) * 0.6) * gain;
    put(dryL, dryR, s0 + i, Math.tanh(v * 1.4) * 0.6);
    rev[s0 + i] += v * 0.25;
  }
}

/** Filtered noise that rises into a hit. */
function riser(t0: number, dur: number, gain = 1) {
  const f = new SVF();
  const s0 = at(t0);
  const len = at(dur);
  for (let i = 0; i < len; i++) {
    const k = i / len;
    const fc = 300 * (9000 / 300) ** k;
    const v = f.run(noise(), fc, 2.2).bp * k * k * 0.32 * gain;
    put(dryL, dryR, s0 + i, v, Math.sin(k * TAU * 2) * 0.4);
    rev[s0 + i] += v * 0.3;
  }
}

function snareRoll(t0: number, dur: number, gain = 1) {
  let t = 0;
  while (t < dur) {
    const k = t / dur;
    snare(t0 + t, (0.25 + 0.75 * k) * gain);
    t += k < 0.5 ? BEAT / 2 : k < 0.8 ? BEAT / 4 : BEAT / 8;
  }
}

function whoosh(t0: number, dur = 0.7, gain = 1) {
  const f = new SVF();
  const s0 = at(t0 - dur * 0.6);
  const len = at(dur);
  for (let i = 0; i < len; i++) {
    const k = i / len;
    const env = Math.sin(Math.PI * k) ** 2;
    const v = f.run(noise(), 500 * (4500 / 500) ** k, 1.4).bp * env * 0.3 * gain;
    put(dryL, dryR, s0 + i, v, -0.8 + 1.6 * k);
    rev[s0 + i] += v * 0.2;
  }
}

function bassNote(t0: number, dur: number, midi: number, gain = 1) {
  const f = new SVF();
  const s0 = at(t0);
  const len = at(dur + 0.03);
  const fr = hz(midi);
  const dt = fr / SR;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph = (ph + dt) % 1;
    const saw = 2 * ph - 1 - polyblep(ph, dt);
    const sub = Math.sin(ph * TAU);
    const env = Math.min(1, t / 0.004) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.03) : 1);
    const v = (f.run(saw * 0.6 + sub * 0.8, 170 + 650 * Math.exp(-t / 0.05), 1.1).lp) * env * 0.5 * gain;
    put(pumpL, pumpR, s0 + i, v);
  }
}

/** Three detuned saws per note, slow attack, low-passed: the bed. */
function pad(t0: number, dur: number, notes: number[], gain = 1, cutoff = 1500) {
  const s0 = at(t0);
  const rel = 0.7;
  const len = at(dur + rel);
  notes.forEach((m, ni) => {
    [-0.09, 0, 0.09].forEach((det, vi) => {
      const f = new SVF();
      const fr = hz(m + det);
      const dt = fr / SR;
      let ph = rnd();
      const pan = (vi - 1) * 0.65 + (ni - 1) * 0.1;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        ph = (ph + dt) % 1;
        const saw = 2 * ph - 1 - polyblep(ph, dt);
        const env = Math.min(1, t / 0.28) * (t > dur ? Math.max(0, 1 - (t - dur) / rel) : 1);
        const v = f.run(saw, cutoff * (1 + 0.15 * Math.sin(TAU * 0.25 * (t0 + t))), 0.8).lp * env * 0.045 * gain;
        put(pumpL, pumpR, s0 + i, v, pan);
        rev[s0 + i] += v * 0.35;
      }
    });
  });
}

function pluck(t0: number, midi: number, pan: number, gain = 1, bright = 1) {
  const f = new SVF();
  const s0 = at(t0);
  const len = at(0.3);
  const fr = hz(midi);
  const dt = fr / SR;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph = (ph + dt) % 1;
    const saw = 2 * ph - 1 - polyblep(ph, dt);
    const sq = ph < 0.5 ? 1 : -1;
    const v = f.run(saw * 0.6 + sq * 0.25, 500 + 2800 * bright * Math.exp(-t / 0.09), 1.2).lp * Math.exp(-t / 0.1) * 0.13 * gain;
    put(dryL, dryR, s0 + i, v, pan);
    put(dlyL, dlyR, s0 + i, v * 0.45, pan);
    rev[s0 + i] += v * 0.12;
  }
}

/** Hospital monitor: a clean sine beep, or a held flatline. */
function beep(t0: number, dur = 0.09, gain = 1) {
  const s0 = at(t0);
  const len = at(dur + 0.03);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.003) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.03) : 1);
    const v = (Math.sin(TAU * 960 * t) + 0.12 * Math.sin(TAU * 1920 * t)) * env * 0.2 * gain;
    put(dryL, dryR, s0 + i, v);
    rev[s0 + i] += v * 0.25;
  }
}

function flatline(t0: number, dur: number, gain = 1) {
  const s0 = at(t0);
  const len = at(dur);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.01) * Math.min(1, (dur - t) / 0.7);
    const v = (Math.sin(TAU * 960 * t) + 0.1 * Math.sin(TAU * 1920 * t)) * env * 0.17 * gain;
    put(dryL, dryR, s0 + i, v);
    rev[s0 + i] += v * 0.2;
  }
}

function tick(t0: number, gain = 1) {
  const s0 = at(t0);
  const len = at(0.07);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const v = Math.sin(TAU * 2350 * t) * Math.exp(-t / 0.014) * 0.16 * gain;
    put(dryL, dryR, s0 + i, v, 0.15);
    rev[s0 + i] += v * 0.2;
  }
}

function stamp(t0: number, gain = 1) {
  const f = new SVF();
  const s0 = at(t0);
  const len = at(0.45);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += (TAU * (62 + 40 * Math.exp(-t / 0.03))) / SR;
    const v = (Math.sin(ph) * Math.exp(-t / 0.13) + f.run(noise(), 2400).lp * Math.exp(-t / 0.018) * 0.9) * 0.62 * gain;
    put(dryL, dryR, s0 + i, Math.tanh(v * 1.5) * 0.7);
    rev[s0 + i] += v * 0.3;
  }
}

// ---------------------------------------------------------------- harmony
const A = 45; // A2
const CHORDS = {
  Am: { bass: 33, pad: [57, 60, 64], arp: [69, 72, 76, 81] },
  F: { bass: 29, pad: [53, 57, 60], arp: [65, 69, 72, 77] },
  C: { bass: 36, pad: [55, 60, 64], arp: [67, 72, 76, 79] },
  G: { bass: 31, pad: [55, 59, 62], arp: [67, 71, 74, 79] },
};
const PROG = [CHORDS.Am, CHORDS.F, CHORDS.C, CHORDS.G];
const chordAt = (b: number) => (b < 5 ? (b < 4 ? CHORDS.Am : CHORDS.F) : PROG[(Math.floor(b) - 5) % 4]);

const inRange = (b: number, [s, e]: readonly [number, number]) => b >= s && b < e;
const groove = (b: number) => (b >= 5 && b < 42) || (b >= 44 && b < 53);
const fullBass = (b: number) => groove(b) && !(b >= 44 && b < 46);
const arpOn = (b: number) => (b >= 13 && b < 53 && !inRange(b, [30, 32])) || inRange(b, [30, 32]);

// ---------------------------------------------------------------- arrangement
// Cold open: a pulse that slows, then flatlines on "Dead."
for (const t of [0.15, 0.95, 1.75, 2.6, 3.45]) beep(t, 0.09, 1);
flatline(CUES.flatline, 2.0);
pad(0, 6, [A - 12, A - 5, A], 0.55, 700);

// The scale of it: a low hit, then the riser into the drop.
impact(bar(3), 0.45);
pad(bar(3), BAR, CHORDS.Am.pad, 0.6, 900);
pad(bar(4), BAR, CHORDS.F.pad, 0.7, 1100);
riser(bar(4), BAR, 1);
snareRoll(bar(4) + BEAT * 2, BEAT * 2, 0.7);

for (let b = 5; b < 53; b++) {
  const t = bar(b);
  const ch = chordAt(b);
  const breakdown = b >= 42 && b < 44;
  pad(t, BAR, ch.pad, breakdown ? 0.75 : b >= 46 ? 1.05 : 0.9, breakdown ? 1100 : b >= 30 && b < 32 ? 900 + (b - 30) * 1400 : 1700);

  if (groove(b)) {
    for (let k = 0; k < 4; k++) {
      kick(t + k * BEAT, b >= 44 && b < 46 && k % 2 === 1 ? 0.7 : 1);
      hat(t + k * BEAT + BEAT / 2, k === 3, 1);
    }
    if (!(b >= 44 && b < 46)) {
      clap(t + BEAT, 1);
      clap(t + 3 * BEAT, 1);
    }
    if (b >= 13) for (let s = 0; s < 16; s++) if (s % 2 === 1 || s % 4 === 0) hat(t + s * (BEAT / 4), false, s % 4 === 0 ? 0.35 : 0.55);
  }
  if (fullBass(b)) for (let k = 0; k < 4; k++) bassNote(t + k * BEAT + BEAT / 2, BEAT * 0.42, ch.bass, 1);
  if (arpOn(b)) {
    const pattern = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 3, 2, 1, 2];
    const gain = breakdown ? 0.7 : 1;
    const bright = b >= 30 && b < 32 ? 0.4 + (b - 30) * 0.5 : 1;
    for (let s = 0; s < 16; s++) pluck(t + s * (BEAT / 4), ch.arp[pattern[s]], s % 2 ? 0.35 : -0.35, gain, bright);
  }
}

// Hits and transitions the picture cuts on.
impact(CUES.drop, 1);
crash(CUES.drop, 1);
riser(bar(8) + BEAT * 2, BEAT * 2, 0.6);
crash(bar(9), 0.8); // into the burial
crash(CUES.graveMinted, 0.9);
impact(CUES.graveMinted, 0.55);
riser(bar(19), BAR, 0.8);
crash(bar(20), 0.9);
for (const b of [22.5, 25, 27.5]) whoosh(bar(b), 0.7, 0.9);
riser(bar(30), 2 * BAR, 1.1); // the rite, filling
snareRoll(bar(31), BAR, 0.8);
impact(CUES.risen, 1.1);
crash(CUES.risen, 1.1);
crash(bar(SCENES.bones[0]), 0.8);
crash(bar(SCENES.accounts[0]), 0.8);
for (const t of CUES.refused) stamp(t, 1);
crash(bar(SCENES.proof[0]), 0.6);
for (const t of CUES.ticks) tick(t, 1);
riser(bar(45), BAR, 0.9);
snareRoll(bar(45) + BEAT * 2, BEAT * 2, 0.8);
impact(bar(SCENES.montage[0]), 0.8);
crash(bar(SCENES.montage[0]), 1);
for (const b of [46.5, 47, 47.5, 48, 48.5]) whoosh(bar(b), 0.45, 0.6);
riser(bar(48) + BEAT * 2, BEAT * 2, 0.6);
crash(bar(SCENES.cta[0]), 0.9);
riser(bar(52), BAR, 0.9);
snareRoll(bar(52) + BEAT * 2, BEAT * 2, 0.7);

// The end: one big chord, silence, then the heartbeat comes back.
impact(CUES.finalHit, 1.2);
crash(CUES.finalHit, 1.1);
kick(CUES.finalHit, 1.2);
pad(CUES.finalHit, BAR * 0.8, [...CHORDS.Am.pad, 69], 1.2, 2200);
bassNote(CUES.finalHit, 1.2, 33, 1.1);
beep(CUES.heartbeatReturns, 0.09, 1.1);
beep(CUES.heartbeatReturns + 0.8, 0.09, 1.1);

// ---------------------------------------------------------------- sidechain
for (const k of kicks) {
  const s0 = at(k);
  for (let i = 0; i < at(0.32); i++) {
    const t = i / SR;
    const g = 1 - 0.6 * Math.exp(-t / 0.085) * Math.min(1, t / 0.004 + 0.3);
    if (s0 + i < N) duck[s0 + i] = Math.min(duck[s0 + i], g);
  }
}

// ---------------------------------------------------------------- effects
/** Ping-pong delay, dotted eighth. */
const dly = Math.round(BEAT * 0.75 * SR);
const outDL = new Float32Array(N);
const outDR = new Float32Array(N);
{
  const lpL = new SVF();
  const lpR = new SVF();
  for (let i = 0; i < N; i++) {
    const fbL = i >= dly ? outDR[i - dly] : 0;
    const fbR = i >= dly ? outDL[i - dly] : 0;
    outDL[i] = lpL.run(dlyL[i] + fbL * 0.42, 3500).lp;
    outDR[i] = lpR.run(dlyR[i] + fbL * 0 + fbR * 0.42, 3500).lp;
  }
}

/** Freeverb: 8 combs + 4 allpasses per side. */
function freeverb(input: Float32Array, spread: number): Float32Array {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => Math.round(((n + spread) * SR) / 44100));
  const aps = [556, 441, 341, 225].map((n) => Math.round(((n + spread) * SR) / 44100));
  const out = new Float32Array(N);
  const feedback = 0.86;
  const damp = 0.3;
  const cb = combs.map((n) => ({ buf: new Float32Array(n), i: 0, store: 0 }));
  const ab = aps.map((n) => ({ buf: new Float32Array(n), i: 0 }));
  for (let s = 0; s < N; s++) {
    const x = input[s] * 0.015;
    let acc = 0;
    for (const c of cb) {
      const y = c.buf[c.i];
      c.store = y * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * feedback;
      c.i = (c.i + 1) % c.buf.length;
      acc += y;
    }
    for (const a of ab) {
      const b = a.buf[a.i];
      const y = -acc + b;
      a.buf[a.i] = acc + b * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      acc = y;
    }
    out[s] = acc;
  }
  return out;
}
const revL = freeverb(rev, 0);
const revR = freeverb(rev, 23);

// ---------------------------------------------------------------- master
const L = new Float32Array(N);
const R = new Float32Array(N);
let peak = 0;
const hpL = new SVF();
const hpR = new SVF();
for (let i = 0; i < N; i++) {
  let l = dryL[i] + pumpL[i] * duck[i] + revL[i] * 2.2 + outDL[i] * 0.9;
  let r = dryR[i] + pumpR[i] * duck[i] + revR[i] * 2.2 + outDR[i] * 0.9;
  l = hpL.run(l, 28).hp; // no sub-sonic rumble
  r = hpR.run(r, 28).hp;
  // Gentle glue: soft saturation.
  l = Math.tanh(l * 1.15) / 1.15;
  r = Math.tanh(r * 1.15) / 1.15;
  L[i] = l;
  R[i] = r;
  peak = Math.max(peak, Math.abs(l), Math.abs(r));
}
const norm = 0.89 / peak; // -1 dBFS
// Fade the last few milliseconds so it ends clean.
const fade = at(0.05);
for (let i = 0; i < fade; i++) {
  const g = i / fade;
  L[N - 1 - i] *= g;
  R[N - 1 - i] *= g;
}

// ---------------------------------------------------------------- report + write
function rmsDb(from: number, to: number) {
  let s = 0;
  const a = at(from);
  const b = Math.min(N, at(to));
  for (let i = a; i < b; i++) s += (L[i] * norm) ** 2 + (R[i] * norm) ** 2;
  return (10 * Math.log10(s / (2 * Math.max(1, b - a)))).toFixed(1);
}
for (const [name, [s, e]] of Object.entries(SCENES)) console.log(`${name.padEnd(9)} ${rmsDb(bar(s), bar(e)).padStart(6)} dB RMS`);

const data = Buffer.alloc(44 + N * 4);
data.write("RIFF", 0);
data.writeUInt32LE(36 + N * 4, 4);
data.write("WAVE", 8);
data.write("fmt ", 12);
data.writeUInt32LE(16, 16);
data.writeUInt16LE(1, 20);
data.writeUInt16LE(2, 22);
data.writeUInt32LE(SR, 24);
data.writeUInt32LE(SR * 4, 28);
data.writeUInt16LE(4, 32);
data.writeUInt16LE(16, 34);
data.write("data", 36);
data.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * norm * 32767))), 44 + i * 4);
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * norm * 32767))), 46 + i * 4);
}
mkdirSync(join(__dirname, "..", "public"), { recursive: true });
const out = join(__dirname, "..", "public", "music.wav");
writeFileSync(out, data);
console.log(`\nwrote ${out} (${DURATION} s, peak normalised to -1 dBFS)`);
