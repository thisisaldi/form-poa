/**
 * Real (not dummy) sales figures for the Detail POA page's "Data Sales"
 * card — sourced from OutletSalesValueMonthly (synced from
 * mkt_insight.dbo.DIR10001B, see outletSalesValueMonthlySync.ts), scoped to
 * whichever outlets the given MR holds right now.
 */

import { prisma } from "@/lib/prisma";

export interface MrSalesSummary {
  /** Full previous calendar year (e.g. 2025 when the current year is 2026). */
  historisTahunLalu: number;
  historisTahunLaluLabel: string;
  /** Current year, Jan through the last completed month. */
  salesYtd: number;
  /** YoY growth: this year's YTD vs the SAME month range last year — not
   * vs the full previous year, which would always read as a huge decline
   * simply because YTD covers fewer months. */
  growthPct: number;
}

function toYYYYMM(year: number, month: number): string {
  return `${year}${String(month).padStart(2, "0")}`;
}

/** Returns the real sales summary for an MR's currently-assigned outlets, or
 * all-zero when the MR has no outlets (e.g. a dummy/demo account, or a real
 * MR the sync hasn't covered yet). */
export async function getMrSalesSummary(nipMR: string): Promise<MrSalesSummary> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const lastYear = currentYear - 1;
  const lastCompletedMonth = now.getMonth(); // 1-based month minus 1 = last completed month

  const periode = currentYear * 100 + (now.getMonth() + 1);
  const assignments = await prisma.mrOutletAssignment.findMany({
    where: { nipMR, periode },
    select: { kodePI: true },
  });
  const outlets = assignments.map((a: { kodePI: string }) => a.kodePI);

  if (outlets.length === 0 || lastCompletedMonth === 0) {
    return { historisTahunLalu: 0, historisTahunLaluLabel: String(lastYear), salesYtd: 0, growthPct: 0 };
  }

  const ytdFrom = toYYYYMM(currentYear, 1);
  const ytdTo = toYYYYMM(currentYear, lastCompletedMonth);
  const lastYearFullFrom = toYYYYMM(lastYear, 1);
  const lastYearFullTo = toYYYYMM(lastYear, 12);
  const lastYearComparableFrom = ytdFrom.replace(String(currentYear), String(lastYear));
  const lastYearComparableTo = ytdTo.replace(String(currentYear), String(lastYear));

  const [historisRows, ytdRows, comparableRows] = await Promise.all([
    prisma.outletSalesValueMonthly.findMany({
      where: { kodePI: { in: outlets }, periode: { gte: lastYearFullFrom, lte: lastYearFullTo } },
      select: { valueSales: true },
    }),
    prisma.outletSalesValueMonthly.findMany({
      where: { kodePI: { in: outlets }, periode: { gte: ytdFrom, lte: ytdTo } },
      select: { valueSales: true },
    }),
    prisma.outletSalesValueMonthly.findMany({
      where: { kodePI: { in: outlets }, periode: { gte: lastYearComparableFrom, lte: lastYearComparableTo } },
      select: { valueSales: true },
    }),
  ]);

  const sum = (rows: { valueSales: { toString(): string } }[]) =>
    rows.reduce((s, r) => s + (parseFloat(r.valueSales.toString()) || 0), 0);

  const historisTahunLalu = sum(historisRows);
  const salesYtd = sum(ytdRows);
  const comparable = sum(comparableRows);
  const growthPct = comparable > 0 ? ((salesYtd - comparable) / comparable) * 100 : 0;

  return { historisTahunLalu, historisTahunLaluLabel: String(lastYear), salesYtd, growthPct };
}
