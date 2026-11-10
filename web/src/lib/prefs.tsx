"use client";

/**
 * Per-viewer conveniences (watchlist, recently viewed, pasted wallets,
 * preferred chain). localStorage only — never the source of truth for graves,
 * which always come from the NEAR contract.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
const KEY = "bagyard:prefs:v1";

interface Ctx {
  prefs: Prefs;
  update: (fn: (p: Prefs) => Prefs) => void;
  toggleWatch: (key: string) => void;
  remember: (t: Omit<RecentToken, "at">) => void;
  rememberWallet: (chain: ChainId, address: string) => void;
}

const PrefsCtx = createContext<Ctx | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setPrefs({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) });
    } catch {
      /* private mode or blocked storage: run with defaults */
    }
  }, []);
  const update = useCallback((fn: (p: Prefs) => Prefs) => {
    setPrefs((p) => {
      const next = fn(p);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
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
