/**
 * A wallet's obituary: what a scan found, in words worth sharing.
 *
 * Only what the scan can stand behind. There's no cost basis, so no "total
 * loss": the obituary counts the dead, names the deadest and sums what they
 * are worth today.
 */
export interface ObituaryEntry {
  address: string;
  symbol: string;
  valueUsd?: number;
  diagnosis: { condition: "DEAD" | "CRITICAL" | "FADING" | "ALIVE" | "UNKNOWN"; deathScore?: number };
  /** its Necropolis plot has risen */
  risen?: boolean;
}

export interface Obituary {
  /** dead or critical, deadest first (never a coin that rose) */
  departed: ObituaryEntry[];
  /** coins that died and came back on Necropolis */
  risen: ObituaryEntry[];
  dead: number;
  critical: number;
  survivors: number;
  total: number;
  /** what the departed are worth today, where priced */
  leftUsd: number;
  headline: string;
  epitaph: string;
}

const EPITAPHS = [
  "They were early. They were also wrong.",
  "Diamond hands, granite headstones.",
  "Bought the top. Held the bottom.",
  "Gone, but the bags remain.",
  "Never sold. Never will.",
  "Conviction, interrupted.",
];

/** Deterministic per wallet, so a shared card always says the same thing. */
function epitaphFor(owner: string, departed: number): string {
  if (departed === 0) return "No deaths on record. Suspiciously healthy.";
  let h = 0;
  for (const c of owner) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return EPITAPHS[h % EPITAPHS.length];
}

export function obituaryOf(owner: string, entries: ObituaryEntry[]): Obituary {
  const risen = entries.filter((e) => e.risen);
  const departed = entries
    .filter((e) => !e.risen && (e.diagnosis.condition === "DEAD" || e.diagnosis.condition === "CRITICAL"))
    .sort((a, b) => (b.diagnosis.deathScore ?? 0) - (a.diagnosis.deathScore ?? 0) || (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const dead = departed.filter((e) => e.diagnosis.condition === "DEAD").length;
  const critical = departed.length - dead;
  const survivors = entries.filter((e) => !e.risen && (e.diagnosis.condition === "ALIVE" || e.diagnosis.condition === "FADING")).length;
  const leftUsd = departed.reduce((s, e) => s + (e.valueUsd ?? 0), 0);
  const n = departed.length;
  const headline = n === 0 ? "Everyone made it." : n === 1 ? "Here lies 1 coin." : `Here lie ${n} coins.`;
  return { departed, risen, dead, critical, survivors, total: entries.length, leftUsd, headline, epitaph: epitaphFor(owner, n) };
}

/** "1 came back: $NGMI." */
export function risenLine(o: Obituary): string | null {
  if (o.risen.length === 0) return null;
  const names = o.risen.slice(0, 3).map((e) => `$${e.symbol}`).join(", ");
  return `${o.risen.length} came back: ${names}${o.risen.length > 3 ? "…" : ""}.`;
}

/** "$41.20 left between them" in words, without pretending to precision. */
export function leftLine(o: Obituary): string {
  if (o.departed.length === 0) return `${o.total} token${o.total === 1 ? "" : "s"}, all still breathing.`;
  const v = o.leftUsd;
  const money = v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : v >= 1 ? `$${v.toFixed(2)}` : v > 0 ? "Less than a dollar" : "Nothing";
  return `${money} left ${o.departed.length === 1 ? "in it" : "between them"}.`;
}
