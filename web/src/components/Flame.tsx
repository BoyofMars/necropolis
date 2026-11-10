import { cx } from "./ui";

/** A candle. Lit ones flicker (paused under reduced motion); `delay` desyncs a row of them. */
export function Flame({ lit = true, className, delay = 0 }: { lit?: boolean; className?: string; delay?: number }) {
  return (
    <svg viewBox="0 0 16 28" className={cx("h-7 w-4", className)} aria-hidden>
      <path d="M5.5 15h5v12h-5z" fill="var(--loam-3)" stroke="var(--line-strong)" strokeWidth="0.6" />
      {lit && (
        <g className="candle-flame" style={{ animationDelay: `${-delay}s` }}>
          <path d="M8 1.5c2.6 3.2 3.9 5.6 3.9 7.7A3.9 3.9 0 0 1 8 13.2a3.9 3.9 0 0 1-3.9-4c0-2.1 1.3-4.5 3.9-7.7z" fill="var(--ember)" />
          <path d="M8 6.5c1.1 1.5 1.7 2.6 1.7 3.5a1.7 1.7 0 0 1-3.4 0c0-.9.6-2 1.7-3.5z" fill="var(--ember-bright)" />
        </g>
      )}
    </svg>
  );
}
