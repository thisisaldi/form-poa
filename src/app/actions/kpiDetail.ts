"use server";

/**
 * Detail KPI (docs/kpi-monitoring/04-final-layout.md §3-5, §9): daftar bawahan
 * → kartu detail per personil → form evaluasi + rantai approval (ASM/SM/NSM,
 * src/lib/kpiApproval.ts). Akses = ADMIN dan SD (semua; SD hanya-baca) atau
 * ASM/SM/NSM untuk seluruh bawahan di subtree (`User.nipAtasan`, sama untuk
 * Hospital dan Non-Hospital). Window evaluasi = 6 bulan selesai terakhir
 * (belum ada data kontrak Hospital — §7 Q3, keputusan 2026-10-05).
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { assertWritable } from "@/lib/maintenance";
import { loadIdentities, normalizeName } from "@/lib/kpiIdentity";
import { computeKpiRows, type KpiPersonnelRow } from "@/lib/kpiMonitoring";
import { getNonHospitalMonitoringRows, type NhMonitoringRow } from "@/lib/nonHospitalEvaluation";
import { addMonths, periodOf, NH_WINDOW_MONTHS } from "@/lib/nonHospitalScoring";
import { KPI_WEIGHTS, recommendContractMonths } from "@/lib/kpiScoring";
import { getSubordinateMRNips, getSubordinateOwnerNips } from "@/lib/authz";
import { actionFor, chainFor, evaluatorFor, isFullyApproved, statusText, type Action, type ApprovalStep } from "@/lib/kpiApproval";
import { getAbsensiByNip, monthDateRange } from "@/lib/sippApi";
import type { Role, User } from "@prisma/client";
import { canUseKpiPersonil } from "@/lib/kpiAccess";

export type KpiScheme = "hospital" | "non-hospital";
const VIEWER_ROLES = ["ADMIN", "SD", "ASM", "SM", "NSM"].filter(canUseKpiPersonil);
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DECISION_MONTHS = [12, 9, 6, 0] as const;

/** Last completed month = default period everywhere in KPI (sales/visit data land after month end). */
export async function lastCompletedPeriod(): Promise<string> {
  return addMonths(periodOf(new Date()), -1);
}

async function requireEvaluator() {
  const session = await getCurrentUser();
  if (!session || !VIEWER_ROLES.includes(session.role)) throw new Error("Detail KPI hanya untuk atasan.");
  return session;
}

/** NIPs the viewer may open: ADMIN/SD → null (every personnel of the scheme); ASM/SM/NSM → their whole subtree, not themself. */
async function allowedNips(session: { nip: string; role: string }): Promise<string[] | null> {
  if (session.role === "ADMIN" || session.role === "SD") return null;
  const subtree = await getSubordinateOwnerNips({ nip: session.nip, role: session.role as Role } as User);
  return subtree.filter((n) => n !== session.nip);
}

const avg = (v: (number | null)[]) => {
  const x = v.filter((n): n is number => n != null);
  return x.length ? x.reduce((s, n) => s + n, 0) / x.length : null;
};
const round2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

export type Decision = {
  /** Who has approved so far, per chain step (the evaluator's own step is recorded when the evaluation is saved). */
  steps: Record<string, { at: string; byName: string | null }>;
  months: number;
  reason: string | null;
  dev: string;
  direction: string | null;
  at: string;
  byName: string | null;
  systemMonths: number | null;
};

export type SubordinateRow = {
  nip: string;
  name: string;
  role: string;
  jabatan: string | null;
  area: string | null;
  point: number | null;
  rec: { months: number; label: string } | null;
  akhirKontrak: string | null;
  complete: boolean;
  notes: string[];
  /** Angka mentah + skor per pilar untuk `period` (dipakai export detail). */
  month: DetailMonth;
  decision: Decision | null;
  /** "Belum dievaluasi" · "Disetujui SM, menunggu ASM & NSM" · "Disetujui lengkap". */
  status: string;
  fullyApproved: boolean;
  /** What the viewer may do on this personil now (null = nothing / read-only). */
  act: Action;
};

