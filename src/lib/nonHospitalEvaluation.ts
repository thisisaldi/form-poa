/**
 * Evaluasi Kontrak Non-Hospital — data assembly (no auth here; callers gate).
 * Spec: docs/evaluasi-kontrak-non-hospital/. One batched pass per source for
 * ALL contracts of the chosen end-month (docs/PERFORMANCE.md §2 point 4): the
 * query count does not grow with the number of personil.
 *
 * Sources per month of a person's window:
 *  - Target:  TargetNonHospitalValue for the person's LIVE GT (User.namaWilayah,
 *             same resolution as getCurrentGTsForOmegaMrNips), both divisi summed.
 *  - Sales:   OutletSalesValueMonthlyOmega (DIR10001B DIVISI = 'OMG1' = Non-Hospital;
 *             the Hospital table OutletSalesValueMonthly only carries KAM1), summed over
 *             the outlets of that GT. Checked 2026-09-25 on GT "DEPOK 02", Aug 2026:
 *             actual Rp133M vs target Rp142M. Synced by scripts/syncOmegaSalesValueMonthly.ts.
 *  - Visits:  MSSQL exodus_sfe.dbo.visit_realizations across ALL of the person's
 *             NIPs (kpiIdentity.ts), WIB; active days = days with >= 1 visit.
 *  - SC Menang / Absensi (hari telat): NonHospitalMonthlyEntry (no automatic source yet).
 */

import sql from "mssql";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { allNips, dedupeByIdentity, loadIdentities } from "@/lib/kpiIdentity";
import {
  addMonths, buildIndicators, realNip, recommendationFor, totalScore, visitAchievement, windowMonths,
  NH_VISIT_TARGET_PER_DAY, type NhIndicator,
} from "@/lib/nonHospitalScoring";

export interface NhMonthRow {
  period: string; // YYYY-MM
  target: number | null;
  sales: number | null;
  ach: number | null;
  visit: number | null;
  hariAktif: number | null;
  achKunjungan: number | null;
  sc: number | null;
  telat: number | null;
}

export interface NhDecision {
  status: string;
  decisionMonths: number;
  decisionReason: string | null;
  developmentPlanNotes: string;
  decidedByName: string | null;
  decidedAt: string;
}

