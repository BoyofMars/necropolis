import { eligibility } from "@/core/appraisal";
import { diagnose } from "@/core/death";
import { plotId, registry, type ContractChain } from "@/core/near";
import { getDossier } from "@/server/dossier";
import { fail, ok } from "@/server/respond";

export const maxDuration = 30;

export async function GET(_req: Request, ctx: { params: Promise<{ chain: string; address: string }> }) {
  try {
    const { chain, address } = await ctx.params;
    const dossier = await getDossier(chain as ContractChain, decodeURIComponent(address), { history: true, safety: true });
    const d = diagnose(dossier);
    const ref = dossier.profile.ref;
    const plot = await registry.plot(plotId(ref.chain as ContractChain, ref.address)).catch(() => null);
    const graves = plot ? await registry.gravesByPlot(plot.id).catch(() => []) : [];
    return ok({ dossier, diagnosis: d, eligibility: eligibility(d, dossier, plot?.state.kind), plot, graves }, 60);
  } catch (e) {
    return fail(e);
  }
}
