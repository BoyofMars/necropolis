export function usd(n: number | null | undefined, opts: { precise?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  if (a >= 1) return `$${n.toFixed(opts.precise ? 2 : 0)}`;
  if (a === 0) return "$0";
  if (a >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(2)}`;
}

export function price(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.0001) return `$${n.toFixed(6).replace(/0+$/, "")}`;
  return `$${n.toPrecision(3)}`;
}

export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString(undefined, { maximumFractionDigits: a < 1 ? 6 : 2 });
}

/** Raw integer token amount → human string. */
export function tokenAmount(raw: string | bigint, decimals: number): string {
  const v = typeof raw === "bigint" ? raw : BigInt(raw || "0");
  const s = Number(v) / 10 ** decimals;
  return compact(s);
}

export function date(tsSecs: number | string | null | undefined): string {
  if (tsSecs === null || tsSecs === undefined) return "—";
  const t = Number(tsSecs);
  return new Date(t * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ago(tsSecs: number | string): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(tsSecs));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function graveNo(id: number): string {
  return `Nº ${String(id).padStart(6, "0")}`;
}
