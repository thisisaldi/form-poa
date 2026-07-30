"use server";

/**
 * KPI Monitoring (Monitoring KPI Perpanjangan) — see docs/kpi-monitoring/.
 * v1 scope: ADMIN-only listing + manual input for Call Activity/Absensi.
 * Contract-evaluation workflow (KpiContractEvaluation) is spec'd but NOT
 * built yet — see docs/kpi-monitoring/03-ui-and-access.md.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getSubordinateMRNips } from "@/lib/authz";
import { getActivePsspByOutlets } from "@/app/actions/customer";
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

  customerAktifCount: number;
  customerScore: number;

  absensiValue: number | null;
  absensiScore: number | null;

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

  type KpiEntryRow = {
    nip: string;
    callActivityRealisasi: number | null;
    callActivityStandar: number | null;
    absensiValue: { toString(): string } | null;
  };

  const [entries, poas, assignments] = await Promise.all([
    prisma.kpiMonthlyEntry.findMany({ where: { nip: { in: nips }, period } }) as Promise<KpiEntryRow[]>,
    mrNips.length > 0
      ? (prisma.poaForm.findMany({
          where: { ownerId: { in: mrNips }, period, status: { in: ["APPROVED_BY_ASM", "APPROVED_BY_SM", "APPROVED_BY_NSM"] } },
          select: { ownerId: true, target: true },
        }) as Promise<{ ownerId: string; target: { toString(): string } | null }[]>)
      : Promise.resolve([] as { ownerId: string; target: { toString(): string } | null }[]),
    mrNips.length > 0
      ? (prisma.mrOutletAssignment.findMany({ where: { nipMR: { in: mrNips } }, select: { nipMR: true, kodePI: true } }) as Promise<{ nipMR: string; kodePI: string }[]>)
      : Promise.resolve([] as { nipMR: string; kodePI: string }[]),
  ]);

  const entryByNip = new Map(entries.map((e) => [e.nip, e]));

  const targetByMr = new Map<string, number>();
  for (const p of poas) targetByMr.set(p.ownerId, (targetByMr.get(p.ownerId) ?? 0) + toNum(p.target));

  const outletsByMr = new Map<string, string[]>();
  for (const a of assignments) outletsByMr.set(a.nipMR, [...(outletsByMr.get(a.nipMR) ?? []), a.kodePI]);
  const allOutlets = [...new Set(assignments.map((a) => a.kodePI))];

  const periodeYYYYMM = period.replace("-", "");
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

    const absensiValue = entry?.absensiValue != null ? toNum(entry.absensiValue) : null;
    const absensiScore = absensiValue != null ? scoreAbsensi(absensiValue) : null;

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
      customerAktifCount,
      customerScore,
      absensiValue,
      absensiScore,
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
 * month — the only two indicators with no automated data source (see
 * docs/kpi-monitoring/02-data-model.md §2). Only touches fields that were
 * actually passed (undefined = leave as-is).
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
      callActivityInputByNip: input.callActivityRealisasi != null ? session.userId : null,
      callActivityInputAt: input.callActivityRealisasi != null ? now : null,
      absensiValue: input.absensiValue ?? null,
      absensiInputByNip: input.absensiValue != null ? session.userId : null,
      absensiInputAt: input.absensiValue != null ? now : null,
    },
    update: {
      ...(input.callActivityRealisasi !== undefined
        ? {
            callActivityRealisasi: input.callActivityRealisasi,
            callActivityStandar,
            callActivityInputByNip: session.userId,
            callActivityInputAt: now,
          }
        : {}),
      ...(input.absensiValue !== undefined
        ? {
            absensiValue: input.absensiValue,
            absensiInputByNip: session.userId,
            absensiInputAt: now,
          }
        : {}),
    },
  });

  revalidatePath("/kpi-perpanjangan");
}
