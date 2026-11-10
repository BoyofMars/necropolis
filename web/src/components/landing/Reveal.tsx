"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-12% 0px" }}
      transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** A field of tickers fading out — the scale of memecoin death. */
export function FadingField({ tickers }: { tickers: string[] }) {
  const reduced = useReducedMotion();
  return (
    <div className="relative select-none overflow-hidden" aria-hidden>
      <div className="grid grid-cols-4 gap-x-6 gap-y-2 font-display text-lg text-bone-4 sm:grid-cols-6 md:grid-cols-8">
        {tickers.map((t, i) => (
          <motion.span
            key={`${t}-${i}`}
            initial={{ opacity: 0.9 }}
            whileInView={reduced ? undefined : { opacity: [0.9, 0.9, 0.12] }}
            viewport={{ once: true }}
            transition={{ duration: 3.2, delay: (i % 17) * 0.11 + Math.floor(i / 17) * 0.05, ease: "easeOut" }}
            className="truncate"
          >
            ${t}
          </motion.span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-loam/40 to-loam" />
    </div>
  );
}
