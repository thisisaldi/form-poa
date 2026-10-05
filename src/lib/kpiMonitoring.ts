/**
 * KPI Monitoring scoring core (Hospital) — moved out of actions/kpi.ts so other
 * server actions can reuse it without it becoming a client-callable action.
 * No access check here: callers own the scope.
 */

import { prisma } from "@/lib/prisma";
import { getSubordinateMRNips } from "@/lib/authz";
import { loadIdentities, dedupeByIdentity, allNips, KPI_PERSONNEL_FILTER } from "@/lib/kpiIdentity";
import { resolveTargetForNipGroups } from "@/lib/targetHospitalValue";
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

export type KpiPersonnelRow = {
  nip: string;
  name: string;
  role: string;
  jabatan: string | null;
  /** Territory label for filtering: Outlet.namaArea (MR/SPV/ASM) or namaReg (SM), most frequent across the team's outlets. */
  area: string | null;

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
  /** ISO time + NIP of whoever last wrote the Call Activity value (sync job writes the sync time, no NIP). */
  callActivityInputAt: string | null;
  callActivityInputByNip: string | null;

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
 * Scoring core, no access check — callers decide the scope (`null` = every
 * active personnel). Lives in lib/ (not an action) so it is never client-callable;
 * getKpiLeaderboard / kpiDetail actions apply their own access rules.
 */
export async function computeKpiRows(period: string, scopeNips: string[] | null, opts: { hospitalOnly?: boolean } = {}): Promise<KpiPersonnelRow[]> {
  const allPersonnel = (await prisma.user.findMany({
    where: {
      role: { in: ["MR", "ASM", "SM"] },
      ...KPI_PERSONNEL_FILTER,
      // Non-Hospital (OMEGA) has its own scoring — nonHospitalEvaluation.ts. `not` alone would drop NULL projects.
      ...(opts.hospitalOnly ? { OR: [{ project: null }, { project: { not: "OMEGA" } }] } : {}),
      ...(scopeNips ? { nip: { in: scopeNips } } : {}),
    },
    select: { nip: true, name: true, role: true, jabatan: true },
    orderBy: { name: "asc" },
  })) as { nip: string; name: string; role: string; jabatan: string | null }[];
  if (allPersonnel.length === 0) return [];
  // Same person under several NIPs (NIP changed, e.g. P->L) shows once, and
  // their entries are read across all their NIPs — see src/lib/kpiIdentity.ts.
  const identities = await loadIdentities(allPersonnel.map((p) => p.nip));
  const personnel = dedupeByIdentity(allPersonnel, identities);

  const nips: string[] = personnel.map((p) => p.nip);
  const mrNips: string[] = personnel.filter((p) => p.role === "MR").map((p) => p.nip);
  const periodeYYYYMM = period.replace("-", "");

  type KpiEntryRow = {
    nip: string;
    callActivityRealisasi: number | null;
    callActivityStandar: number | null;
    callActivitySource: string | null;
    callActivityInputAt: Date | null;
    callActivityInputByNip: string | null;
    absensiValue: { toString(): string } | null;
    absensiSource: string | null;
  };

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

  const mrsUnderByNip = new Map<string, string[]>();
  for (const p of personnel) mrsUnderByNip.set(p.nip, await subordinateMrNips(p.nip, p.role));
  // Every MR that counts toward anyone's numbers (an ASM/SM's team can include
  // MRs that aren't rows of this listing themselves).
  const allMrNips = [...new Set([...mrNips, ...[...mrsUnderByNip.values()].flat()])];
  const periodeInt = parseInt(periodeYYYYMM, 10);

  // Sales target: TargetHospitalValue is natively monthly (periode YYYYMM,
  // same granularity as this page's period picker) — no quarter conversion
  // needed, unlike PoaForm.target which is set once per quarter and would
  // require mapping this month back to its quarter first. Resolved LIVE via
  // resolveTargetForNipGroups (2026-09-14 — TargetHospitalValue no longer
  // has a nipMR column at all, see resolveTargetByNipAndMonths' doc comment in
  // src/lib/targetHospitalValue.ts). Targets AND outlet assignments are both
  // scoped to THIS period (2026-09-25 fix: actual sales used to read the
  // assignments of every period while the target used only this one, so an MR
  // who changed outlets got another month's outlets' sales against this
  // month's target). An ASM/SM's target counts each GT once across the whole
  // team, not once per MR.
  const [entries, targetByNip, assignments] = await Promise.all([
    prisma.kpiMonthlyEntry.findMany({ where: { nip: { in: personnel.flatMap((p) => allNips(p.nip, identities.get(p.nip))) }, period } }) as Promise<KpiEntryRow[]>,
    resolveTargetForNipGroups(mrsUnderByNip, periodeYYYYMM),
    allMrNips.length > 0
      ? (prisma.mrOutletAssignment.findMany({ where: { nipMR: { in: allMrNips }, periode: periodeInt }, select: { nipMR: true, kodePI: true } }) as Promise<{ nipMR: string; kodePI: string }[]>)
      : Promise.resolve([] as { nipMR: string; kodePI: string }[]),
  ]);

  const entryRaw = new Map(entries.map((e) => [e.nip, e]));
  // Own NIP's entry wins; otherwise fall back to an entry left under one of the person's other NIPs.
  const entryByNip = new Map<string, KpiEntryRow>();
  for (const p of personnel) {
    const e = allNips(p.nip, identities.get(p.nip)).map((n) => entryRaw.get(n)).find(Boolean);
    if (e) entryByNip.set(p.nip, e);
  }

  const outletsByMr = new Map<string, string[]>();
  for (const a of assignments) outletsByMr.set(a.nipMR, [...(outletsByMr.get(a.nipMR) ?? []), a.kodePI]);
  const allOutlets = [...new Set(assignments.map((a) => a.kodePI))];

  const salesRows = allOutlets.length > 0
    ? ((await prisma.outletSalesValueMonthly.findMany({ where: { kodePI: { in: allOutlets }, periode: periodeYYYYMM }, select: { kodePI: true, valueSales: true } })) as { kodePI: string; valueSales: { toString(): string } }[])
    : [];
  const salesByOutlet = new Map(salesRows.map((r) => [r.kodePI, toNum(r.valueSales)]));

  const outletTerritory = allOutlets.length > 0
    ? ((await prisma.outlet.findMany({ where: { kodePI: { in: allOutlets } }, select: { kodePI: true, namaArea: true, namaReg: true } })) as { kodePI: string; namaArea: string | null; namaReg: string | null }[])
    : [];
  const territoryByOutlet = new Map(outletTerritory.map((o) => [o.kodePI, o]));
  function teamArea(mrs: string[], role: string): string | null {
    const count = new Map<string, number>();
    for (const n of mrs) for (const o of outletsByMr.get(n) ?? []) {
      const t = territoryByOutlet.get(o);
      const label = role === "SM" ? t?.namaReg : t?.namaArea;
      if (label) count.set(label, (count.get(label) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  /** Sales of a team's outlets, each outlet counted once even if two MRs both hold it. */
  function teamSalesActual(mrs: string[]): number {
    const outlets = new Set<string>();
    for (const n of mrs) for (const o of outletsByMr.get(n) ?? []) outlets.add(o);
    let sum = 0;
    for (const o of outlets) sum += salesByOutlet.get(o) ?? 0;
    return sum;
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

  const rows: KpiPersonnelRow[] = [];
  for (const p of personnel) {
    const mrsUnder = mrsUnderByNip.get(p.nip) ?? [];

    const salesTargetRp = targetByNip.get(p.nip) ?? 0;
    const salesActualRp = teamSalesActual(mrsUnder);
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
      area: teamArea(mrsUnder, p.role),
      salesTargetRp,
      salesActualRp,
      salesAchievementPct,
      salesScore,
      callActivityRealisasi,
      callActivityStandar,
      activityAchievementPct,
      activityScore,
      callActivitySource,
      callActivityInputAt: entry?.callActivityInputAt?.toISOString() ?? null,
      callActivityInputByNip: entry?.callActivityInputByNip ?? null,
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