/** Roles that actually exist above each personil (≤4 hops, one batched query per level). */
async function rolesAbove(nips: string[]): Promise<Map<string, ReadonlySet<string>>> {
  const parent = new Map<string, string | null>(), role = new Map<string, string>();
  let frontier = [...new Set(nips)];
  for (let level = 0; level < 5 && frontier.length > 0; level++) {
    const rows = (await prisma.user.findMany({ where: { nip: { in: frontier } }, select: { nip: true, role: true, nipAtasan: true } })) as { nip: string; role: string; nipAtasan: string | null }[];
    for (const r of rows) { parent.set(r.nip, r.nipAtasan); role.set(r.nip, r.role); }
    frontier = [...new Set(rows.map((r) => r.nipAtasan).filter((n): n is string => !!n && !parent.has(n)))];
  }
  const out = new Map<string, ReadonlySet<string>>();
  for (const nip of nips) {
    const seen = new Set<string>();
    let cur = parent.get(nip), guard = 0;
    while (cur && guard++ < 5) { const r = role.get(cur); if (r) seen.add(r); cur = parent.get(cur); }
    out.set(nip, seen);
  }
  return out;
}

async function decisionsFor(nips: string[], periodeAkhir: string): Promise<Map<string, Decision>> {
  if (nips.length === 0) return new Map();
  const rows = (await prisma.kpiContractEvaluation.findMany({
    where: { nip: { in: nips }, periodeAkhir },
    include: { evaluatedBy: { select: { name: true } }, approvals: { include: { approvedBy: { select: { name: true } } } } },
  })) as unknown as {
    nip: string; decisionMonths: number; decisionReason: string | null; developmentPlanNotes: string; directionRationale: string | null;
    evaluatedAt: Date; systemRecommendationMonths: number | null; evaluatedBy: { name: string } | null;
    approvals: { step: string; approvedAt: Date; approvedBy: { name: string } | null }[];
  }[];
  return new Map(rows.map((r) => [r.nip, {
    steps: Object.fromEntries(r.approvals.map((a) => [a.step, { at: a.approvedAt.toISOString(), byName: a.approvedBy?.name ?? null }])),
    months: r.decisionMonths, reason: r.decisionReason, dev: r.developmentPlanNotes, direction: r.directionRationale,
    at: r.evaluatedAt.toISOString(), byName: r.evaluatedBy?.name ?? null, systemMonths: r.systemRecommendationMonths,
  }]));
}

/** Daftar bawahan (halaman Detail KPI) — satu bulan `period`, bukan rata-rata window (hemat query untuk ADMIN). */
export async function getKpiSubordinates(scheme: KpiScheme, period: string): Promise<SubordinateRow[]> {
  const session = await requireEvaluator();
  if (!PERIOD_RE.test(period)) throw new Error("Periode tidak valid");
  const scope = await allowedNips(session);
  if (scope && scope.length === 0) return [];

  let rows: Omit<SubordinateRow, "decision" | "status" | "fullyApproved" | "act">[];
  if (scheme === "hospital") {
    const data = await computeKpiRows(period, scope, { hospitalOnly: true });
    rows = data.map((r) => ({
      nip: r.nip, name: r.name, role: r.role, jabatan: r.jabatan, area: r.area, point: r.totalScore, rec: r.recommendation,
      akhirKontrak: null, complete: r.totalScore != null, month: hospitalMonth(period, r),
      notes: [r.activityScore == null && "Call Activity belum terisi", r.absensiScore == null && "Absensi belum terisi", !r.salesTargetRp && "Target sales kosong"].filter((x): x is string => !!x),
    }));
  } else {
    const data = await getNonHospitalMonitoringRows(period, { scopeNips: scope });
    rows = data.map((r) => ({
      nip: r.nip, name: r.name, role: r.role, jabatan: r.jabatan, area: r.gt, point: r.totalScore, rec: r.recommendation,
      akhirKontrak: r.akhirKontrak, complete: r.notes.length === 0 && r.totalScore != null, notes: r.notes, month: nhMonth(period, r),
    }));
  }
  const [decisions, above] = await Promise.all([decisionsFor(rows.map((r) => r.nip), await lastCompletedPeriod()), rolesAbove(rows.map((r) => r.nip))]);
  const out: SubordinateRow[] = rows.map((r) => {
    const decision = decisions.get(r.nip) ?? null;
    const steps = decision ? decision.steps : null;
    const present = above.get(r.nip);
    return {
      ...r, decision, status: statusText(r.role, steps, present), fullyApproved: isFullyApproved(chainFor(r.role, present), steps),
      act: actionFor(session.role, r.role, steps, present),
    };
  });
  // Yang menunggu tindakan Anda dulu, lalu yang belum final, lalu point tertinggi.
  return out.sort((a, b) => Number(!!b.act) - Number(!!a.act) || Number(a.fullyApproved) - Number(b.fullyApproved) || (b.point ?? -1) - (a.point ?? -1) || a.name.localeCompare(b.name));
}

