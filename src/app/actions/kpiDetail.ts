"use server";

/**
 * Detail KPI (docs/kpi-monitoring/04-final-layout.md §3-5): bawahan langsung
 * penilai → kartu detail per personil → form evaluasi. Access = ADMIN (semua)
 * atau SM/NSM untuk bawahan langsung (`User.nipAtasan`, berlaku sama untuk
 * Hospital dan Non-Hospital). Window evaluasi = 6 bulan selesai terakhir
 * (belum ada data kontrak Hospital — §7 Q3, keputusan 2026-10-05).
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { assertWritable } from "@/lib/maintenance";
import { KPI_PERSONNEL_FILTER, loadIdentities, normalizeName } from "@/lib/kpiIdentity";
import { computeKpiRows, type KpiPersonnelRow } from "@/lib/kpiMonitoring";
import { getNonHospitalMonitoringRows, type NhMonitoringRow } from "@/lib/nonHospitalEvaluation";
import { addMonths, periodOf, NH_WINDOW_MONTHS } from "@/lib/nonHospitalScoring";
import { KPI_WEIGHTS, recommendContractMonths } from "@/lib/kpiScoring";
import { getSubordinateMRNips } from "@/lib/authz";
import { getAbsensiByNip, monthDateRange } from "@/lib/sippApi";
import type { Role, User } from "@prisma/client";

export type KpiScheme = "hospital" | "non-hospital";
const EVALUATOR_ROLES = ["ADMIN", "SM", "NSM"];
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DECISION_MONTHS = [12, 9, 6, 0] as const;

/** Last completed month = default period everywhere in KPI (sales/visit data land after month end). */
export async function lastCompletedPeriod(): Promise<string> {
  return addMonths(periodOf(new Date()), -1);
}

async function requireEvaluator() {
  const session = await getCurrentUser();
  if (!session || !EVALUATOR_ROLES.includes(session.role)) throw new Error("Detail KPI hanya untuk atasan.");
  return session;
}

/** NIPs the viewer may open: ADMIN → null (every personnel of the scheme); others → direct reports. */
async function allowedNips(session: { nip: string; role: string }): Promise<string[] | null> {
  if (session.role === "ADMIN") return null;
  const rows = (await prisma.user.findMany({
    where: { nipAtasan: session.nip, role: { in: ["MR", "ASM", "SM"] }, ...KPI_PERSONNEL_FILTER },
    select: { nip: true },
  })) as { nip: string }[];
  return rows.map((r) => r.nip);
}

const avg = (v: (number | null)[]) => {
  const x = v.filter((n): n is number => n != null);
  return x.length ? x.reduce((s, n) => s + n, 0) / x.length : null;
};
const round2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

export type Decision = {
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
  decision: Decision | null;
};

async function decisionsFor(nips: string[], periodeAkhir: string): Promise<Map<string, Decision>> {
  if (nips.length === 0) return new Map();
  const rows = (await prisma.kpiContractEvaluation.findMany({
    where: { nip: { in: nips }, periodeAkhir },
    include: { evaluatedBy: { select: { name: true } } },
  })) as unknown as {
    nip: string; decisionMonths: number; decisionReason: string | null; developmentPlanNotes: string; directionRationale: string | null;
    evaluatedAt: Date; systemRecommendationMonths: number | null; evaluatedBy: { name: string } | null;
  }[];
  return new Map(rows.map((r) => [r.nip, {
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

  let rows: Omit<SubordinateRow, "decision">[];
  if (scheme === "hospital") {
    const data = await computeKpiRows(period, scope, { hospitalOnly: true });
    rows = data.map((r) => ({
      nip: r.nip, name: r.name, role: r.role, jabatan: r.jabatan, area: null, point: r.totalScore, rec: r.recommendation,
      akhirKontrak: null, complete: r.totalScore != null,
      notes: [r.activityScore == null && "Call Activity belum terisi", r.absensiScore == null && "Absensi belum terisi", !r.salesTargetRp && "Target sales kosong"].filter((x): x is string => !!x),
    }));
  } else {
    const data = await getNonHospitalMonitoringRows(period, { scopeNips: scope });
    rows = data.map((r) => ({
      nip: r.nip, name: r.name, role: r.role, jabatan: r.jabatan, area: r.gt, point: r.totalScore, rec: r.recommendation,
      akhirKontrak: r.akhirKontrak, complete: r.notes.length === 0 && r.totalScore != null, notes: r.notes,
    }));
  }
  const decisions = await decisionsFor(rows.map((r) => r.nip), await lastCompletedPeriod());
  const out = rows.map((r) => ({ ...r, decision: decisions.get(r.nip) ?? null }));
  // Belum dievaluasi dulu, lalu point tertinggi — sama dengan mockup.
  return out.sort((a, b) => Number(!!a.decision) - Number(!!b.decision) || (b.point ?? -1) - (a.point ?? -1) || a.name.localeCompare(b.name));
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
};

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
    base = { name: any.name, role: any.role, jabatan: any.jabatan, area: null, akhirKontrak: null };
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
  const [user, sipp, decisions] = await Promise.all([
    prisma.user.findUnique({ where: { nip }, select: { namaAtasan: true } }),
    prisma.sippEmployee.findFirst({
      where: { OR: [{ nip }, { namaNormalized: normalizeName(base.name) }], tglMasuk: { not: null } },
      select: { tglMasuk: true },
    }),
    decisionsFor([nip], end),
  ]);

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
    decision: decisions.get(nip) ?? null,
  };
}

export type SaveEvaluationResult = { ok: true } | { ok: false; error: string };

/** Setujui perpanjangan — satu keputusan per personil per window, terkunci setelah disimpan (§5, §7 Q4 default). */
export async function saveKpiEvaluationAction(input: {
  scheme: KpiScheme; nip: string; months: number; reason: string; dev: string; direction: string;
}): Promise<SaveEvaluationResult> {
  const session = await requireEvaluator();
  await assertWritable(session.role);
  if (!(DECISION_MONTHS as readonly number[]).includes(input.months)) return { ok: false, error: "Pilih keputusan perpanjangan." };

  // Hitung ulang di server — rekomendasi dari klien tidak dipercaya.
  const d = await getKpiPersonDetail(input.scheme, input.nip);
  if (!d) return { ok: false, error: "Personil bukan bawahan langsung Anda." };
  if (d.decision) return { ok: false, error: "Personil ini sudah dievaluasi." };

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
