"use server";

/**
 * KPI Monitoring (Monitoring KPI Perpanjangan) — see docs/kpi-monitoring/.
 * v1 scope: ADMIN-only listing + manual input for Call Activity, and for
 * Absensi when the SIPP sync (src/lib/sync/kpiAbsensiSync.ts) hasn't already
 * filled it for the period — this module just reads whatever KpiMonthlyEntry
 * has, same code path either way. Contract-evaluation workflow
 * (KpiContractEvaluation) is spec'd but NOT built yet — see
 * docs/kpi-monitoring/03-ui-and-access.md.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getSubordinateMRNips } from "@/lib/authz";
import { resolveTargetByNipAndMonths } from "@/lib/targetHospitalValue";
import { getActivePsspByOutlets } from "@/app/actions/customer";
import { runKpiAbsensiSync, type KpiAbsensiSyncResult } from "@/lib/sync/kpiAbsensiSync";
import { runKpiCallActivitySync, type KpiCallActivitySyncResult } from "@/lib/sync/kpiCallActivitySync";
import {
  CALL_ACTIVITY_STANDARD_BY_ROLE,
  computeTotalScore,
  recommendContractMonths,
  scoreAbsensi,
  scoreCallActivity,
  scoreCustomerExpansion,
  scoreSalesAchievement,
  type ContractRecommendation,
} from "@/lib/kpiScoring";
import type { Role, User } from "@prisma/client";

function toNum(v: { toString(): string } | number | string | null | undefined): number {
  return parseFloat(String(v ?? 0)) || 0;
}

async function requireAdmin() {
  const session = await getCurrentUser();
  if (!session || session.role !== "ADMIN") {
    throw new Error("KPI Monitoring is ADMIN-only for now.");
  }
  return session;
}

export type KpiPersonnelRow = {
  nip: string;
  name: string;
  role: string;
  jabatan: string | null;

  salesTargetRp: number;
  salesActualRp: number;
  salesAchievementPct: number | null;
  salesScore: number | null;

  callActivityRealisasi: number | null;
  callActivityStandar: number;
  activityAchievementPct: number | null;
  activityScore: number | null;
  /** "MANUAL" | "EXODUS_SYNC" — see docs/kpi-monitoring/01-business-rules.md §2b. Null when no entry exists yet. */
  callActivitySource: string | null;

  customerAktifCount: number;
  customerScore: number;

  absensiValue: number | null;
  absensiScore: number | null;
  /** "MANUAL" | "SIPP_SYNC" — see docs/kpi-monitoring/01-business-rules.md §2d. Null when no entry exists yet. */
  absensiSource: string | null;

  totalScore: number | null;
  recommendation: ContractRecommendation | null;
};

/**
 * ADMIN-only listing for /kpi-perpanjangan: one row per active MR/ASM/SM,
 * scored for the given month. Sales Achievement + Customer Expansion are
 * derived live from existing sales/PSSP data (same sources as the Monitoring
 * page); Call Activity/Absensi come from whatever KpiMonthlyEntry a prior
 * saveKpiManualInputAction call left for this nip+period (null if nobody has
 * entered it yet — deliberately NOT defaulted to a band score, so missing
 * manual data reads as "belum diisi", not as a bad score).
 */