export interface NhEvalRow {
  contractId: string;
  nip: string;
  name: string;
  gt: string | null;
  jabatan: string | null;
  cabang: string | null;
  periodeBulan: number | null;
  awalKontrak: string; // ISO date
  akhirKontrak: string;
  window: string[];
  months: NhMonthRow[];
  visitTargetPerDay: number;
  indicators: NhIndicator[];
  totalScore: number | null;
  recommendation: { months: number; label: string } | null;
  notes: string[];
  decision: NhDecision | null;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export function shortMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
const yyyymm = (p: string) => p.replace("-", "");

/** Visit rows for the given NIPs over [fromPeriod, toPeriod], grouped per NIP / month / WIB day. */
async function queryVisitDays(nips: string[], fromPeriod: string, toPeriod: string) {
  const safe = [...new Set(nips)].filter((n) => /^[A-Za-z0-9]+$/.test(n));
  if (safe.length === 0 || !env.MSSQL_CONNECTION_STRING) return [] as { nip: string; d: Date; n: number }[];
  const startUtc = new Date(Date.UTC(+fromPeriod.slice(0, 4), +fromPeriod.slice(5, 7) - 1, 1) - 7 * 3600_000);
  const endUtc = new Date(Date.UTC(+addMonths(toPeriod, 1).slice(0, 4), +addMonths(toPeriod, 1).slice(5, 7) - 1, 1) - 7 * 3600_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
  const pool = new sql.ConnectionPool(env.MSSQL_CONNECTION_STRING);
  await pool.connect();
  try {
    const { recordset } = await pool
      .request()
      .input("start", sql.VarChar, fmt(startUtc))
      .input("end", sql.VarChar, fmt(endUtc))
      .query<{ nip: string; d: Date; n: number }>(`
        SELECT user_nip AS nip, CAST(DATEADD(hour, 7, visit_start_date) AS date) AS d, COUNT(*) AS n
        FROM exodus_sfe.dbo.visit_realizations
        WHERE visit_start_date >= CONVERT(datetime, @start, 120) AND visit_start_date < CONVERT(datetime, @end, 120)
          AND user_nip IN (${safe.map((n) => `'${n}'`).join(",")})
        GROUP BY user_nip, CAST(DATEADD(hour, 7, visit_start_date) AS date)`);
    return recordset;
  } finally {
    await pool.close();
  }
}

/** Contracts ending in `akhirPeriod` ("YYYY-MM") with everything needed to score and display them. */
export async function getNonHospitalEvalRows(akhirPeriod: string, onlyContractId?: string): Promise<NhEvalRow[]> {
  const from = new Date(`${akhirPeriod}-01T00:00:00Z`);
  const to = new Date(`${addMonths(akhirPeriod, 1)}-01T00:00:00Z`);
  const contracts = await prisma.nonHospitalContract.findMany({
    where: onlyContractId ? { id: onlyContractId } : { akhirKontrak: { gte: from, lt: to } },
    include: { user: { select: { name: true, namaWilayah: true } } },
    orderBy: { akhirKontrak: "asc" },
  });
  if (contracts.length === 0) return [];

  const identities = await loadIdentities(contracts.map((c: { nip: string }) => c.nip));
  const nipsOf = (nip: string) => allNips(nip, identities.get(nip));
  const windows = new Map<string, string[]>(
    contracts.map((c: { id: string; awalKontrak: Date; akhirKontrak: Date }) => [c.id, windowMonths(c.awalKontrak, c.akhirKontrak)])
  );
  const allMonths = [...new Set([...windows.values()].flat())].sort();
  const everyNip: string[] = [...new Set(contracts.flatMap((c: { nip: string }) => nipsOf(c.nip)))] as string[];
  const gts: string[] = [...new Set(contracts.map((c: { user: { namaWilayah: string | null } }) => c.user.namaWilayah).filter((g: string | null): g is string => !!g))] as string[];

  const [targetRows, outlets, entries, decisions, visitDays] = await Promise.all([
    gts.length && allMonths.length
      ? prisma.targetNonHospitalValue.findMany({ where: { namaGT: { in: gts }, periode: { in: allMonths.map(yyyymm) } }, select: { namaGT: true, periode: true, target: true } })
      : Promise.resolve([]),
    gts.length ? prisma.outlet.findMany({ where: { namaGT: { in: gts } }, select: { kodePI: true, namaGT: true } }) : Promise.resolve([]),
    allMonths.length
      ? prisma.nonHospitalMonthlyEntry.findMany({ where: { nip: { in: everyNip }, period: { in: allMonths } }, select: { nip: true, period: true, scMenang: true, absensiHariTelat: true } })
      : Promise.resolve([]),
    prisma.kpiNonHospitalEvaluation.findMany({
      where: { contractId: { in: contracts.map((c: { id: string }) => c.id) } },
      orderBy: { decidedAt: "desc" },
      include: { decidedBy: { select: { name: true } } },
    }),
    allMonths.length ? queryVisitDays(everyNip, allMonths[0], allMonths[allMonths.length - 1]) : Promise.resolve([]),
  ]);

  const targetByGtMonth = new Map<string, number>();
  for (const r of targetRows as { namaGT: string; periode: string; target: { toString(): string } }[]) {
    const k = `${r.namaGT}|${r.periode}`;
    targetByGtMonth.set(k, (targetByGtMonth.get(k) ?? 0) + parseFloat(r.target.toString()));
  }
  const outletGt = new Map((outlets as { kodePI: string; namaGT: string | null }[]).map((o) => [o.kodePI, o.namaGT]));
  const salesRows = outletGt.size && allMonths.length
    ? ((await prisma.outletSalesValueMonthlyOmega.findMany({
        where: { kodePI: { in: [...outletGt.keys()] }, periode: { in: allMonths.map(yyyymm) } },
        select: { kodePI: true, periode: true, valueSales: true },
      })) as { kodePI: string; periode: string; valueSales: { toString(): string } }[])
    : [];
  const salesByGtMonth = new Map<string, number>();
  for (const r of salesRows) {
    const gt = outletGt.get(r.kodePI);
    if (!gt) continue;
    const k = `${gt}|${r.periode}`;
    salesByGtMonth.set(k, (salesByGtMonth.get(k) ?? 0) + parseFloat(r.valueSales.toString()));
  }
  const entryByNipMonth = new Map((entries as { nip: string; period: string; scMenang: number | null; absensiHariTelat: number | null }[]).map((e) => [`${e.nip}|${e.period}`, e]));
  const visitsByNip = new Map<string, { d: Date; n: number }[]>();
  for (const v of visitDays) visitsByNip.set(v.nip, [...(visitsByNip.get(v.nip) ?? []), v]);
  const latestDecision = new Map<string, (typeof decisions)[number]>();
  for (const d of decisions as (typeof decisions)) if (!latestDecision.has(d.contractId)) latestDecision.set(d.contractId, d);

  return contracts.map((c: (typeof contracts)[number]) => {
    const gt = c.user.namaWilayah;
    const nips = nipsOf(c.nip);
    const window = windows.get(c.id) ?? [];
    const notes: string[] = [];

    const months: NhMonthRow[] = window.map((period) => {
      const target = gt ? targetByGtMonth.get(`${gt}|${yyyymm(period)}`) ?? null : null;
      const sales = gt ? salesByGtMonth.get(`${gt}|${yyyymm(period)}`) ?? null : null;
      const ach = target != null && target > 0 && sales != null ? sales / target : null;

      const days = new Map<string, number>();
      for (const nip of nips) {
        for (const v of visitsByNip.get(nip) ?? []) {
          const key = v.d.toISOString().slice(0, 10);
          if (key.slice(0, 7) === period) days.set(key, (days.get(key) ?? 0) + v.n);
        }
      }
      const visit = days.size ? [...days.values()].reduce((s, x) => s + x, 0) : null;
      const hariAktif = days.size || null;

      const entry = nips.map((n) => entryByNipMonth.get(`${n}|${period}`)).find(Boolean);
      return {
        period, target, sales, ach, visit, hariAktif,
        achKunjungan: visit != null && hariAktif ? visitAchievement(visit, hariAktif) : null,
        sc: entry?.scMenang ?? null,
        telat: entry?.absensiHariTelat ?? null,
      };
    });

    if (!gt) notes.push("Wilayah/GT personil belum terisi sehingga target dan sales tidak dapat dihitung");
    const noTarget = months.filter((m) => m.target == null || m.target === 0).map((m) => shortMonth(m.period));
    if (gt && noTarget.length) notes.push(`Tidak ada data target: ${noTarget.join(", ")}`);
    const noVisit = months.filter((m) => m.visit == null).map((m) => shortMonth(m.period));
    if (noVisit.length) notes.push(`Kunjungan kosong/tidak valid: ${noVisit.join(", ")}`);
    if (window.length === 0) notes.push("Window evaluasi kosong (kontrak baru dimulai setelah window)");

    const indicators = buildIndicators({
      salesAch: months.map((m) => m.ach),
      kunjunganAch: months.map((m) => m.achKunjungan),
      sc: months.map((m) => m.sc),
      telat: months.map((m) => m.telat),
    });
    const total = totalScore(indicators);
    const d = latestDecision.get(c.id);
    return {
      contractId: c.id, nip: c.nip, name: c.user.name, gt,
      jabatan: c.jabatan, cabang: c.cabang, periodeBulan: c.periodeBulan,
      awalKontrak: c.awalKontrak.toISOString().slice(0, 10), akhirKontrak: c.akhirKontrak.toISOString().slice(0, 10),
      window, months, visitTargetPerDay: NH_VISIT_TARGET_PER_DAY,
      indicators, totalScore: total, recommendation: recommendationFor(total), notes,
      decision: d
        ? {
            status: d.status, decisionMonths: d.decisionMonths, decisionReason: d.decisionReason,
            developmentPlanNotes: d.developmentPlanNotes, decidedByName: d.decidedBy?.name ?? null, decidedAt: d.decidedAt.toISOString(),
          }
        : null,
    };
  });
}

export interface NhMonitoringRow {
  nip: string;
  name: string;
  role: string;
  jabatan: string | null;
  gt: string | null;
  /** Latest known contract end (NonHospitalContract) — optional, most people have none. ISO date. */
  akhirKontrak: string | null;
  month: NhMonthRow;
  indicators: NhIndicator[];
  totalScore: number | null;
  recommendation: { months: number; label: string } | null;
  notes: string[];
}

/**
 * Monthly monitoring for ALL active OMEGA (Non-Hospital) MR/ASM/SM — no
 * contract needed (contract end is optional; shown only when known). Same
 * sources/formulas as getNonHospitalEvalRows but for the single month
 * `period` ("YYYY-MM"). One batched query per source regardless of headcount
 * (docs/PERFORMANCE.md §2 point 4). `scopeNips` = viewer's subtree (null = all);
 * `nips` = optional caller filter, pushed into the personnel query.
 */
export async function getNonHospitalMonitoringRows(
  period: string,
  opts: { scopeNips?: string[] | null; nips?: string[] } = {}
): Promise<NhMonitoringRow[]> {
  let nipFilter = opts.scopeNips ?? null;
  if (opts.nips) nipFilter = nipFilter ? nipFilter.filter((n) => opts.nips!.includes(n)) : opts.nips;

  const all = (await prisma.user.findMany({
    where: {
      project: "OMEGA", role: { in: ["MR", "ASM", "SM"] }, isActive: true, isDummy: false,
      ...(nipFilter ? { nip: { in: nipFilter } } : {}),
    },
    select: { nip: true, name: true, role: true, jabatan: true, namaWilayah: true },
    orderBy: { name: "asc" },
  })) as { nip: string; name: string; role: string; jabatan: string | null; namaWilayah: string | null }[];
  if (all.length === 0) return [];

  const identities = await loadIdentities(all.map((p) => p.nip));
  const people = dedupeByIdentity(all, identities);
  const nipsOf = (nip: string) => allNips(nip, identities.get(nip));
  const everyNip = [...new Set(people.flatMap((p) => nipsOf(p.nip)))];
  // Exodus knows only real NIPs (staging users are TEST-prefixed) — see realNip.
  const visitNips = [...new Set(everyNip.flatMap((n) => [n, realNip(n)]))];
  const gts = [...new Set(people.map((p) => p.namaWilayah).filter((g): g is string => !!g))];
  const pcode = yyyymm(period);

  const [targetRows, outlets, entries, contracts, visitDays] = await Promise.all([
    gts.length ? prisma.targetNonHospitalValue.findMany({ where: { namaGT: { in: gts }, periode: pcode }, select: { namaGT: true, target: true } }) : Promise.resolve([]),
    gts.length ? prisma.outlet.findMany({ where: { namaGT: { in: gts } }, select: { kodePI: true, namaGT: true } }) : Promise.resolve([]),
    prisma.nonHospitalMonthlyEntry.findMany({ where: { nip: { in: everyNip }, period }, select: { nip: true, scMenang: true, absensiHariTelat: true } }),
    prisma.nonHospitalContract.findMany({ where: { nip: { in: everyNip } }, select: { nip: true, akhirKontrak: true }, orderBy: { akhirKontrak: "desc" } }),
    queryVisitDays(visitNips, period, period),
  ]);

  const targetByGt = new Map<string, number>();
  for (const r of targetRows as { namaGT: string; target: { toString(): string } }[]) {
    targetByGt.set(r.namaGT, (targetByGt.get(r.namaGT) ?? 0) + parseFloat(r.target.toString()));
  }
  const outletGt = new Map((outlets as { kodePI: string; namaGT: string | null }[]).map((o) => [o.kodePI, o.namaGT]));
  const salesRows = outletGt.size
    ? ((await prisma.outletSalesValueMonthlyOmega.findMany({
        where: { kodePI: { in: [...outletGt.keys()] }, periode: pcode },
        select: { kodePI: true, valueSales: true },
      })) as { kodePI: string; valueSales: { toString(): string } }[])
    : [];
  const salesByGt = new Map<string, number>();
  for (const r of salesRows) {
    const gt = outletGt.get(r.kodePI);
    if (gt) salesByGt.set(gt, (salesByGt.get(gt) ?? 0) + parseFloat(r.valueSales.toString()));
  }
  const entryByNip = new Map((entries as { nip: string; scMenang: number | null; absensiHariTelat: number | null }[]).map((e) => [e.nip, e]));
  const akhirByNip = new Map<string, Date>();
  for (const c of contracts as { nip: string; akhirKontrak: Date }[]) if (!akhirByNip.has(c.nip)) akhirByNip.set(c.nip, c.akhirKontrak);
  const visitsByNip = new Map<string, { d: Date; n: number }[]>();
  for (const v of visitDays) visitsByNip.set(v.nip, [...(visitsByNip.get(v.nip) ?? []), v]);

  return people.map((p) => {
    const gt = p.namaWilayah;
    const nips = nipsOf(p.nip);
    const target = gt ? targetByGt.get(gt) ?? null : null;
    const sales = gt ? salesByGt.get(gt) ?? null : null;
    const ach = target != null && target > 0 && sales != null ? sales / target : null;

    const days = new Map<string, number>();
    for (const nip of new Set(nips.flatMap((n) => [n, realNip(n)]))) {
      for (const v of visitsByNip.get(nip) ?? []) {
        const key = v.d.toISOString().slice(0, 10);
        if (key.slice(0, 7) === period) days.set(key, (days.get(key) ?? 0) + v.n);
      }
    }
    const visit = days.size ? [...days.values()].reduce((s, x) => s + x, 0) : null;
    const hariAktif = days.size || null;
    const entry = nips.map((n) => entryByNip.get(n)).find(Boolean);
    const month: NhMonthRow = {
      period, target, sales, ach, visit, hariAktif,
      achKunjungan: visit != null && hariAktif ? visitAchievement(visit, hariAktif) : null,
      sc: entry?.scMenang ?? null,
      telat: entry?.absensiHariTelat ?? null,
    };

    const notes: string[] = [];
    if (!gt) notes.push("Wilayah/GT belum terisi, target dan sales tidak dapat dihitung");
    else if (target == null || target === 0) notes.push("Tidak ada data target bulan ini");
    if (visit == null) notes.push("Kunjungan kosong");

    const indicators = buildIndicators({ salesAch: [ach], kunjunganAch: [month.achKunjungan], sc: [month.sc], telat: [month.telat] });
    const total = totalScore(indicators);
    const akhir = nips.map((n) => akhirByNip.get(n)).find(Boolean);
    return {
      nip: p.nip, name: p.name, role: p.role, jabatan: p.jabatan, gt,
      akhirKontrak: akhir ? akhir.toISOString().slice(0, 10) : null,
      month, indicators, totalScore: total, recommendation: recommendationFor(total), notes,
    };
  });
}
