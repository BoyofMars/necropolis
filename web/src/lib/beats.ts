/** Beat generators for the Pulse trace (pure, usable on server and client). */

/**
 * Absolute scale, so a dead coin looks dead next to a live one:
 * under $100/day is a flatline, $1M/day is a full beat (log in between).
 */
export function beatsFromVolumes(volumes: number[], take = 48): number[] {
  return volumes.slice(-take).map((x) => (x < 100 ? 0 : Math.min(1, (Math.log10(x) - 2) / 4)));
}

export function syntheticBeats(state: "dead" | "stirring" | "alive" | "risen", n = 32, seed = 7): number[] {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: n }, (_, i) => {
    if (state === "dead") return r() < 0.04 ? 0.06 : 0;
    if (state === "stirring") return i > n * 0.55 ? (r() < 0.55 ? 0.25 + r() * 0.45 : 0.03) : r() < 0.08 ? 0.1 : 0;
    if (state === "risen") return 0.55 + r() * 0.45;
    return 0.35 + r() * 0.5;
  });
}
