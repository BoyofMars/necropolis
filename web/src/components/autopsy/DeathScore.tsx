import type { Condition } from "@/core/death";
import { CONDITION_STYLE } from "../ui";

const LABEL: Record<Condition, string> = {
  DEAD: "Deceased",
  CRITICAL: "Critical",
  FADING: "Fading",
  ALIVE: "Alive",
  UNKNOWN: "Inconclusive",
};

export function DeathScore({ score, condition, evidence }: { score?: number; condition: Condition; evidence: number }) {
  const color = CONDITION_STYLE[condition].color;
  const r = 52;
  const c = 2 * Math.PI * r;
  const frac = score !== undefined ? score / 100 : 0;
  return (
    <div className="flex items-center gap-5">
      <svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label={score !== undefined ? `Death score ${score} of 100` : "Death score unavailable"}>
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--loam-3)" strokeWidth="8" />
        <circle
          cx="66"
          cy="66"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          transform="rotate(-90 66 66)"
        />
        <text x="66" y="70" textAnchor="middle" fill="var(--bone)" fontSize="38" fontFamily="var(--font-display)" fontWeight="600">
          {score ?? "—"}
        </text>
        <text x="66" y="92" textAnchor="middle" fill="var(--bone-3)" fontSize="11" fontFamily="var(--font-ui)" letterSpacing="2">
          / 100
        </text>
      </svg>
      <div>
        <div className="eyebrow">Death score</div>
        <div className="mt-1 font-display text-3xl" style={{ color }}>
          {score !== undefined ? `${score}% ${LABEL[condition]}` : LABEL[condition]}
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-bone-3">
          <span className="inline-flex h-1.5 w-20 overflow-hidden rounded-full bg-loam-3">
            <span className="h-full bg-bone-3" style={{ width: `${Math.round(evidence * 100)}%` }} />
          </span>
          {Math.round(evidence * 100)}% of signals measured
        </div>
      </div>
    </div>
  );
}
