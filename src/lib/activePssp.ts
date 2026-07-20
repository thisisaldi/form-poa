import type { ActivePsspRow } from "@/app/actions/customer";

/** All YYYYMM months spanned by [prdAwal, prdAkhir], inclusive. */
function monthsInRange(prdAwal: string, prdAkhir: string): string[] {
  const startYear = parseInt(prdAwal.slice(0, 4), 10);
  const startMonth = parseInt(prdAwal.slice(4, 6), 10);
  const endYear = parseInt(prdAkhir.slice(0, 4), 10);
  const endMonth = parseInt(prdAkhir.slice(4, 6), 10);
  const totalMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
  const months: string[] = [];
  for (let i = 0; i < totalMonths; i++) {
    const d = new Date(startYear, startMonth - 1 + i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

/** Same apportionment as computeBiayaTercacah (DraftChecklist.tsx) uses for regular line items:
 *  full-period value / total months × how many of those months fall in the target quarter. */
export function apportion(value: number, prdAwal: string, prdAkhir: string, quarterMonths: string[]): number {
  if (!prdAwal || !prdAkhir || quarterMonths.length === 0) return 0;
  const months = monthsInRange(prdAwal, prdAkhir);
  if (months.length === 0) return 0;
  const overlapCount = months.filter((m) => quarterMonths.includes(m)).length;
  if (overlapCount === 0) return 0;
  return (value / months.length) * overlapCount;
}

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
 *
 * `nilaiTercacah` / `estBarisTercacah` are the SAME two figures, but apportioned
 * to `quarterMonths` (the quarter the POA being filled in actually covers) —
 * these, not the full-period totals above, are what should feed into any
 * "tercacah" figure in the Ringkasan, since a PSSP contract's committed value
 * and sales estimate almost always span more than just this one quarter.
 */
export function computeActivePsspStats(activePssp: ActivePsspRow[], quarterMonths: string[] = []) {
  const byContract = new Map<string, ActivePsspRow>();
  for (const r of activePssp) if (!byContract.has(r.cUrut)) byContract.set(r.cUrut, r);

  const kontrakTotal = byContract.size;
  const nilaiTotal = [...byContract.values()].reduce((s, r) => s + r.biaya, 0);
  const estBarisTotal = activePssp.reduce((s, r) => s + r.estBaris, 0);
  const dokterCount = new Set(activePssp.map((r) => r.kdCust)).size;

  const nilaiTercacah = [...byContract.values()]
    .reduce((s, r) => s + apportion(r.biaya, r.prdAwal, r.prdAkhir, quarterMonths), 0);
  const estBarisTercacah = activePssp
    .reduce((s, r) => s + apportion(r.estBaris, r.prdAwal, r.prdAkhir, quarterMonths), 0);

  return { kontrakTotal, nilaiTotal, estBarisTotal, dokterCount, nilaiTercacah, estBarisTercacah };
}
