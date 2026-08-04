/**
 * Pure utility functions for POA period calculations.
 * periodeAakhir is NOT stored in DB — always computed on the fly.
 */

/**
 * Returns the last month of a POA period.
 * periodeAwal format: "YYYYMM" (e.g. "202607")
 * lamaPeriode: 1 | 3 | 6 | 12 months
 * Returns: "YYYYMM" of the final month
 */
export function computePeriodeAkhir(periodeAwal: string, lamaPeriode: number): string {
  const year = parseInt(periodeAwal.slice(0, 4), 10);
  const month = parseInt(periodeAwal.slice(4, 6), 10); // 1-based

  const totalMonths = (year * 12 + month - 1) + (lamaPeriode - 1);
  const endYear = Math.floor(totalMonths / 12);
  const endMonth = (totalMonths % 12) + 1;

  return `${endYear}${String(endMonth).padStart(2, "0")}`;
}

/** Formats a YYYYMM string to "Mmm YYYY" for display (e.g. "Jul 2026") */
export function formatPeriode(yyyymm: string): string {
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10) - 1; // 0-based for Date
  return new Date(year, month, 1).toLocaleDateString("id-ID", {
    month: "short",
    year: "numeric",
  });
}

/** Returns "MMM YYYY – MMM YYYY" display string for a line item period range */
export function formatPeriodeRange(periodeAwal: string, lamaPeriode: number): string {
  const akhir = computePeriodeAkhir(periodeAwal, lamaPeriode);
  if (lamaPeriode === 1) return formatPeriode(periodeAwal);
  return `${formatPeriode(periodeAwal)} – ${formatPeriode(akhir)}`;
}

/** Every "YYYYMM" month from periodeAwal through periodeAwal + (lamaPeriode-1), inclusive. */
export function expandPeriodeMonths(periodeAwal: string, lamaPeriode: number): string[] {
  const year = parseInt(periodeAwal.slice(0, 4), 10);
  const month = parseInt(periodeAwal.slice(4, 6), 10); // 1-based
  const startMonths = year * 12 + (month - 1);
  return Array.from({ length: lamaPeriode }, (_, i) => {
    const m = startMonths + i;
    return `${Math.floor(m / 12)}${String((m % 12) + 1).padStart(2, "0")}`;
  });
}

export const LAMA_PERIODE_OPTIONS = [1, 3, 6, 12] as const;
export type LamaPeriode = (typeof LAMA_PERIODE_OPTIONS)[number];

function toNumSafe(v: unknown): number {
  return parseFloat(String(v ?? 0)) || 0;
}

export interface MonthlyBreakdownInput {
  rencanaTotalBiaya: unknown;
  persenPsspDokter: unknown;
  pengaliNilaiR: unknown;
  periodeAwal: string | null;
  lamaPeriode: number | null;
}

/**
 * Spreads each line item's Estimasi (rencanaTotalBiaya) and Nilai PSSP evenly
 * across its periodeAwal..periodeAwal+lamaPeriode-1 months (rata rata — no
 * other basis available), then sums by calendar month across all items.
 * Shared by the Excel exports and the "Ringkasan POA" panel so both surfaces
 * show the same per-bulan breakdown instead of just one grand total.
 */
export function computeMonthlyBreakdown(items: MonthlyBreakdownInput[]): Map<string, { estimasi: number; nilaiPssp: number }> {
  const map = new Map<string, { estimasi: number; nilaiPssp: number }>();
  for (const it of items) {
    if (!it.periodeAwal || it.periodeAwal.length !== 6 || !it.lamaPeriode || it.lamaPeriode <= 0) continue;
    const months = expandPeriodeMonths(it.periodeAwal, it.lamaPeriode);
    if (months.length === 0) continue;

    const base = toNumSafe(it.rencanaTotalBiaya);
    const pengaliNilaiR = it.pengaliNilaiR != null ? toNumSafe(it.pengaliNilaiR) : 1;
    const nilaiPsspTotal = base * toNumSafe(it.persenPsspDokter) * pengaliNilaiR;
    const estimasiPerBulan = base / months.length;
    const nilaiPsspPerBulan = nilaiPsspTotal / months.length;

    for (const m of months) {
      const cur = map.get(m) ?? { estimasi: 0, nilaiPssp: 0 };
      cur.estimasi += estimasiPerBulan;
      cur.nilaiPssp += nilaiPsspPerBulan;
      map.set(m, cur);
    }
  }
  return map;
}
