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
 * PTID comes from the HR master file (scripts/importSippPtidFromHrFile.ts ->
 * SippEmployee.ptid, and User.sippAbsPtId for the current NIP) — ground
 * truth per NIP, not a prefix guess (the old P/L/F-prefix guess had ~1,083
 * "P"-prefixed NIPs wrong, actually PTID 7 not 1). A current NIP with no PTID
 * is reported as an error, not silently skipped — re-run the import script
 * when HR sends a refreshed file.
 *
 * NIP changes (2026-09-24): the same normalized HR name = the same person, so
 * attendance is gathered across ALL of a person's NIPs that overlap the month
 * (see kpiIdentity.ts), merged, then averaged; the result is stored under
 * the current NIP.
 */

import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { loadIdentities, dedupeByIdentity, KPI_PERSONNEL_FILTER } from "@/lib/kpiIdentity";
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

  const allPersonnel = (await prisma.user.findMany({
    where: { role: { in: ["MR", "ASM", "SM"] }, ...KPI_PERSONNEL_FILTER },
    select: { nip: true, sippAbsPtId: true },
  })) as { nip: string; sippAbsPtId: number | null }[];
  if (allPersonnel.length === 0) return result;
  const identities = await loadIdentities(allPersonnel.map((p) => p.nip));
  const personnel = dedupeByIdentity(allPersonnel, identities);

  const existingEntries = (await prisma.kpiMonthlyEntry.findMany({
    where: { nip: { in: personnel.flatMap((p) => [p.nip, ...(identities.get(p.nip)?.nips.map((a) => a.nip) ?? [])]) }, period: targetPeriod },
    select: { nip: true, absensiSource: true, absensiValue: true },
  })) as { nip: string; absensiSource: string; absensiValue: unknown }[];
  const manualEntryNips = new Set(existingEntries.filter((e) => e.absensiSource === "MANUAL" && e.absensiValue != null).map((e) => e.nip));
  // A manual value entered under any of the person's NIPs counts.
  const manualNips = new Set(
    personnel
      .filter((p) => [p.nip, ...(identities.get(p.nip)?.nips.map((a) => a.nip) ?? [])].some((n) => manualEntryNips.has(n)))
      .map((p) => p.nip)
  );

  const { startDate, endDate } = monthDateRange(targetPeriod);
  const monthStart = new Date(`${startDate}T00:00:00Z`);
  const monthEnd = new Date(`${endDate}T23:59:59Z`);

  for (const p of personnel) {
    result.scanned++;
    if (manualNips.has(p.nip)) {
      result.skippedManual++;
      continue;
    }

    try {
      // Own NIP always; aliases only if their employment overlaps the month (saves SIPP calls).
      const aliases = (identities.get(p.nip)?.nips ?? []).filter(
        (a) => a.nip !== p.nip && (!a.tglMasuk || a.tglMasuk <= monthEnd) && (!a.tglKeluar || a.tglKeluar >= monthStart)
      );
      const ownPtId = p.sippAbsPtId ?? identities.get(p.nip)?.nips.find((a) => a.nip === p.nip)?.ptid ?? null;
      if (ownPtId == null) {
        result.errors.push(`${p.nip}: no PTID mapping (not in HR master file — see scripts/importSippPtidFromHrFile.ts)`);
        continue;
      }

      const recordsForTargetMonth: NonNullable<Awaited<ReturnType<typeof getAbsensiByNip>>> = [];
      let failed = false;
      const lookups: [string, number][] = [[p.nip, ownPtId], ...aliases.map((a): [string, number] => [a.nip, a.ptid])];
      for (const [nip, ptId] of lookups) {
        const recs = await getAbsensiByNip(nip, ptId, startDate, endDate);
        if (recs == null) {
          result.errors.push(`${p.nip}: SIPP call failed${nip === p.nip ? "" : ` (alias ${nip})`}`);
          failed = true;
          break;
        }
        recordsForTargetMonth.push(...recs);
      }
      if (failed) continue;
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
