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
