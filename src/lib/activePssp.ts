import type { PoaLineItem } from "@prisma/client";
import type { ActivePsspRow } from "@/app/actions/customer";

/**
 * PSSP contracts still running (prdAkhir >= current period) for the doctors in
 * `items` — a doctor can already have an active contract from a previous POA,
 * separate from whatever is newly planned in this one.
 *
 * Matched on doctor AND outlet (not doctor alone): a doctor can hold PSSP
 * contracts at outlets outside the one this MR covers, and those must not be
 * counted here. Rows with no kdOutlet on the contract can't be verified as
 * belonging to this MR's outlet, so they're excluded. Since `items` only ever
 * contains outlets the MR is actually assigned to (the outlet picker in the
 * editor is scoped that way), this also guarantees the result never includes
 * an outlet outside the MR's own territory.
 */
export function relevantActivePssp(items: PoaLineItem[], activePssp: ActivePsspRow[]): ActivePsspRow[] {
  const custOutletSet = new Set(
    items
      .filter((it) => it.kodeCust && it.kodePI)
      .map((it) => `${it.kodeCust}|${it.kodePI}`)
  );
  return activePssp.filter((r) => r.kdOutlet && custOutletSet.has(`${r.kdCust}|${r.kdOutlet}`));
}

/**
 * Aggregate stats over relevantActivePssp.
 *
 * `nilaiTotal` (biaya — the committed contract value) is grouped by cUrut
 * since `biaya` is the contract's total, repeated per product row — summing
 * it per row would multiply-count the same commitment.
 *
 * `estBarisTotal` (estimated sales value) is genuinely per product row (one
 * PSSP contract can carry a different sales estimate per product), so it's
 * summed across every relevant row with no dedup.
 */
export function computeActivePsspStats(items: PoaLineItem[], activePssp: ActivePsspRow[]) {
  const relevant = relevantActivePssp(items, activePssp);

  const byContract = new Map<string, ActivePsspRow>();
  for (const r of relevant) if (!byContract.has(r.cUrut)) byContract.set(r.cUrut, r);

  const kontrakTotal = byContract.size;
  const nilaiTotal = [...byContract.values()].reduce((s, r) => s + r.biaya, 0);
  const estBarisTotal = relevant.reduce((s, r) => s + r.estBaris, 0);
  const dokterCount = new Set(relevant.map((r) => r.kdCust)).size;

  return { kontrakTotal, nilaiTotal, estBarisTotal, dokterCount };
}
