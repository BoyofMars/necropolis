"use client";

import { useEffect, useState } from "react";
import { cx } from "./ui";

/**
 * Designed waiting: a short list of what is actually happening, advancing on a
 * schedule while the request runs (never claiming a step finished early when
 * `doneIndex` is driven by real progress).
 */
export function StepLoader({
  steps,
  pace = 1100,
  doneIndex,
  className,
}: {
  steps: string[];
  pace?: number;
  doneIndex?: number;
  className?: string;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (doneIndex !== undefined) return;
    if (i >= steps.length - 1) return;
    const t = setTimeout(() => setI((x) => x + 1), pace);
    return () => clearTimeout(t);
  }, [i, pace, steps.length, doneIndex]);
  const cur = doneIndex ?? i;
  return (
    <ol className={cx("space-y-2.5", className)} aria-live="polite">
      {steps.map((s, k) => (
        <li key={s} className={cx("flex items-center gap-3 text-sm transition-opacity duration-500", k > cur ? "opacity-30" : "opacity-100")}>
          <span className="relative flex h-4 w-4 items-center justify-center">
            {k < cur ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--alive)" strokeWidth="3" aria-hidden>
                <path d="M5 12l5 5L20 7" />
              </svg>
            ) : k === cur ? (
              <span className="h-2 w-2 animate-pulse rounded-full bg-ember" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-bone-4" />
            )}
          </span>
          <span className={k === cur ? "text-bone" : "text-bone-3"}>{s}</span>
        </li>
      ))}
    </ol>
  );
}
