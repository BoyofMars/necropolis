import Link from "next/link";
import type { GraveJson, PlotJson } from "@/core/near";
import { graveStage } from "@/core/graveArt";
import { CHAINS, type ChainId } from "@/core/chains";
import { ago, graveNo, tokenAmount } from "@/lib/format";
import { cx } from "./ui";

export function GraveCard({ g, plot, compact }: { g: GraveJson; plot?: PlotJson | null; compact?: boolean }) {
  const stage = graveStage(g, plot);
  const glow = stage === "stirring" || stage === "risen";
  return (
    <Link
      href={`/grave/${g.id}`}
      className={cx(
        "stele group relative flex flex-col items-center border bg-loam-1 px-4 pb-4 text-center transition duration-300 hover:-translate-y-0.5",
        compact ? "pt-8" : "pt-12",
        glow ? "border-ember/60 hover:border-ember" : "border-line hover:border-line-strong",
        stage === "stirring" && "stirring-glow",
      )}
    >
      <span className="inscription text-[10px] text-bone-4">{CHAINS[g.chain as ChainId]?.shortName}</span>
      <span className={cx("mt-1 font-display text-2xl", glow ? "text-ember-bright" : "text-bone")}>{graveNo(g.id)}</span>
      <span className="mt-1 text-sm font-semibold text-bone-2">${plot?.symbol ?? "…"}</span>
      <span className="mt-0.5 text-xs tabular text-bone-3">{tokenAmount(g.amount, g.decimals)}</span>
      {!compact && g.epitaph && <span className="mt-3 line-clamp-2 font-display text-sm italic text-bone-3">&ldquo;{g.epitaph}&rdquo;</span>}
      <span className={cx("mt-3 text-[10px] font-bold uppercase tracking-[0.16em]", glow ? "text-ember" : "text-bone-4")}>
        {stage === "risen" ? "risen" : stage === "stirring" ? "stirring" : `buried ${ago(g.buried_at)}`}
      </span>
    </Link>
  );
}
