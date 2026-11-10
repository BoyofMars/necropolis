"use client";

/**
 * Per-viewer conveniences (watchlist, recently viewed, pasted wallets,
 * preferred chain). localStorage only — never the source of truth for graves,
 * which always come from the NEAR contract.
 */
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { ChainId } from "@/core/chains";

export interface RecentToken {
  chain: ChainId;
  address: string;
  symbol: string;
  at: number;
}

export interface Prefs {
  watchlist: string[];
  recent: RecentToken[];
  wallets: { chain: ChainId; address: string }[];
  preferredChain: ChainId;
  seenIntro: boolean;
}

const DEFAULTS: Prefs = { watchlist: [], recent: [], wallets: [], preferredChain: "sol-devnet", seenIntro: false };
const KEY = "necropolis:prefs:v1";

interface Ctx {
  prefs: Prefs;
  update: (fn: (p: Prefs) => Prefs) => void;
  toggleWatch: (key: string) => void;
  remember: (t: Omit<RecentToken, "at">) => void;
  rememberWallet: (chain: ChainId, address: string) => void;
}

const PrefsCtx = createContext<Ctx | null>(null);

// localStorage is the store. The snapshot is cached so React sees a stable
// object, and a `storage` event from another tab invalidates it (tabs stay in sync).
let cache: Prefs | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function read(): Prefs {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
  } catch {
    cache = DEFAULTS; // private mode or blocked storage: run with defaults
  }
  return cache;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    notify();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const prefs = useSyncExternalStore(subscribe, read, () => DEFAULTS);
  const update = useCallback((fn: (p: Prefs) => Prefs) => {
    cache = fn(read());
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      /* storage blocked: the change lasts for this page view */
    }
    notify();
  }, []);
  const value = useMemo<Ctx>(
    () => ({
      prefs,
      update,
      toggleWatch: (k) =>
        update((p) => ({ ...p, watchlist: p.watchlist.includes(k) ? p.watchlist.filter((x) => x !== k) : [k, ...p.watchlist].slice(0, 50) })),
      remember: (t) =>
        update((p) => ({
          ...p,
          recent: [{ ...t, at: Date.now() }, ...p.recent.filter((r) => !(r.chain === t.chain && r.address === t.address))].slice(0, 12),
        })),
      rememberWallet: (chain, address) =>
        update((p) => ({
          ...p,
          wallets: [{ chain, address }, ...p.wallets.filter((w) => w.address !== address)].slice(0, 6),
        })),
    }),
    [prefs, update],
  );
  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>;
}

export function usePrefs(): Ctx {
  const c = useContext(PrefsCtx);
  if (!c) throw new Error("usePrefs outside PrefsProvider");
  return c;
}
