/**
 * Small server-side fetch toolkit: timeouts, typed JSON, an in-memory TTL
 * cache and per-provider token buckets so we stay inside free-tier limits
 * (GeckoTerminal ~5/min keyless, Jupiter 0.5 rps keyless).
 */

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}

type Entry = { value: unknown; expires: number };
const g = globalThis as unknown as { __bagyardCache?: Map<string, Entry>; __bagyardBuckets?: Map<string, Bucket> };
const cache: Map<string, Entry> = (g.__bagyardCache ??= new Map());

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.value as T;
  const value = await fn();
  cache.set(key, { value, expires: now + ttlMs });
  if (cache.size > 2_000) {
    for (const [k, v] of cache) if (v.expires < now) cache.delete(k);
  }
  return value;
}

interface Bucket {
  tokens: number;
  capacity: number;
  refillPerMs: number;
  last: number;
}
const buckets: Map<string, Bucket> = (g.__bagyardBuckets ??= new Map());

/** Wait for a token from the provider's bucket (or give up after maxWaitMs). */
export async function throttle(provider: string, perMinute: number, maxWaitMs = 8_000): Promise<void> {
  let b = buckets.get(provider);
  if (!b) {
    b = { tokens: perMinute, capacity: perMinute, refillPerMs: perMinute / 60_000, last: Date.now() };
    buckets.set(provider, b);
  }
  const start = Date.now();
  for (;;) {
    const now = Date.now();
    b.tokens = Math.min(b.capacity, b.tokens + (now - b.last) * b.refillPerMs);
    b.last = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    if (now - start > maxWaitMs) throw new ProviderError(provider, "rate limited (local budget exhausted)", 429);
    await new Promise((r) => setTimeout(r, Math.min(1_000, (1 - b.tokens) / b.refillPerMs)));
  }
}

export async function getJson<T>(
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number; revalidate?: number } = {},
): Promise<T> {
  const { timeoutMs = 9_000, revalidate, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...rest,
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "bagyard/0.1", ...(rest.headers ?? {}) },
      ...(revalidate !== undefined ? { next: { revalidate } } : { cache: "no-store" }),
    });
    if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    const msg = (e as Error).name === "AbortError" ? "timed out" : (e as Error).message;
    throw new ProviderError(provider, msg);
  } finally {
    clearTimeout(timer);
  }
}

export async function rpc<T>(provider: string, url: string, method: string, params: unknown[], timeoutMs = 9_000): Promise<T> {
  const body = await getJson<{ result?: T; error?: { message: string } }>(provider, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    timeoutMs,
  });
  if (body.error) throw new ProviderError(provider, body.error.message);
  return body.result as T;
}

/** Settle a list of promises, keeping successes and recording failures as gaps. */
export async function settle<T>(tasks: { label: string; run: () => Promise<T> }[]) {
  const results = await Promise.allSettled(tasks.map((t) => t.run()));
  const ok: Record<string, T> = {};
  const gaps: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") ok[tasks[i].label] = r.value;
    else gaps.push(`${tasks[i].label}: ${(r.reason as Error).message}`);
  });
  return { ok, gaps };
}
