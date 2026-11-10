"use client";

import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Pulse, syntheticBeats } from "../Pulse";
import { cx } from "../ui";

/**
 * The mechanic in one loop:
 * 0 dead bags in wallets → 1-2 buried on their own chains → 3 NEAR verifies →
 * 4 one grave stirs → 5 it rises: 80% home, 20% shared by every other grave.
 */
const STAGES = [2600, 1500, 1500, 1700, 2600, 3600];

type Chip = { id: string; sym: string; chain: "sol" | "base" };
const A: Chip = { id: "fumble", sym: "FUMBLE", chain: "sol" };
const B: Chip = { id: "wenlambo", sym: "WENLAMBO", chain: "base" };
const C: Chip = { id: "hopium", sym: "HOPIUM", chain: "sol" };

function TokenChip({ chip, faded, returning, compact }: { chip: Chip; faded?: boolean; returning?: boolean; compact?: boolean }) {
  return (
    <motion.span
      layoutId={returning ? undefined : `chip-${chip.id}`}
      className={cx(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border font-semibold tracking-wide",
        compact ? "px-1.5 py-0.5 text-[8.5px] sm:text-[9.5px]" : "px-2.5 py-1 text-[11px]",
        returning ? "border-ember/60 bg-ember/15 text-ember-bright" : "border-line-strong bg-loam-3 text-bone-2",
        faded && "opacity-50",
      )}
      transition={{ type: "spring", stiffness: 170, damping: 22 }}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", chip.chain === "sol" ? "bg-[#9b8cff]" : "bg-[#5d8bff]")} />${chip.sym}
      {returning && <span className="font-mono text-[10px] text-ember">×0.8</span>}
    </motion.span>
  );
}

export function HeroMechanic() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STAGES.length), STAGES[step]);
    return () => clearTimeout(t);
  }, [step, reduced]);
  // Reduced motion shows the finished story (risen) without animating there.
  const stage = reduced ? 5 : step;

  const aBuried = stage >= 1;
  const bBuried = stage >= 2;
  const verified = stage >= 3;
  const stirring = stage === 4;
  const risen = stage >= 5;

  const graves = [
    { n: "0411", chip: null as Chip | null, preset: "COPIUM" },
    { n: "0412", chip: aBuried ? A : null },
    { n: "0413", chip: null, preset: "NGMI" },
    { n: "0414", chip: bBuried ? B : null },
    { n: "0415", chip: null, preset: "BASEDCOPE" },
  ];

  const caption = [
    "Two dead bags, still sitting in their wallets.",
    "Buried on Solana. The token never leaves its chain.",
    "Buried on Base. Same rules, different chain.",
    "NEAR’s MPC network reads both chains and confirms each burial.",
    "Grave Nº 0412 is stirring: real volume, real liquidity, sustained.",
    "Risen. 80% returns to its owner; the 20% tithe is shared by every other grave.",
  ][stage];

  return (
    <LayoutGroup>
      <div className="relative overflow-hidden rounded-[22px] border border-line bg-loam-1 p-4 sm:p-6" aria-label="Animated explanation of burial and resurrection">
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
          animate={{ opacity: risen ? 1 : stirring ? 0.45 : 0 }}
          transition={{ duration: 1.2 }}
          style={{ background: "radial-gradient(60% 70% at 30% 100%, rgba(240,166,60,.16), transparent 70%)" }}
        />
        {/* wallets */}
        <div className="relative grid grid-cols-2 gap-3">
          {[
            { label: "Phantom · Solana", chips: [A, C], chain: "sol" as const },
            { label: "Wallet · Base", chips: [B], chain: "base" as const },
          ].map((w) => (
            <div key={w.label} className="rounded-[14px] border border-line bg-loam-2/80 p-3">
              <div className="eyebrow !text-[10px]">{w.label}</div>
              <div className="mt-2 flex min-h-[28px] flex-wrap gap-1.5">
                {w.chips.map((c) =>
                  (c.id === A.id && aBuried) || (c.id === B.id && bBuried) ? null : (
                    <TokenChip key={c.id} chip={c} faded={c.id === C.id} />
                  ),
                )}
                <AnimatePresence>
                  {risen && w.chain === "sol" && (
                    <motion.span initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.9, delay: 0.3 }}>
                      <TokenChip chip={A} returning />
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>

        {/* graves */}
        <div className="relative mt-6 grid grid-cols-5 items-end gap-2 sm:gap-3">
          {graves.map((g, i) => {
            const isA = i === 1;
            const glow = isA && (stirring || risen);
            return (
              <div key={g.n} className="flex flex-col items-center">
                <div className="mb-1 h-4">
                  <AnimatePresence>
                    {risen && !isA && (
                      <motion.span
                        className="block h-1.5 w-1.5 rounded-full bg-ember"
                        initial={{ y: -40, x: (1 - i) * 30, opacity: 0, scale: 0.6 }}
                        animate={{ y: 0, x: 0, opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.1, delay: 1.0 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                      />
                    )}
                  </AnimatePresence>
                </div>
                <motion.div
                  className={cx(
                    "stele relative flex aspect-[3/4] w-full flex-col items-center justify-end border bg-loam-2 px-1 pb-2",
                    glow ? "border-ember/70" : "border-line-strong",
                    stirring && isA && "stirring-glow",
                  )}
                  animate={glow ? { boxShadow: risen ? "0 0 38px -6px rgba(240,166,60,.6)" : "0 0 18px -6px rgba(240,166,60,.45)" } : { boxShadow: "0 0 0 0 rgba(0,0,0,0)" }}
                  transition={{ duration: 0.8 }}
                >
                  <span className={cx("font-display text-[11px] sm:text-[13px]", glow ? "text-ember-bright" : "text-bone-3")}>Nº {g.n}</span>
                  <div className="mt-1 flex h-6 w-full items-center justify-center overflow-hidden">
                    {g.chip ? (
                      <TokenChip chip={g.chip} compact />
                    ) : (
                      <span className="truncate text-[8.5px] font-semibold tracking-wide text-bone-4 sm:text-[9.5px]">{g.preset ? `$${g.preset}` : ""}</span>
                    )}
                  </div>
                </motion.div>
              </div>
            );
          })}
        </div>
        <div className="mt-1 h-px w-full bg-line-strong" />

        {/* NEAR coordination layer */}
        <div className="relative mt-4 flex items-center gap-3 rounded-[12px] border border-line bg-loam/60 px-3 py-2.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-bone-3">NEAR</span>
          <div className="h-6 flex-1 overflow-hidden">
            <Pulse
              beats={syntheticBeats(verified ? "alive" : "dead", 26, stage + 3)}
              height={24}
              width={420}
              color={verified ? "var(--alive)" : "var(--bone-4)"}
              animate={false}
              className="h-6 w-full"
            />
          </div>
          <AnimatePresence mode="wait">
            <motion.span
              key={verified ? "v" : "w"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cx("whitespace-nowrap text-[11px] font-semibold", verified ? "text-alive" : "text-bone-4")}
            >
              {verified ? "MPC verified · no bridge" : "watching"}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* status */}
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {(["DEAD", "STIRRING", "RISEN"] as const).map((s) => {
              const on = (s === "DEAD" && stage <= 3) || (s === "STIRRING" && stirring) || (s === "RISEN" && risen);
              return (
                <span
                  key={s}
                  className={cx(
                    "rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-[0.14em] transition-colors duration-500",
                    on ? (s === "DEAD" ? "border-dead/60 text-dead" : "border-ember/60 text-ember") : "border-line text-bone-4/60",
                  )}
                >
                  {s}
                </span>
              );
            })}
          </div>
        </div>
        <p className="mt-3 min-h-[2.5rem] text-sm leading-snug text-bone-2" aria-live="polite">
          {caption}
        </p>
      </div>
    </LayoutGroup>
  );
}
