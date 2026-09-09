import { getPreviousQuarterInfo } from "@/lib/quarterUtils";

const INDO_MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
] as const;

/**
 * Format a YYYYMM string into "Mmm YYYY" (e.g. "Jul 2026").
 */
export function formatMonthLabel(m: string): string {
  if (!m || m.length < 6) return m;
  const year = m.slice(0, 4);
  const monthIndex = parseInt(m.slice(4), 10) - 1;
  return new Date(parseInt(year, 10), monthIndex).toLocaleString("id-ID", { month: "short", year: "numeric" });
}

/**
 * Format YYYYMM key into "Bulan Tahun" (e.g. "Januari 2026").
 */
export function formatMonthKey(key: string): string {
  if (key.length !== 6) return key;
  const year = key.slice(0, 4);
  const month = parseInt(key.slice(4, 6), 10);
  return `${INDO_MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Formats an array of YYYYMM strings into an Indonesian range description.
 * e.g. "Data diambil dari bulan Januari - Maret 2026"
 */
export function formatHistoryPeriodRange(periodArr?: string[]): string {
  if (!Array.isArray(periodArr) || periodArr.length === 0) return "";
  const validPeriods = periodArr.filter((p) => typeof p === "string" && p.length === 6).sort();
  if (validPeriods.length === 0) return "";

  const minStr = validPeriods[0];
  const maxStr = validPeriods[validPeriods.length - 1];

  const minYear = minStr.slice(0, 4);
  const minMonthIdx = parseInt(minStr.slice(4, 6), 10) - 1;

  const maxYear = maxStr.slice(0, 4);
  const maxMonthIdx = parseInt(maxStr.slice(4, 6), 10) - 1;

  if (minMonthIdx < 0 || minMonthIdx > 11 || maxMonthIdx < 0 || maxMonthIdx > 11) return "";

  const minMonthName = INDO_MONTH_NAMES[minMonthIdx];
  const maxMonthName = INDO_MONTH_NAMES[maxMonthIdx];

  if (minYear === maxYear) {
    return `Data diambil dari bulan ${minMonthName} - ${maxMonthName} ${maxYear}`;
  }
  return `Data diambil dari bulan ${minMonthName} ${minYear} - ${maxMonthName} ${maxYear}`;
}

/**
 * Resolves the Apotek Online period query parameter and previous quarter metadata.
 */
export function resolveApotekOnlinePeriod(poaPeriod?: string | null): {
  periodParam: string;
  prevQuarterInfo: {
    quarter: string;
    year: number;
    label: string;
    shortLabel: string;
  };
} {
  const prevQuarterInfo = getPreviousQuarterInfo(poaPeriod);
  const qNum = parseInt(prevQuarterInfo.quarter.replace(/[^0-9]/g, ""), 10) || 1;
  const lastMonth = qNum * 3;
  const periodParam = `${prevQuarterInfo.year}${String(lastMonth).padStart(2, "0")}`;
  return { periodParam, prevQuarterInfo };
}

/**
 * Parse poaPeriod and quarter number for BlastInTable.
 */
export function parseBlastInPeriod(poaPeriod?: string, quarter?: number): { qNum: number; yearNum: number } {
  let qNum = quarter;
  let yearNum = new Date().getFullYear();

  if (poaPeriod) {
    const m = poaPeriod.match(/^(\d{4})-?Q([1-4])$/i);
    if (m) {
      yearNum = parseInt(m[1], 10);
      if (!qNum) {
        qNum = parseInt(m[2], 10);
      }
    } else {
      const mYear = poaPeriod.match(/^(\d{4})/);
      if (mYear) yearNum = parseInt(mYear[1], 10);
      const mQ = poaPeriod.match(/Q([1-4])/i);
      if (mQ && !qNum) {
        qNum = parseInt(mQ[1], 10);
      } else {
        const mYM = poaPeriod.match(/^\d{4}(\d{2})$/);
        if (mYM && !qNum) {
          const monthNum = parseInt(mYM[1], 10);
          qNum = Math.ceil(monthNum / 3);
        }
      }
    }
  }
  if (!qNum) qNum = 3;

  return { qNum, yearNum };
}