export type DetailMonth = {
  period: string;
  total: number | null;
  /** Hospital only — points per pillar (band score × weight) + raw values. */
  h: null | {
    salesTarget: number; salesActual: number; salesPct: number | null; salesScore: number | null;
    callStandar: number; callReal: number | null; callPct: number | null; callScore: number | null; callSource: string | null; callInputAt: string | null; callInputBy: string | null;
    customer: number; customerScore: number;
    absensi: number | null; absensiScore: number | null; absensiSource: string | null;
  };
  /** Non-Hospital only. */
  n: null | { target: number | null; sales: number | null; ach: number | null; visit: number | null; hariAktif: number | null; achKunjungan: number | null; sc: number | null; telat: number | null; notes: string[] };
};

export type PersonDetail = {
  scheme: KpiScheme;
  nip: string;
  name: string;
  role: string;
  jabatan: string | null;
  area: string | null;
  tglMasuk: string | null;
  akhirKontrak: string | null;
  atasanName: string | null;
  window: { start: string; end: string };
  months: DetailMonth[];
  /** Rata-rata window; per-pillar = points (Hospital). Non-Hospital pillars stay null — band belum dikonfirmasi. */
  avg: { total: number | null; sales: number | null; activity: number | null; customer: number | null; absensi: number | null; complete: number };
  rec: { months: number; label: string } | null;
  decision: Decision | null;
  /** Approval chain with the people currently holding each step (walked up `User.nipAtasan`). */
  chain: { step: ApprovalStep; name: string | null; approvedBy: string | null }[];
  status: string;
  fullyApproved: boolean;
  act: Action;
  /** Role that fills the evaluation for this personil (SM; NSM if SM is vacant; null if nobody can). */
  evaluator: "SM" | "NSM" | null;
  evaluatorName: string;
};

/** Names of the ASM/SM/NSM above a personil, nearest first (≤3 hops). */
async function superiorsByRole(nip: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let cur = nip;
  for (let i = 0; i < 4; i++) {
    const u = (await prisma.user.findUnique({ where: { nip: cur }, select: { nipAtasan: true } })) as { nipAtasan: string | null } | null;
    if (!u?.nipAtasan) break;
    const up = (await prisma.user.findUnique({ where: { nip: u.nipAtasan }, select: { nip: true, name: true, role: true } })) as { nip: string; name: string; role: string } | null;
    if (!up) break;
    if (!out[up.role]) out[up.role] = up.name;
    cur = up.nip;
  }
  return out;
}

function hospitalMonth(period: string, r: KpiPersonnelRow | undefined): DetailMonth {
  if (!r) return { period, total: null, h: null, n: null };
  return {
    period, total: r.totalScore, n: null,
    h: {
      salesTarget: r.salesTargetRp, salesActual: r.salesActualRp, salesPct: r.salesAchievementPct, salesScore: r.salesScore,
      callStandar: r.callActivityStandar, callReal: r.callActivityRealisasi, callPct: r.activityAchievementPct, callScore: r.activityScore, callSource: r.callActivitySource, callInputAt: r.callActivityInputAt, callInputBy: r.callActivityInputByNip,
      customer: r.customerAktifCount, customerScore: r.customerScore,
      absensi: r.absensiValue, absensiScore: r.absensiScore, absensiSource: r.absensiSource,
    },
  };
}

function nhMonth(period: string, r: NhMonitoringRow | undefined): DetailMonth {
  if (!r) return { period, total: null, h: null, n: null };
  const m = r.month;
  return { period, total: r.totalScore, h: null, n: { target: m.target, sales: m.sales, ach: m.ach, visit: m.visit, hariAktif: m.hariAktif, achKunjungan: m.achKunjungan, sc: m.sc, telat: m.telat, notes: r.notes } };
}

