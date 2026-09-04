/**
 * Pure quarter/period helpers — no DB dependency. Split out of
 * targetCalculation.ts so client components can use quarterToMonths without
 * transitively importing prisma.ts (which breaks client bundling — prisma.ts
 * is server-only).
 */

export function toYYYYMM(year: number, month: number): string {
  return `${year}${String(month).padStart(2, "0")}`;
}

/** The calendar quarter containing today, e.g. Jul 2026 -> "2026-Q3". */
export function currentQuarter(): string {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return `${now.getFullYear()}-Q${q}`;
}

/** The calendar quarter containing a "YYYY-MM-DD" date, e.g. "2026-08-01" -> "2026-Q3". */
export function quarterFromDate(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) throw new Error(`Invalid date format: ${dateStr}`);
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const q = Math.floor((month - 1) / 3) + 1;
  return `${year}-Q${q}`;
}

/** "2026-Q3" -> ["202607", "202608", "202609"] */
export function quarterToMonths(quarter: string): string[] {
  const m = quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!m) throw new Error(`Invalid quarter format: ${quarter}`);
  const year = parseInt(m[1], 10);
  const q = parseInt(m[2], 10);
  const startMonth = (q - 1) * 3 + 1;
  return [0, 1, 2].map((i) => toYYYYMM(year, startMonth + i));
}

/** "2026-Q3" -> { startDate: "2026-07-01", endDate: "2026-09-30" } (calendar dates, inclusive). */
export function quarterDateRange(quarter: string): { startDate: string; endDate: string } {
  const months = quarterToMonths(quarter);
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  const startDate = `${firstMonth.slice(0, 4)}-${firstMonth.slice(4, 6)}-01`;
  const lastYear = parseInt(lastMonth.slice(0, 4), 10);
  const lastMonthNum = parseInt(lastMonth.slice(4, 6), 10);
  // Day 0 of the month AFTER lastMonth = the last calendar day of lastMonth.
  const lastDay = new Date(lastYear, lastMonthNum, 0).getDate();
  const endDate = `${lastMonth.slice(0, 4)}-${lastMonth.slice(4, 6)}-${String(lastDay).padStart(2, "0")}`;
  return { startDate, endDate };
}

/**
 * First month of a quarterToMonths()-shaped array (e.g. ["202607","202608","202609"])
 * -> "Q3", for labeling "Kuartal Q3" instead of the vaguer "Kuartal Ini" (2026-08-04
 * request). Falls back to "Ini" when months is empty/malformed rather than throwing —
 * these labels sit in read-only display text, not worth a hard failure over.
 */
export function quarterLabelFromMonths(months: string[]): string {
  const m = months[0];
  if (!m || m.length !== 6) return "Ini";
  const month = parseInt(m.slice(4, 6), 10);
  if (isNaN(month) || month < 1 || month > 12) return "Ini";
  return `Q${Math.ceil(month / 3)}`;
}

/**
 * Resolves a 6-digit period string (YYYYMM) for a given quarter (e.g. "2026-Q3")
 * and optional selected start month (e.g. "202609").
 *
 * Rules:
 * 1. If explicit valid YYYYMM period is provided, return it.
 * 2. If quarter is provided (e.g. "2026-Q3"):
 *    - If the current calendar month is within that quarter, return current month (e.g. September -> "202609").
 *    - If current month is before that quarter (planning for future Q), return the first month of that quarter.
 *    - If current month is after that quarter (reviewing past Q), return the last month of that quarter.
 * 3. Fallback to current calendar year & month YYYYMM.
 */
export function resolvePeriodForQuarter(quarter?: string | null, preferredMonth?: string | null): string {
  if (preferredMonth && /^\d{6}$/.test(preferredMonth)) {
    return preferredMonth;
  }

  const now = new Date();
  const currentYYYYMM = toYYYYMM(now.getFullYear(), now.getMonth() + 1);

  if (quarter) {
    const match = quarter.match(/^(\d{4})-Q([1-4])$/);
    if (match) {
      const months = quarterToMonths(quarter);
      if (months.includes(currentYYYYMM)) {
        return currentYYYYMM;
      }
      if (currentYYYYMM < months[0]) {
        return months[0];
      }
      return months[months.length - 1];
    }
  }

  return currentYYYYMM;
}

/**
 * Returns the previous quarter and its month range label in Indonesian.
 * e.g. "2026-Q3" -> { quarter: "Q2", year: 2026, label: "Q2 (April - Juni 2026)", shortLabel: "Q2 (Apr - Jun 2026)" }
 */
export function getPreviousQuarterInfo(poaPeriod?: string | null): {
  quarter: string;
  year: number;
  label: string;
  shortLabel: string;
} {
  const now = new Date();
  let year = now.getFullYear();
  let q = Math.floor(now.getMonth() / 3) + 1;

  if (poaPeriod) {
    const match = poaPeriod.match(/^(\d{4})-Q([1-4])$/);
    if (match) {
      year = parseInt(match[1], 10);
      q = parseInt(match[2], 10);
    }
  }

  let prevQ = q - 1;
  let prevYear = year;
  if (prevQ < 1) {
    prevQ = 4;
    prevYear -= 1;
  }

  const quarterMonthsNames = [
    ["Januari", "Maret"],
    ["April", "Juni"],
    ["Juli", "September"],
    ["Oktober", "Desember"],
  ];

  const quarterMonthsShort = [
    ["Jan", "Mar"],
    ["Apr", "Jun"],
    ["Jul", "Sep"],
    ["Okt", "Des"],
  ];

  const [startName, endName] = quarterMonthsNames[prevQ - 1];
  const [startShort, endShort] = quarterMonthsShort[prevQ - 1];

  return {
    quarter: `Q${prevQ}`,
    year: prevYear,
    label: `Q${prevQ} (${startName} - ${endName} ${prevYear})`,
    shortLabel: `Q${prevQ} (${startShort} - ${endShort} ${prevYear})`,
  };
}