export async function getKpiMonitoringData(period: string): Promise<KpiPersonnelRow[]> {
  await requireAdmin();

  const personnel = (await prisma.user.findMany({
    where: { role: { in: ["MR", "ASM", "SM"] }, isActive: true, isDummy: false },
    select: { nip: true, name: true, role: true, jabatan: true },
    orderBy: { name: "asc" },
  })) as { nip: string; name: string; role: string; jabatan: string | null }[];
  if (personnel.length === 0) return [];

  const nips: string[] = personnel.map((p) => p.nip);
  const mrNips: string[] = personnel.filter((p) => p.role === "MR").map((p) => p.nip);
  const periodeYYYYMM = period.replace("-", "");

  type KpiEntryRow = {
    nip: string;
    callActivityRealisasi: number | null;
    callActivityStandar: number | null;
    callActivitySource: string | null;
    absensiValue: { toString(): string } | null;
    absensiSource: string | null;
  };

  // Sales target: TargetHospitalValue is natively monthly (periode YYYYMM,
  // same granularity as this page's period picker) — no quarter conversion
  // needed, unlike PoaForm.target which is set once per quarter and would
  // require mapping this month back to its quarter first. Resolved LIVE via
  // resolveTargetByNipAndMonths (2026-09-14 — TargetHospitalValue no longer
  // has a nipMR column at all, see that function's doc comment in
  // src/lib/targetHospitalValue.ts).
  const [entries, targetByNipPeriode, assignments] = await Promise.all([
    prisma.kpiMonthlyEntry.findMany({ where: { nip: { in: nips }, period } }) as Promise<KpiEntryRow[]>,
    resolveTargetByNipAndMonths(mrNips, [periodeYYYYMM]),
    mrNips.length > 0
      ? (prisma.mrOutletAssignment.findMany({ where: { nipMR: { in: mrNips } }, select: { nipMR: true, kodePI: true } }) as Promise<{ nipMR: string; kodePI: string }[]>)
      : Promise.resolve([] as { nipMR: string; kodePI: string }[]),
  ]);

  const entryByNip = new Map(entries.map((e) => [e.nip, e]));

  const targetByMr = new Map<string, number>();
  for (const nip of mrNips) {
    const v = targetByNipPeriode.get(`${nip}|${periodeYYYYMM}`);
    if (v != null) targetByMr.set(nip, v);
  }

  const outletsByMr = new Map<string, string[]>();
  for (const a of assignments) outletsByMr.set(a.nipMR, [...(outletsByMr.get(a.nipMR) ?? []), a.kodePI]);
  const allOutlets = [...new Set(assignments.map((a) => a.kodePI))];

  const salesRows = allOutlets.length > 0
    ? ((await prisma.outletSalesValueMonthly.findMany({ where: { kodePI: { in: allOutlets }, periode: periodeYYYYMM }, select: { kodePI: true, valueSales: true } })) as { kodePI: string; valueSales: { toString(): string } }[])
    : [];
  const salesByOutlet = new Map(salesRows.map((r) => [r.kodePI, toNum(r.valueSales)]));

  function mrSalesActual(nip: string): number {
    return (outletsByMr.get(nip) ?? []).reduce((s, o) => s + (salesByOutlet.get(o) ?? 0), 0);
  }

  // Customer Expansion proxy (§2c, working assumption): active PSSP contracts
  // per outlet, distinct kdCust per MR's assigned outlets.
  const activePssp = allOutlets.length > 0 ? await getActivePsspByOutlets(allOutlets) : [];
  const custByOutlet = new Map<string, Set<string>>();
  for (const row of activePssp) {
    if (!row.kdOutlet) continue;
    const set = custByOutlet.get(row.kdOutlet) ?? new Set<string>();
    set.add(row.kdCust);
    custByOutlet.set(row.kdOutlet, set);
  }
  function mrCustomerAktifCount(nip: string): number {
    const set = new Set<string>();
    for (const o of outletsByMr.get(nip) ?? []) {
      for (const c of custByOutlet.get(o) ?? []) set.add(c);
    }
    return set.size;
  }

  // ASM/SM roll-up: reuse authz's role-aware subtree walk (only role+nip are
  // read by getSubordinateMRNips) rather than re-deriving org depth here.
  const subtreeCache = new Map<string, string[]>();
  async function subordinateMrNips(nip: string, role: string): Promise<string[]> {
    if (role === "MR") return [nip];
    const key = `${role}:${nip}`;
    const cached = subtreeCache.get(key);
    if (cached) return cached;
    const list = await getSubordinateMRNips({ nip, role: role as Role } as User);
    subtreeCache.set(key, list);
    return list;
  }

  const rows: KpiPersonnelRow[] = [];
  for (const p of personnel) {
    const mrsUnder = await subordinateMrNips(p.nip, p.role);

    const salesTargetRp = mrsUnder.reduce((s, n) => s + (targetByMr.get(n) ?? 0), 0);
    const salesActualRp = mrsUnder.reduce((s, n) => s + mrSalesActual(n), 0);
    const salesAchievementPct = salesTargetRp > 0 ? (salesActualRp / salesTargetRp) * 100 : null;
    const salesScore = salesAchievementPct != null ? scoreSalesAchievement(salesAchievementPct) : null;

    // Memo §2c: SM & ASM use the AVERAGE of their MR/Spv's active-customer
    // counts, not a union across the whole subtree.
    let customerAktifCount: number;
    if (p.role === "MR") {
      customerAktifCount = mrCustomerAktifCount(p.nip);
    } else {
      const perMr = mrsUnder.map((n) => mrCustomerAktifCount(n));
      customerAktifCount = perMr.length > 0 ? Math.round(perMr.reduce((s, v) => s + v, 0) / perMr.length) : 0;
    }
    const customerScore = scoreCustomerExpansion(customerAktifCount);

    const entry = entryByNip.get(p.nip);
    const callActivityStandar = entry?.callActivityStandar ?? CALL_ACTIVITY_STANDARD_BY_ROLE[p.role] ?? 0;
    const callActivityRealisasi = entry?.callActivityRealisasi ?? null;
    const activityAchievementPct = callActivityRealisasi != null && callActivityStandar > 0
      ? (callActivityRealisasi / callActivityStandar) * 100
      : null;
    const activityScore = activityAchievementPct != null ? scoreCallActivity(activityAchievementPct) : null;
    const callActivitySource = entry?.callActivitySource ?? null;

    const absensiValue = entry?.absensiValue != null ? toNum(entry.absensiValue) : null;
    const absensiScore = absensiValue != null ? scoreAbsensi(absensiValue) : null;
    const absensiSource = entry?.absensiSource ?? null;

    const allScored = salesScore != null && activityScore != null && customerScore != null && absensiScore != null;
    const totalScore = allScored
      ? computeTotalScore({ salesScore: salesScore!, activityScore: activityScore!, customerScore, absensiScore: absensiScore! })
      : null;

    rows.push({
      nip: p.nip,
      name: p.name,
      role: p.role,
      jabatan: p.jabatan,
      salesTargetRp,
      salesActualRp,
      salesAchievementPct,
      salesScore,
      callActivityRealisasi,
      callActivityStandar,
      activityAchievementPct,
      activityScore,
      callActivitySource,
      customerAktifCount,
      customerScore,
      absensiValue,
      absensiScore,
      absensiSource,
      totalScore,
      recommendation: totalScore != null ? recommendContractMonths(totalScore) : null,
    });
  }

  // Worst (or not-yet-scored) first — same convention as Monitoring page.
  rows.sort((a, b) => {
    if (a.totalScore == null && b.totalScore == null) return a.name.localeCompare(b.name);
    if (a.totalScore == null) return -1;
    if (b.totalScore == null) return 1;
    return a.totalScore - b.totalScore;
  });

  return rows;
}

