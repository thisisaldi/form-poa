import type { ActivePsspRow } from "@/app/actions/customer";

/**
 * Aggregate stats over a set of active PSSP contract rows — the whole set is
 * assumed to already be scoped correctly by the caller (e.g. via
 * getActivePsspByOutlets, restricted to outlets the MR is assigned to).
 *
 * `nilaiTotal` (biaya — the committed contract value) is grouped by cUrut
 * since `biaya` is the contract's total, repeated per product row — summing
 * it per row would multiply-count the same commitment.
 *
 * `estBarisTotal` (estimated sales value) is genuinely per product row (one
 * PSSP contract can carry a different sales estimate per product), so it's
 * summed across every row with no dedup.
 */
export function computeActivePsspStats(activePssp: ActivePsspRow[]) {
  const byContract = new Map<string, ActivePsspRow>();
  for (const r of activePssp) if (!byContract.has(r.cUrut)) byContract.set(r.cUrut, r);

  const kontrakTotal = byContract.size;
  const nilaiTotal = [...byContract.values()].reduce((s, r) => s + r.biaya, 0);
  const estBarisTotal = activePssp.reduce((s, r) => s + r.estBaris, 0);
  const dokterCount = new Set(activePssp.map((r) => r.kdCust)).size;

  return { kontrakTotal, nilaiTotal, estBarisTotal, dokterCount };
}
