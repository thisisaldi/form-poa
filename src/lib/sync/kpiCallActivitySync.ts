/**
 * Fills KpiMonthlyEntry.callActivityRealisasi from the Exodus Activity API's
 * "Get Count Visit By NIP" endpoint (see src/lib/exodusApi.ts's
 * getVisitCountByNip, docs/TODO.md #38 — resolved 2026-09-08, stakeholder
 * supplied the URL). Same shape as kpiAbsensiSync.ts: one HTTP call per
 * active MR/ASM/SM, only triggered manually (ADMIN presses "Sync Kunjungan
 * dari Exodus" on /kpi-perpanjangan), no automatic schedule for v1.
 *
 * Manual overrides win: a row whose callActivitySource is already "MANUAL" is
 * left untouched, same "manual wins" contract as absensi.
 */

import { prisma } from "@/lib/prisma";
import { getVisitCountByNip } from "@/lib/exodusApi";
import { CALL_ACTIVITY_STANDARD_BY_ROLE } from "@/lib/kpiScoring";

export interface KpiCallActivitySyncResult {
  period: string;
  scanned: number;
  updated: number;
  skippedManual: number;
  noData: number;
  errors: string[];
}

/** Syncs callActivityRealisasi for every active MR/ASM/SM for `period` ("YYYY-MM", defaults to current month). */
export async function runKpiCallActivitySync(period?: string): Promise<KpiCallActivitySyncResult> {
  const now = new Date();
  const targetPeriod = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const periodeYYYYMM = targetPeriod.replace("-", "");

  const result: KpiCallActivitySyncResult = { period: targetPeriod, scanned: 0, updated: 0, skippedManual: 0, noData: 0, errors: [] };

  const personnel = (await prisma.user.findMany({
    where: { role: { in: ["MR", "ASM", "SM"] }, isActive: true, isDummy: false },
    select: { nip: true, role: true },
  })) as { nip: string; role: string }[];
  if (personnel.length === 0) return result;

  const existingEntries = (await prisma.kpiMonthlyEntry.findMany({
    where: { nip: { in: personnel.map((p) => p.nip) }, period: targetPeriod },
    select: { nip: true, callActivitySource: true },
  })) as { nip: string; callActivitySource: string }[];
  const manualNips = new Set(existingEntries.filter((e) => e.callActivitySource === "MANUAL").map((e) => e.nip));

  for (const p of personnel) {
    result.scanned++;
    if (manualNips.has(p.nip)) {
      result.skippedManual++;
      continue;
    }

    try {
      const actualByPeriod = await getVisitCountByNip(p.nip, periodeYYYYMM, periodeYYYYMM);
      if (actualByPeriod == null) {
        result.errors.push(`${p.nip}: Exodus call failed`);
        continue;
      }
      const realisasi = actualByPeriod[periodeYYYYMM];
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
