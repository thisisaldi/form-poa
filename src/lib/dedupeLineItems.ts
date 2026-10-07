/**
 * A deal-locked doctor can be re-entered in a second POA of the same quarter
 * (poa.ts createPoaDraft, 2026-10-07). Identical re-entries must not inflate
 * aggregates: rows with the same owner + outlet + doctor + product + periode +
 * nilai (biaya, %PSSP, pengali R) collapse to the first one seen.
 */
type Num = { toString(): string } | number | null | undefined;

export function dedupeLineItems<T extends {
  poaId: string; kodePI: string | null; namaCust: string; kodeProduk: string;
  periodeAwal?: string | null; lamaPeriode?: number | null;
  rencanaTotalBiaya: Num; persenPsspDokter?: Num; pengaliNilaiR?: Num;
}>(items: T[], ownerByPoaId: Map<string, string>): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const key = [
      ownerByPoaId.get(it.poaId) ?? it.poaId, it.kodePI, it.namaCust, it.kodeProduk, it.periodeAwal, it.lamaPeriode,
      it.rencanaTotalBiaya?.toString(), it.persenPsspDokter?.toString(), it.pengaliNilaiR?.toString(),
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Sum of target counted once per owner+period even when that owner has several POAs in the quarter. */
export function sumTargetOncePerOwnerPeriod<T extends { ownerId: string; period: string }>(poas: T[], resolve: (p: T) => number): number {
  const byKey = new Map<string, number>();
  for (const p of poas) {
    const k = `${p.ownerId}|${p.period}`;
    const v = resolve(p);
    if (!byKey.has(k) || (byKey.get(k) === 0 && v > 0)) byKey.set(k, v);
  }
  let total = 0;
  for (const v of byKey.values()) total += v;
  return total;
}
