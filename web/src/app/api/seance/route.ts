/**
 * Testnet Séance: the coroner reports *simulated* recovery vitals for a
 * testnet plot so the on-chain rite can be demonstrated on compressed timers.
 * Disabled on mainnet. The contract still applies every rule itself.
 */
import { NETWORK, registry } from "@/core/near";
import { falseDawnObservation, seanceObservation } from "@/core/testnet";
import { BurialError } from "@/server/burial";
import { body, fail, ok } from "@/server/respond";
import { callContractRaw, parseEvents } from "@/server/sexton";

export const maxDuration = 30;
const MIN_SPACING_S = 55;

export async function POST(req: Request) {
  try {
    if (NETWORK !== "testnet") throw new BurialError("The séance only runs on testnet.", "MAINNET");
    const { plotId, mode } = await body<{ plotId: string; mode: "revive" | "false-dawn" }>(req);
    const plot = await registry.plot(plotId);
    if (!plot) throw new BurialError("Plot not found.", "NOT_FOUND", 404);
    if (!plot.chain.endsWith("devnet") && !plot.chain.endsWith("sepolia")) throw new BurialError("Testnet plots only.", "MAINNET");
    if (plot.state.kind === "RISEN") return ok({ state: plot.state, skipped: "already risen" });
    const now = Math.floor(Date.now() / 1000);
    const last = plot.last_observation ? Number(plot.last_observation.t) : 0;
    if (now - last < MIN_SPACING_S) {
      return ok({ state: plot.state, skipped: `next observation in ${MIN_SPACING_S - (now - last)}s`, waitSeconds: MIN_SPACING_S - (now - last) });
    }
    const step = plot.state.kind === "STIRRING" ? plot.state.count : 0;
    const observation =
      mode === "false-dawn" ? falseDawnObservation(now) : seanceObservation(Number(plot.baseline_mcap_usd), step, now);
    const res = await callContractRaw("observe", { plot_id: plotId, observation }, 50);
    const ev = parseEvents(res.logs);
    const after = await registry.plot(plotId);
    return ok({
      state: after?.state,
      transition: ev.find((e) => e.event === "observation")?.data.transition,
      risen: ev.some((e) => e.event === "risen"),
      nearTx: res.hash,
      observation,
    });
  } catch (e) {
    return fail(e);
  }
}