export async function getKpiPersonDetail(scheme: KpiScheme, nip: string): Promise<PersonDetail | null> {
  const session = await requireEvaluator();
  const scope = await allowedNips(session);
  if (scope && !scope.includes(nip)) return null; // bukan bawahan langsung

  const end = await lastCompletedPeriod();
  const periods = Array.from({ length: NH_WINDOW_MONTHS }, (_, i) => addMonths(end, i - (NH_WINDOW_MONTHS - 1)));

  // Satu query-set per bulan untuk SATU personil — kecil, tidak company-wide.
  let months: DetailMonth[];
  let base: { name: string; role: string; jabatan: string | null; area: string | null; akhirKontrak: string | null };
  if (scheme === "hospital") {
    const per = await Promise.all(periods.map((p) => computeKpiRows(p, [nip], { hospitalOnly: true })));
    const any = per.flat()[0];
    if (!any) return null;
    months = per.map((rows, i) => hospitalMonth(periods[i], rows[0]));
    base = { name: any.name, role: any.role, jabatan: any.jabatan, area: any.area, akhirKontrak: null };
  } else {
    const per = await Promise.all(periods.map((p) => getNonHospitalMonitoringRows(p, { nips: [nip] })));
    const any = per.flat()[0];
    if (!any) return null;
    months = per.map((rows, i) => nhMonth(periods[i], rows[0]));
    base = { name: any.name, role: any.role, jabatan: any.jabatan, area: any.gt, akhirKontrak: any.akhirKontrak };
  }

  const hm = months.map((m) => m.h);
  const avgPts = (f: (h: NonNullable<DetailMonth["h"]>) => number | null, w: number) => {
    const a = avg(hm.map((h) => (h ? f(h) : null)));
    return a == null ? null : a * w;
  };
  const avgTotal = round2(avg(months.map((m) => m.total)));
  const [user, sipp, decisions, supers] = await Promise.all([
    prisma.user.findUnique({ where: { nip }, select: { namaAtasan: true } }),
    prisma.sippEmployee.findFirst({
      where: { OR: [{ nip }, { namaNormalized: normalizeName(base.name) }], tglMasuk: { not: null } },
      select: { tglMasuk: true },
    }),
    decisionsFor([nip], end),
    superiorsByRole(nip),
  ]);
  const decision = decisions.get(nip) ?? null;
  const steps = decision ? decision.steps : null;
  const present = new Set(Object.keys(supers)); // only levels somebody actually holds

  return {
    scheme, nip, ...base,
    tglMasuk: sipp?.tglMasuk?.toISOString().slice(0, 10) ?? null,
    atasanName: user?.namaAtasan ?? null,
    window: { start: periods[0], end },
    months,
    avg: {
      total: avgTotal,
      sales: round2(avgPts((h) => h.salesScore, KPI_WEIGHTS.sales)),
      activity: round2(avgPts((h) => h.callScore, KPI_WEIGHTS.activity)),
      customer: round2(avgPts((h) => h.customerScore, KPI_WEIGHTS.customer)),
      absensi: round2(avgPts((h) => h.absensiScore, KPI_WEIGHTS.absensi)),
      complete: months.filter((m) => m.total != null).length,
    },
    rec: avgTotal != null ? recommendContractMonths(avgTotal) : null,
    decision,
    chain: chainFor(base.role, present).map((step) => ({ step, name: supers[step] ?? null, approvedBy: decision?.steps[step]?.byName ?? null })),
    status: statusText(base.role, steps, present),
    fullyApproved: isFullyApproved(chainFor(base.role, present), steps),
    act: actionFor(session.role, base.role, steps, present),
    evaluator: evaluatorFor(base.role, present),
    evaluatorName: session.name,
  };
}

export type SaveEvaluationResult = { ok: true } | { ok: false; error: string };

/**
 * Simpan evaluasi (04-final-layout.md §5, §9) — satu evaluasi per personil per window, hanya oleh
 * pengisi evaluasi (SM untuk MR/SPV/ASM, NSM untuk SM; ADMIN override). Itu sekaligus approval
 * pertama bila pengisinya ada di rantai; atasan lain menyusul lewat approveKpiStepAction.
 */
export async function saveKpiEvaluationAction(input: {
  scheme: KpiScheme; nip: string; months: number; reason: string; dev: string; direction: string;
}): Promise<SaveEvaluationResult> {
  const session = await requireEvaluator();
  await assertWritable(session.role);
  if (!(DECISION_MONTHS as readonly number[]).includes(input.months)) return { ok: false, error: "Pilih keputusan perpanjangan." };

  // Hitung ulang di server — rekomendasi dan hak akses dari klien tidak dipercaya.
  const d = await getKpiPersonDetail(input.scheme, input.nip);
  if (!d) return { ok: false, error: "Personil di luar lingkup Anda." };
  if (d.decision) return { ok: false, error: "Personil ini sudah dievaluasi." };
  if (d.act?.kind !== "evaluasi") return { ok: false, error: "Anda bukan pengisi evaluasi untuk personil ini." };

  const reason = input.reason.trim(), dev = input.dev.trim(), direction = input.direction.trim();
  if (input.months !== d.rec?.months && !reason) return { ok: false, error: "Keputusan berbeda dari rekomendasi: isi penjelasan keputusan." };
  if (!dev) return { ok: false, error: "Rencana pengembangan personil wajib diisi." };

  try {
    await prisma.kpiContractEvaluation.create({
      data: {
        nip: input.nip, scheme: input.scheme === "hospital" ? "HOSPITAL" : "NON_HOSPITAL",
        periodeMulai: d.window.start, periodeAkhir: d.window.end,
        avgSalesScore: d.avg.sales, avgActivityScore: d.avg.activity, avgCustomerScore: d.avg.customer, avgAbsensiScore: d.avg.absensi,
        totalScore: d.avg.total, systemRecommendationMonths: d.rec?.months ?? null,
        decisionMonths: input.months, decisionReason: reason || null, developmentPlanNotes: dev, directionRationale: direction || null,
        evaluatedByNip: session.userId,
        ...(d.act.step ? { approvals: { create: { step: d.act.step, approvedByNip: session.userId } } } : {}),
      },
    });
  } catch (e) {
    // P2002 = unique(nip, periodeAkhir): dua atasan menyimpan bersamaan.
    if ((e as { code?: string }).code === "P2002") return { ok: false, error: "Personil ini sudah dievaluasi." };
    throw e;
  }
  revalidatePath("/kpi-detail");
  return { ok: true };
}

