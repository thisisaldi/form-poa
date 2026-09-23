/**
 * Fills KpiMonthlyEntry.callActivityRealisasi from exodus_sfe.dbo.
 * visit_realizations (MSSQL; same row set as Exodus's count-by-nip — verified
 * 2026-09-21, visit + extra call both count). Memo standard is a minimum
 * AVERAGE visits per ACTIVE day (day with >= 1 visit) split by time window
 * (08:00-15:00 vs 15:00-08:00 WIB; SM has no window) — see
 * kpiScoring.ts CALL_ACTIVITY_MIN_BY_ROLE. Timestamps are stored UTC, so
 * WIB = +7h. One batched query for everyone (not per-NIP HTTP calls).
 * Only triggered manually (ADMIN presses "Sync Kunjungan dari Exodus" on
 * /kpi-perpanjangan), no automatic schedule for v1.
 *
 * Manual overrides win: a row whose callActivitySource is already "MANUAL" is
 * left untouched, same "manual wins" contract as absensi.
 */

import sql from "mssql";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { CALL_ACTIVITY_STANDARD_BY_ROLE, callActivityRealisasiFromDailyAvgs } from "@/lib/kpiScoring";

export interface KpiCallActivitySyncResult {
  period: string;
  scanned: number;
  updated: number;
  skippedManual: number;
  noData: number;
  errors: string[];
}

/** UTC instant of 00:00 WIB on the 1st of `period` ("YYYY-MM"), as "YYYY-MM-DD HH:mm:ss" (17:00 UTC the day before). */
function wibMonthStartUtc(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1) - 7 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
}

/** Average visits per active day, per NIP, split at 08:00/15:00 WIB. NIPs with no visits are absent from the map. */
export async function queryDailyAvgsByNip(period: string, nips: string[]): Promise<Map<string, { avgDay: number; avgOff: number }>> {
  const [y, m] = period.split("-").map(Number);
  const nextPeriod = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const pool = new sql.ConnectionPool(env.MSSQL_CONNECTION_STRING);
  await pool.connect();
  try {
    // ponytail: NIP filter done in JS (~800 NIPs/month), not an IN(...) list.
    const { recordset } = await pool
      .request()
      .input("start", sql.VarChar, wibMonthStartUtc(period))
      .input("end", sql.VarChar, wibMonthStartUtc(nextPeriod))
      .query<{ nip: string; days: number; dayVisits: number; offVisits: number }>(`
        SELECT user_nip AS nip, COUNT(*) AS days, SUM(dayVisits) AS dayVisits, SUM(offVisits) AS offVisits
        FROM (
          SELECT user_nip, CAST(DATEADD(hour, 7, visit_start_date) AS date) AS d,
                 SUM(CASE WHEN DATEPART(hour, DATEADD(hour, 7, visit_start_date)) BETWEEN 8 AND 14 THEN 1 ELSE 0 END) AS dayVisits,
                 SUM(CASE WHEN DATEPART(hour, DATEADD(hour, 7, visit_start_date)) BETWEEN 8 AND 14 THEN 0 ELSE 1 END) AS offVisits
          FROM exodus_sfe.dbo.visit_realizations
          WHERE visit_start_date >= CONVERT(datetime, @start, 120) AND visit_start_date < CONVERT(datetime, @end, 120)
          GROUP BY user_nip, CAST(DATEADD(hour, 7, visit_start_date) AS date)
        ) x
        GROUP BY user_nip`);
    const wanted = new Set(nips);
    const map = new Map<string, { avgDay: number; avgOff: number }>();
    for (const r of recordset) {
      if (wanted.has(r.nip)) map.set(r.nip, { avgDay: r.dayVisits / r.days, avgOff: r.offVisits / r.days });
    }
    return map;
  } finally {
    await pool.close();
  }
}

/** Syncs callActivityRealisasi for every active MR/ASM/SM for `period` ("YYYY-MM", defaults to current month). */
export async function runKpiCallActivitySync(period?: string): Promise<KpiCallActivitySyncResult> {
  const now = new Date();
  const targetPeriod = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const result: KpiCallActivitySyncResult = { period: targetPeriod, scanned: 0, updated: 0, skippedManual: 0, noData: 0, errors: [] };

  const personnel = (await prisma.user.findMany({
    where: { role: { in: ["MR", "ASM", "SM"] }, isActive: true, isDummy: false, NOT: { nip: { startsWith: "TEST" } } },
    select: { nip: true, role: true },
  })) as { nip: string; role: string }[];
  if (personnel.length === 0) return result;

  const existingEntries = (await prisma.kpiMonthlyEntry.findMany({
    where: { nip: { in: personnel.map((p) => p.nip) }, period: targetPeriod },
    select: { nip: true, callActivitySource: true, callActivityRealisasi: true },
  })) as { nip: string; callActivitySource: string; callActivityRealisasi: unknown }[];
  const manualNips = new Set(existingEntries.filter((e) => e.callActivitySource === "MANUAL" && e.callActivityRealisasi != null).map((e) => e.nip));

  const avgByNip = await queryDailyAvgsByNip(targetPeriod, personnel.map((p) => p.nip));

  for (const p of personnel) {
    result.scanned++;
    if (manualNips.has(p.nip)) {
      result.skippedManual++;
      continue;
    }

    try {
      const avg = avgByNip.get(p.nip);
      const realisasi = avg ? callActivityRealisasiFromDailyAvgs(p.role, avg.avgDay, avg.avgOff) : null;
      if (realisasi == null) {
        result.noData++;
        continue;
      }

      await prisma.kpiMonthlyEntry.upsert({
        where: { nip_period: { nip: p.nip, period: targetPeriod } },
        create: {
          nip: p.nip,
          period: targetPeriod,
          callActivityRealisasi: realisasi,
          callActivityStandar: CALL_ACTIVITY_STANDARD_BY_ROLE[p.role] ?? null,
          callActivitySource: "EXODUS_SYNC",
          callActivityInputAt: now,
        },
        update: {
          callActivityRealisasi: realisasi,
          callActivityStandar: CALL_ACTIVITY_STANDARD_BY_ROLE[p.role] ?? null,
          callActivitySource: "EXODUS_SYNC",
          callActivityInputAt: now,
        },
      });
      result.updated++;
    } catch (err) {
      result.errors.push(`${p.nip}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
