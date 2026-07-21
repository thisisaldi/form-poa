/**
 * Pure quarter/period helpers — no DB dependency. Split out of
 * targetCalculation.ts so client components can use quarterToMonths without
 * transitively importing prisma.ts (which breaks client bundling — prisma.ts
 * is server-only).
 */

export function toYYYYMM(year: number, month: number): string {
  return `${year}${String(month).padStart(2, "0")}`;
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