/**
 * ADMIN-only: save the manual Call Activity/Absensi inputs for one personil ×
 * month — both can also be filled automatically by their respective syncs
 * (src/lib/sync/kpiCallActivitySync.ts, kpiAbsensiSync.ts). Touching either
 * field here always marks its *Source "MANUAL", so the sync job treats it as
 * an override and skips re-writing it on its next run — "manual wins"
 * contract documented in kpiAbsensiSync.ts, applies the same way to Call
 * Activity since 2026-09-08. Only touches fields that were actually passed
 * (undefined = leave as-is).
 */
export async function saveKpiManualInputAction(input: {
  nip: string;
  period: string;
  callActivityRealisasi?: number | null;
  absensiValue?: number | null;
}) {
  const session = await requireAdmin();

  const user = await prisma.user.findUniqueOrThrow({ where: { nip: input.nip }, select: { role: true } });
  const callActivityStandar = CALL_ACTIVITY_STANDARD_BY_ROLE[user.role] ?? null;
  const now = new Date();

  await prisma.kpiMonthlyEntry.upsert({
    where: { nip_period: { nip: input.nip, period: input.period } },
    create: {
      nip: input.nip,
      period: input.period,
      callActivityRealisasi: input.callActivityRealisasi ?? null,
      callActivityStandar,
      callActivitySource: "MANUAL",
      callActivityInputByNip: input.callActivityRealisasi != null ? session.userId : null,
      callActivityInputAt: input.callActivityRealisasi != null ? now : null,
      absensiValue: input.absensiValue ?? null,
      absensiSource: "MANUAL",
      absensiInputByNip: input.absensiValue != null ? session.userId : null,
      absensiInputAt: input.absensiValue != null ? now : null,
    },
    update: {
      ...(input.callActivityRealisasi !== undefined
        ? {
            callActivityRealisasi: input.callActivityRealisasi,
            callActivityStandar,
            callActivitySource: "MANUAL",
            callActivityInputByNip: session.userId,
            callActivityInputAt: now,
          }
        : {}),
      ...(input.absensiValue !== undefined
        ? {
            absensiValue: input.absensiValue,
            absensiSource: "MANUAL",
            absensiInputByNip: session.userId,
            absensiInputAt: now,
          }
        : {}),
    },
  });

  revalidatePath("/kpi-perpanjangan");
}

/**
 * ADMIN-only, manually triggered: pull this period's Absensi data from SIPP
 * for every active MR/ASM/SM (see src/lib/sync/kpiAbsensiSync.ts). No
 * automatic schedule — nobody asked for "always fresh," and running it
 * on-demand avoids an always-on background job for a feature an ADMIN
 * triggers deliberately before making contract decisions anyway.
 */
export async function syncKpiAbsensiAction(period: string): Promise<KpiAbsensiSyncResult> {
  await requireAdmin();
  const result = await runKpiAbsensiSync(period);
  revalidatePath("/kpi-perpanjangan");
  return result;
}

/**
 * ADMIN-only, manually triggered: pull this period's Call Activity (realized
 * visit count) from Exodus's "Get Count Visit By NIP" endpoint for every
 * active MR/ASM/SM (see src/lib/sync/kpiCallActivitySync.ts). Same
 * manually-triggered, no-schedule pattern as syncKpiAbsensiAction.
 */
export async function syncKpiCallActivityAction(period: string): Promise<KpiCallActivitySyncResult> {
  await requireAdmin();
  const result = await runKpiCallActivitySync(period);
  revalidatePath("/kpi-perpanjangan");
  return result;
}