/** Setujui sebagai {ASM|SM|NSM} — langkah milik role Anda (ADMIN: langkah pending pertama). Sekali per langkah. */
export async function approveKpiStepAction(input: { scheme: KpiScheme; nip: string }): Promise<SaveEvaluationResult> {
  const session = await requireEvaluator();
  await assertWritable(session.role);
  const d = await getKpiPersonDetail(input.scheme, input.nip);
  if (!d || !d.decision) return { ok: false, error: "Personil belum dievaluasi atau di luar lingkup Anda." };
  if (d.act?.kind !== "approve" || !d.act.step) return { ok: false, error: "Tidak ada approval yang menunggu Anda untuk personil ini." };

  const ev = (await prisma.kpiContractEvaluation.findUnique({ where: { nip_periodeAkhir: { nip: input.nip, periodeAkhir: d.window.end } }, select: { id: true } })) as { id: string } | null;
  if (!ev) return { ok: false, error: "Evaluasi tidak ditemukan." };
  try {
    await prisma.kpiEvaluationApproval.create({ data: { evaluationId: ev.id, step: d.act.step, approvedByNip: session.userId } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { ok: false, error: "Langkah ini sudah disetujui." };
    throw e;
  }
  revalidatePath("/kpi-detail");
  return { ok: true };
}

// ─── Rincian per pilar (Hospital): outlet, kontrak PSSP, absensi harian ───────────

export type AbsensiDay = { iso: string; hari: string; min: number; telat: boolean; jam: number };

export type Breakdown = {
  periods: string[];
  /** "outlet" (MR/SPV: one row per outlet) or "mr" (ASM/SM: one row per MR/SPV under them). */
  salesKind: "outlet" | "mr";
  salesUnits: { label: string; sub: string; v: (number | null)[] }[];
  /** MR/SPV only: one row per PSSP contract, active flag per month. */
  pssp: { kdCust: string; nmCust: string; nmSpc: string | null; kdOutlet: string | null; nmOutlet: string | null; prdAwal: string; prdAkhir: string; active: boolean[]; status: string }[] | null;
  /** ASM/SM only: customer-aktif count per MR/SPV per month. */
  custUnits: { label: string; sub: string; v: number[] }[] | null;
  /** One entry per period; null = SIPP unavailable / no PTID. */
  absensi: ({ period: string; days: AbsensiDay[] } | null)[];
};

const SIPP_TIMEOUT_MS = 8000;
const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const yyyymm = (p: string) => p.replace("-", "");

/** Same window + access rule as getKpiPersonDetail. Hospital only (Non-Hospital has no outlet/PSSP/absensi-harian data source). */
export async function getHospitalBreakdown(nip: string): Promise<Breakdown | null> {
  const session = await requireEvaluator();
  const scope = await allowedNips(session);
  if (scope && !scope.includes(nip)) return null;

  const user = (await prisma.user.findUnique({ where: { nip }, select: { nip: true, role: true, sippAbsPtId: true } })) as { nip: string; role: string; sippAbsPtId: number | null } | null;
  if (!user) return null;
  const end = await lastCompletedPeriod();
  const periods = Array.from({ length: NH_WINDOW_MONTHS }, (_, i) => addMonths(end, i - (NH_WINDOW_MONTHS - 1)));
  const periodInts = periods.map((p) => parseInt(yyyymm(p), 10));
  const isMr = user.role === "MR";
  const mrs = isMr ? [nip] : await getSubordinateMRNips({ nip, role: user.role as Role } as User);

  const [assignments, mrUsers, perMonthRows] = await Promise.all([
    mrs.length
      ? (prisma.mrOutletAssignment.findMany({ where: { nipMR: { in: mrs }, periode: { in: periodInts } }, select: { nipMR: true, kodePI: true, periode: true } }) as Promise<{ nipMR: string; kodePI: string; periode: number }[]>)
      : Promise.resolve([] as { nipMR: string; kodePI: string; periode: number }[]),
    isMr || mrs.length === 0 ? Promise.resolve([] as { nip: string; name: string }[]) : (prisma.user.findMany({ where: { nip: { in: mrs } }, select: { nip: true, name: true } }) as Promise<{ nip: string; name: string }[]>),
    isMr || mrs.length === 0 ? Promise.resolve([] as KpiPersonnelRow[][]) : Promise.all(periods.map((p) => computeKpiRows(p, mrs, { hospitalOnly: true }))),
  ]);
  const outletCodes = [...new Set(assignments.map((a) => a.kodePI))];
  const [salesRows, outlets] = await Promise.all([
    outletCodes.length
      ? (prisma.outletSalesValueMonthly.findMany({ where: { kodePI: { in: outletCodes }, periode: { in: periods.map(yyyymm) } }, select: { kodePI: true, periode: true, valueSales: true } }) as Promise<{ kodePI: string; periode: string; valueSales: { toString(): string } }[]>)
      : Promise.resolve([] as { kodePI: string; periode: string; valueSales: { toString(): string } }[]),
    outletCodes.length ? (prisma.outlet.findMany({ where: { kodePI: { in: outletCodes } }, select: { kodePI: true, namaOutlet: true } }) as Promise<{ kodePI: string; namaOutlet: string }[]>) : Promise.resolve([] as { kodePI: string; namaOutlet: string }[]),
  ]);
  const sales = new Map(salesRows.map((r) => [`${r.kodePI}|${r.periode}`, parseFloat(r.valueSales.toString()) || 0]));
  const outletName = new Map(outlets.map((o) => [o.kodePI, o.namaOutlet]));
  const assignedIn = (mr: string, kode: string, i: number) => assignments.some((a) => a.nipMR === mr && a.kodePI === kode && a.periode === periodInts[i]);

  // Sales: MR → per outlet; ASM/SM → per MR/SPV in the team. null = not assigned that month.
  const salesUnits: Breakdown["salesUnits"] = isMr
    ? outletCodes.map((k) => ({ label: outletName.get(k) ?? k, sub: k, v: periods.map((p, i) => (assignedIn(nip, k, i) ? sales.get(`${k}|${yyyymm(p)}`) ?? 0 : null)) }))
    : mrUsers
        .map((u) => ({
          label: u.name, sub: u.nip,
          v: periods.map((p, i) => {
            const mine = assignments.filter((a) => a.nipMR === u.nip && a.periode === periodInts[i]);
            return mine.length ? mine.reduce((s, a) => s + (sales.get(`${a.kodePI}|${yyyymm(p)}`) ?? 0), 0) : null;
          }),
        }))
        .filter((u) => u.v.some((x) => x != null));

  let pssp: Breakdown["pssp"] = null;
  if (isMr && outletCodes.length) {
    const rows = (await prisma.psspKontrak.findMany({
      where: { kdOutlet: { in: outletCodes }, prdAkhir: { gte: yyyymm(periods[0]) }, prdAwal: { lte: yyyymm(end) } },
      select: { kdCust: true, nmCust: true, cUrut: true, nmSpc: true, kdOutlet: true, nmOutlet: true, prdAwal: true, prdAkhir: true },
      orderBy: [{ prdAkhir: "desc" }, { cUrut: "asc" }],
    })) as { kdCust: string; nmCust: string; cUrut: string; nmSpc: string | null; kdOutlet: string | null; nmOutlet: string | null; prdAwal: string; prdAkhir: string }[];
    const seen = new Set<string>();
    const endYm = periodInts[periodInts.length - 1];
    pssp = [];
    for (const r of rows) {
      const key = `${r.kdCust}|${r.cUrut}`; // PsspKontrak has one row per product line — one row per contract here
      if (seen.has(key)) continue;
      seen.add(key);
      const akhir = parseInt(r.prdAkhir, 10);
      const left = (Math.floor(akhir / 100) - Math.floor(endYm / 100)) * 12 + (akhir % 100) - (endYm % 100);
      pssp.push({
        kdCust: r.kdCust, nmCust: r.nmCust, nmSpc: r.nmSpc, kdOutlet: r.kdOutlet, nmOutlet: r.nmOutlet, prdAwal: r.prdAwal, prdAkhir: r.prdAkhir,
        active: periods.map((p) => r.prdAwal <= yyyymm(p) && yyyymm(p) <= r.prdAkhir),
        status: left < 0 ? "Berakhir" : left === 0 ? "Berakhir bulan ini" : `Aktif · sisa ${left} bln`,
      });
    }
  }

  const custUnits: Breakdown["custUnits"] = isMr
    ? null
    : mrUsers.map((u) => ({ label: u.name, sub: u.nip, v: perMonthRows.map((rows) => rows.find((r) => r.nip === u.nip)?.customerAktifCount ?? 0) }));

  // Absensi harian: same NIP + alias lookup as kpiAbsensiSync, one SIPP call per month (≤6, parallel).
  const identity = (await loadIdentities([nip])).get(nip);
  const ownPtId = user.sippAbsPtId ?? identity?.nips.find((a) => a.nip === nip)?.ptid ?? null;
  const absensi = await Promise.all(
    periods.map(async (period) => {
      if (ownPtId == null) return null;
      const { startDate, endDate } = monthDateRange(period);
      const first = new Date(`${startDate}T00:00:00Z`), last = new Date(`${endDate}T23:59:59Z`);
      const lookups: [string, number][] = [
        [nip, ownPtId],
        ...(identity?.nips ?? []).filter((a) => a.nip !== nip && (!a.tglMasuk || a.tglMasuk <= last) && (!a.tglKeluar || a.tglKeluar >= first)).map((a): [string, number] => [a.nip, a.ptid]),
      ];
      const days: AbsensiDay[] = [];
      for (const [n, ptid] of lookups) {
        // getAbsensiByNip has no fetch timeout; an unreachable SIPP must not hang the whole card.
        const recs = await Promise.race([getAbsensiByNip(n, ptid, startDate, endDate), new Promise<null>((r) => setTimeout(() => r(null), SIPP_TIMEOUT_MS))]);
        if (recs == null) return null;
        for (const r of recs) {
          const d = new Date(r.absDateIn);
          if (Number.isNaN(d.getTime())) continue;
          const hour = d.getHours() + d.getMinutes() / 60; // same clock reading as computeAvgLateHours
          const telat = r.absTelatYN === "Y";
          days.push({
            iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
            hari: HARI[d.getDay()], min: d.getHours() * 60 + d.getMinutes(), telat, jam: telat ? Math.max(0, hour - 8) : 0,
          });
        }
      }
      return { period, days: days.sort((a, b) => a.iso.localeCompare(b.iso)) };
    }),
  );

  return { periods, salesKind: isMr ? "outlet" : "mr", salesUnits, pssp, custUnits, absensi };
}

// ─── Summary (NSM / SD / ADMIN) — hanya personil yang sudah disetujui lengkap ──────

export type SummaryPerson = {
  nip: string; name: string; role: string; jabatan: string | null; area: string | null; nsmName: string | null;
  pillars: { sales: number | null; activity: number | null; customer: number | null; absensi: number | null };
  total: number | null; systemMonths: number | null; decisionMonths: number;
  /** NSM approval time (ISO) and the new contract window implied by the decision. */
  approvedAt: string | null; newContract: { start: string; end: string } | null;
  /** Rank inside the same jabatan group at the last completed month's leaderboard. */
  rank: number | null; rankOf: number;
};
export type SummaryGroup = { key: "MR/SPV" | "ASM" | "SM"; people: SummaryPerson[]; avg: { sales: number; activity: number; customer: number; absensi: number; total: number } };
export type KpiSummary = {
  window: { start: string; end: string };
  total: number; evaluated: number; waiting: number;
  all: { n: number; avg: SummaryGroup["avg"] };
  groups: SummaryGroup[];
  extended: SummaryPerson[]; notExtended: number;
};

const catOf = (role: string): SummaryGroup["key"] => (role === "ASM" ? "ASM" : role === "SM" ? "SM" : "MR/SPV");

/**
 * Summary Sales Director (04-final-layout.md §9): Hospital, only personil whose evaluation passed every
 * step of the chain (so NSM has approved). Points come from the snapshot stored with the evaluation, the
 * jabatan rank from the last completed month's leaderboard.
 */
export async function getKpiSummary(): Promise<KpiSummary> {
  const session = await getCurrentUser();
  if (!session || !["ADMIN", "SD", "NSM"].filter(canUseKpiPersonil).includes(session.role)) throw new Error("Summary hanya untuk NSM, Sales Director, dan PIC (saat ini khusus admin).");

  const end = await lastCompletedPeriod();
  const [evals, ranked] = await Promise.all([
    prisma.kpiContractEvaluation.findMany({
      where: { scheme: "HOSPITAL", periodeAkhir: end },
      include: { user: { select: { name: true, role: true, jabatan: true } }, approvals: { include: { approvedBy: { select: { name: true } } } } },
    }) as unknown as Promise<{
      nip: string; periodeMulai: string; decisionMonths: number; systemRecommendationMonths: number | null; totalScore: { toString(): string } | null;
      avgSalesScore: { toString(): string } | null; avgActivityScore: { toString(): string } | null; avgCustomerScore: { toString(): string } | null; avgAbsensiScore: { toString(): string } | null;
      user: { name: string; role: string; jabatan: string | null }; approvals: { step: string; approvedAt: Date; approvedBy: { name: string } | null }[];
    }[]>,
    computeKpiRows(end, null, { hospitalOnly: true }),
  ]);

  const byNip = new Map(ranked.map((r) => [r.nip, r]));
  const rankIn = new Map<string, { rank: Map<string, number>; n: number }>();
  for (const k of ["MR/SPV", "ASM", "SM"] as const) {
    const list = ranked.filter((r) => r.totalScore != null && catOf(r.role) === k).sort((a, b) => b.totalScore! - a.totalScore! || a.name.localeCompare(b.name));
    rankIn.set(k, { rank: new Map(list.map((r, i) => [r.nip, i + 1])), n: list.length });
  }

  const n2 = (v: { toString(): string } | null) => (v == null ? null : parseFloat(v.toString()));
  const above = await rolesAbove(evals.map((e) => e.nip));
  const pool = evals.filter((e) => isFullyApproved(chainFor(e.user.role, above.get(e.nip)), Object.fromEntries(e.approvals.map((a) => [a.step, 1]))));
  const people: SummaryPerson[] = pool.map((e) => {
    const nsm = e.approvals.find((a) => a.step === "NSM");
    const startMonth = addMonths(end, 1);
    const [y, m] = startMonth.split("-").map(Number);
    const endDate = new Date(Date.UTC(y, m - 1 + e.decisionMonths, 0));
    const cat = rankIn.get(catOf(e.user.role))!;
    return {
      nip: e.nip, name: e.user.name, role: e.user.role, jabatan: e.user.jabatan, area: byNip.get(e.nip)?.area ?? null, nsmName: nsm?.approvedBy?.name ?? null,
      pillars: { sales: n2(e.avgSalesScore), activity: n2(e.avgActivityScore), customer: n2(e.avgCustomerScore), absensi: n2(e.avgAbsensiScore) },
      total: n2(e.totalScore), systemMonths: e.systemRecommendationMonths, decisionMonths: e.decisionMonths,
      approvedAt: nsm?.approvedAt.toISOString() ?? null,
      newContract: e.decisionMonths > 0 ? { start: `${startMonth}-01`, end: endDate.toISOString().slice(0, 10) } : null,
      rank: cat.rank.get(e.nip) ?? null, rankOf: cat.n,
    };
  });

  const mean = (list: SummaryPerson[], f: (p: SummaryPerson) => number | null) => {
    const v = list.map(f).filter((x): x is number => x != null);
    return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 100) / 100 : 0;
  };
  const avgOf = (list: SummaryPerson[]) => ({
    sales: mean(list, (p) => p.pillars.sales), activity: mean(list, (p) => p.pillars.activity), customer: mean(list, (p) => p.pillars.customer),
    absensi: mean(list, (p) => p.pillars.absensi), total: mean(list, (p) => p.total),
  });
  const groups: SummaryGroup[] = (["MR/SPV", "ASM", "SM"] as const).map((key) => {
    const list = people.filter((p) => catOf(p.role) === key).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (b.total ?? 0) - (a.total ?? 0));
    return { key, people: list, avg: avgOf(list) };
  }).filter((g) => g.people.length > 0);

  return {
    window: { start: evals[0]?.periodeMulai ?? addMonths(end, -(NH_WINDOW_MONTHS - 1)), end },
    total: ranked.length, evaluated: evals.length, waiting: evals.length - pool.length,
    all: { n: people.length, avg: avgOf(people) },
    groups,
    extended: people.filter((p) => p.decisionMonths > 0).sort((a, b) => (b.total ?? 0) - (a.total ?? 0)),
    notExtended: people.filter((p) => p.decisionMonths === 0).length,
  };
}
