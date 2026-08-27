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
