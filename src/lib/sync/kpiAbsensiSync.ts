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
 * PTID discovery: this app has no per-user PT/company field, and the
 * population spans more than one PT (confirmed 2026-08-24). A wrong PTID
 * doesn't error, it silently returns no data — so for anyone without a
 * cached User.sippAbsPtId, this tries every ABS_PT_ID_CANDIDATES value over a
 * WIDE lookback window (not just the target month) before giving up, since
 * "no records this month" and "wrong PT" look identical over a single month.
 * First candidate with any record in that window wins and gets cached —
 * future runs skip straight to it.
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

const DISCOVERY_LOOKBACK_MONTHS = 6;

// Only "1" (PT. Pharos Indonesia) and "7" (PML) are named in the SIPP API
// doc — same list on staging and production (verified 2026-08-24 on both).
// Not a secret and doesn't vary by environment, so it's a constant, not an
// env var. Add a third PT ID here (confirmed by SIPP/HR ops, not guessed) if
// a real NIP ever ends up with sippAbsPtId still null after a sync run.
const ABS_PT_ID_CANDIDATES = [1, 7];

/** At least DISCOVERY_LOOKBACK_MONTHS back from today, but always widened to include `targetPeriod` too (re-syncing an old month shouldn't miss it). */
function widePtIdDiscoveryRange(targetPeriod: string): { startDate: string; endDate: string } {
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth() - (DISCOVERY_LOOKBACK_MONTHS - 1), 1);
  const defaultStartPeriod = `${defaultStart.getFullYear()}-${String(defaultStart.getMonth() + 1).padStart(2, "0")}`;
  const defaultEndPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const startPeriod = targetPeriod < defaultStartPeriod ? targetPeriod : defaultStartPeriod;
  const endPeriod = targetPeriod > defaultEndPeriod ? targetPeriod : defaultEndPeriod;
  return { startDate: monthDateRange(startPeriod).startDate, endDate: monthDateRange(endPeriod).endDate };
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
    where: { role: { in: ["MR", "ASM", "SM"] }, isActive: true, isDummy: false },
    select: { nip: true, sippAbsPtId: true },
  })) as { nip: string; sippAbsPtId: number | null }[];
  if (personnel.length === 0) return result;

  const existingEntries = (await prisma.kpiMonthlyEntry.findMany({
    where: { nip: { in: personnel.map((p) => p.nip) }, period: targetPeriod },
    select: { nip: true, absensiSource: true },
  })) as { nip: string; absensiSource: string }[];
  const manualNips = new Set(existingEntries.filter((e) => e.absensiSource === "MANUAL").map((e) => e.nip));

  const { startDate, endDate } = monthDateRange(targetPeriod);
  const discoveryRange = widePtIdDiscoveryRange(targetPeriod);

  for (const p of personnel) {
    result.scanned++;
    if (manualNips.has(p.nip)) {
      result.skippedManual++;
      continue;
    }

    try {
      let ptId = p.sippAbsPtId;
      let recordsForTargetMonth: Awaited<ReturnType<typeof getAbsensiByNip>> = null;

      if (ptId != null) {
        recordsForTargetMonth = await getAbsensiByNip(p.nip, ptId, startDate, endDate);
      } else {
        // Not cached yet — probe candidates over the wide window until one has data.
        for (const candidate of ABS_PT_ID_CANDIDATES) {
          const wideRecords = await getAbsensiByNip(p.nip, candidate, discoveryRange.startDate, discoveryRange.endDate);
          if (wideRecords && wideRecords.length > 0) {
            ptId = candidate;
            await prisma.user.update({ where: { nip: p.nip }, data: { sippAbsPtId: candidate } });
            recordsForTargetMonth = wideRecords.filter((r) => r.absDateIn >= startDate && r.absDateIn <= `${endDate}T23:59:59`);
            break;
          }
        }
        if (ptId == null) {
          result.noData++; // no candidate had any data in 6 months — likely new hire or genuinely no PT match yet
          continue;
        }
      }

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
