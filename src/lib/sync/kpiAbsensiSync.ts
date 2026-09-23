/**
 * Fills KpiMonthlyEntry.absensiValue from the SIPP attendance API (see
 * src/lib/sippApi.ts, docs/kpi-monitoring/01-business-rules.md §2d). One HTTP
 * call per active MR/ASM/SM personil — acceptable because this is only
 * triggered manually (ADMIN presses "Sync Absensi dari SIPP" on
 * /kpi-perpanjangan, see syncKpiAbsensiAction in src/app/actions/kpi.ts), not
 * from every page render — that's the N+1 docs/PERFORMANCE.md §2 point 4
 * warns about. No automatic schedule for v1 — deliberately simpler than the
 * sales-history cron pattern, since nobody asked for "always fresh."
 *
 * Manual overrides win: a row whose absensiSource is already "MANUAL" is left
 * untouched, so an ADMIN's manual correction isn't clobbered by the next
 * sync run. Every other row (unset, or previously "SIPP_SYNC") is
 * (re)written from the API — safe to re-run for the current month as more
 * attendance records accumulate day by day.
 *
 * PTID comes from User.sippAbsPtId, seeded from the HR-provided master
 * file (scripts/importSippPtidFromHrFile.ts, run 2026-09-23) — ground
 * truth per NIP, not a prefix guess (the old P/L/F-prefix guess had ~1,083
 * "P"-prefixed NIPs wrong, actually PTID 7 not 1). A NIP missing from that
 * import (sippAbsPtId still null) is reported as an error, not silently
 * skipped — re-run the import script when HR sends a refreshed file.
 */

import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { getAbsensiByNip, computeAvgLateHours, monthDateRange } from "@/lib/sippApi";

export interface KpiAbsensiSyncResult {
  period: string;
  scanned: number;
  updated: number;
  skippedManual: number;
  noData: number;
  errors: string[];
}

/** Syncs absensiValue for every active MR/ASM/SM for `period` ("YYYY-MM", defaults to current month). */
export async function runKpiAbsensiSync(period?: string): Promise<KpiAbsensiSyncResult> {
  const now = new Date();
  const targetPeriod = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const result: KpiAbsensiSyncResult = { period: targetPeriod, scanned: 0, updated: 0, skippedManual: 0, noData: 0, errors: [] };

  if (!env.SIPP_BASE_URL) {
    result.errors.push("SIPP not configured (SIPP_BASE_URL missing) — skipped");
    return result;
  }

  const personnel = (await prisma.user.findMany({
    where: { role: { in: ["MR", "ASM", "SM"] }, isActive: true, isDummy: false, NOT: { nip: { startsWith: "TEST" } } },
    select: { nip: true, sippAbsPtId: true },
  })) as { nip: string; sippAbsPtId: number | null }[];
  if (personnel.length === 0) return result;

  const existingEntries = (await prisma.kpiMonthlyEntry.findMany({
    where: { nip: { in: personnel.map((p) => p.nip) }, period: targetPeriod },
    select: { nip: true, absensiSource: true, absensiValue: true },
  })) as { nip: string; absensiSource: string; absensiValue: unknown }[];
  const manualNips = new Set(existingEntries.filter((e) => e.absensiSource === "MANUAL" && e.absensiValue != null).map((e) => e.nip));

  const { startDate, endDate } = monthDateRange(targetPeriod);

  for (const p of personnel) {
    result.scanned++;
    if (manualNips.has(p.nip)) {
      result.skippedManual++;
      continue;
    }

    try {
      const ptId = p.sippAbsPtId;
      if (ptId == null) {
        result.errors.push(`${p.nip}: no PTID mapping (not in HR master file — see scripts/importSippPtidFromHrFile.ts)`);
        continue;
      }
      const recordsForTargetMonth = await getAbsensiByNip(p.nip, ptId, startDate, endDate);

      if (recordsForTargetMonth == null) {
        result.errors.push(`${p.nip}: SIPP call failed`);
        continue;
      }
      const avgLateHours = computeAvgLateHours(recordsForTargetMonth);
      if (avgLateHours == null) {
        result.noData++;
        continue;
      }

      await prisma.kpiMonthlyEntry.upsert({
        where: { nip_period: { nip: p.nip, period: targetPeriod } },
        create: { nip: p.nip, period: targetPeriod, absensiValue: avgLateHours, absensiSource: "SIPP_SYNC", absensiInputAt: now },
        update: { absensiValue: avgLateHours, absensiSource: "SIPP_SYNC", absensiInputAt: now },
      });
      result.updated++;
    } catch (err) {
      result.errors.push(`${p.nip}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
