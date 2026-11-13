/**
 * One clock for picture and sound. 120 BPM: a beat is 0.5 s, a bar is 2 s.
 * Every scene starts on a bar (or half bar), and the music is written
 * against the same bars, so cuts land on the beat.
 */
export const FPS = 60;
export const BPM = 120;
export const BEAT = 60 / BPM; // 0.5 s
export const BAR = BEAT * 4; // 2 s
export const W = 1920;
export const H = 1080;

export const bar = (b: number) => b * BAR; // seconds
export const f = (seconds: number) => Math.round(seconds * FPS); // frames

/** Scenes, in bars. */
export const SCENES = {
  cold: [0, 3], // heartbeat → "Dead." flatline
  stat: [3, 5], // the scale of it, riser into the drop
  logo: [5, 7], // DROP: NECROPOLIS
  promise: [7, 9], // bury it · if it comes back · 80% back
  bury: [9, 20], // real burial on production, one take
  near: [20, 30], // why NEAR: vault · verify · market · no NEAR wallet
  rise: [30, 34], // the rite → RISEN (impact at 32) → 80 / 20
  bones: [34, 38], // $BONES: mint · burn · pay
  accounts: [38, 42], // graves are accounts; sold mid-payout; REFUSED ×4 (bar 40)
  proof: [42, 46], // judge desk 11/11, locked
  montage: [46, 49], // scan · obituary · candles · crypt
  cta: [49, 55], // try it, no wallet · link · built at NEAR HACKATHON
} as const satisfies Record<string, readonly [number, number]>;

export type SceneName = keyof typeof SCENES;
export const TOTAL_BARS = 55;
export const DURATION = bar(TOTAL_BARS); // 110 s
export const TOTAL_FRAMES = f(DURATION);

/** Sound moments the picture hits. */
export const CUES = {
  flatline: 4.0, // "Dead."
  drop: bar(5),
  graveMinted: bar(18),
  risen: bar(32),
  refused: [bar(40), bar(40) + BEAT, bar(40) + 2 * BEAT, bar(40) + 3 * BEAT],
  ticks: Array.from({ length: 11 }, (_, i) => bar(42) + 1.0 + i * 0.25),
  finalHit: bar(53),
  heartbeatReturns: bar(54),
};
