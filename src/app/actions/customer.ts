"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isWriteBlocked, WRITE_BLOCKED_MESSAGE } from "@/lib/maintenance";
import { getVisitCountByCustomerOutlet, lastNMonthsRange, getExodusCustomersByOutletCode, getExodusCustomerDatabaseByNip, getExodusDplContracts, getExodusDiskonHistory } from "@/lib/exodusApi";

export interface NewCustomerResult {
  ok: boolean;
  customerId?: string;
  error?: string;
}

/**
 * Register a new doctor as a Customer linked to an outlet.
 * Anyone with an active session can register a new doctor.
 */
export async function createCustomerAction(formData: FormData): Promise<NewCustomerResult> {
  const session = await getCurrentUser();
  if (!session) return { ok: false, error: "Sesi tidak valid." };
  if (await isWriteBlocked(session.role)) return { ok: false, error: WRITE_BLOCKED_MESSAGE };

  const namaCustomer  = (formData.get("namaCustomer")  as string | null)?.trim() ?? "";
  const spesialisasi  = (formData.get("spesialisasi")  as string | null)?.trim() ?? "";
  const kodePI        = (formData.get("kodePI")        as string | null)?.trim() ?? "";
  const kodeCustomer  = (formData.get("kodeCustomer")  as string | null)?.trim() || null;

  if (!namaCustomer || !spesialisasi || !kodePI) {
    return { ok: false, error: "Nama dokter, spesialisasi, dan outlet wajib diisi." };
  }

  const outlet = await prisma.outlet.findUnique({ where: { kodePI } });
  if (!outlet) return { ok: false, error: "Outlet tidak ditemukan." };

  // Check for exact duplicate (same name + spesialisasi + outlet)
  const existing = await prisma.customerOutlet.findFirst({
    where: { kodePI, customer: { namaCustomer, spesialisasi } },
  });
  if (existing) return { ok: false, error: "Dokter dengan nama dan spesialisasi ini sudah terdaftar di outlet tersebut." };

  // A live Nexus search result can carry a kodeCustomer that already
  // belongs to a Customer row here under slightly different name/
  // spesialisasi text (sync drift, punctuation, etc.) — the check above
  // only catches an exact name+spesialisasi+outlet match, so this can slip
  // past it straight into Customer.kodeCustomer's unique constraint.
  // Resolve it by reusing the existing row (linking this outlet to it if
  // needed) instead of letting that constraint throw an unhandled error
  // that left the caller's customerId stuck on the synthetic "nexus:" id
  // forever (2026-07-29 bug report).
  if (kodeCustomer) {
    const byKode = await prisma.customer.findUnique({
      where: { kodeCustomer },
      include: { outlets: { where: { kodePI } } },
    });
    if (byKode) {
      if (byKode.outlets.length === 0) {
        await prisma.customerOutlet.create({ data: { customerId: byKode.id, kodePI, isFokus: false } });
      }
      return { ok: true, customerId: byKode.id };
    }
  }

  // isFokus ("Rekomendasi PM") is exclusively driven by the official RS GROUP
  // curation spreadsheet (scripts/syncCustomers.ts Pass 2) — never settable
  // from here, or anyone could self-declare their own doctor a PM recommendation.
  try {
    const customer = await prisma.customer.create({
      data: {
        namaCustomer,
        spesialisasi,
        kodeCustomer,
        outlets: { create: { kodePI, isFokus: false } },
      },
    });
    return { ok: true, customerId: customer.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gagal mendaftarkan user." };
  }
}

export interface CustomerOption {
  id: string;
  kodeCustomer: string | null;
  namaCustomer: string;
  spesialisasi: string;
  /**
   * "Jabatan" — POA Standarisasi label (2026-08-27, user request), computed
   * from Exodus's position/specialist: position "Non Dokter" (case-
   * insensitive) → specialist is the jabatan, otherwise position itself is.
   * Same underlying data as `spesialisasi`, just the position-aware label
   * POA Standarisasi displays instead — POA Estimasi keeps using
   * `spesialisasi` as before, unaffected.
   */
  jabatan: string;
  isFokus: boolean;
}

export interface PsspKontrakSummary {
  id: string;
  cUrut: string;
  nmProduk: string | null;
  kdProduk: string | null;
  prdAwal: string;
  prdAkhir: string;
  biaya: number;
  estBaris: number;  // full-period estimate (correct denominator for %)
  totalLunas: number;
  snapshotDate: string | null;
  kdOutlet: string | null;
  nmOutlet: string | null;
}

/** Returns PSSP contract history for a customer by their kodeCustomer. */
export async function getPsspHistory(kodeCustomer: string): Promise<PsspKontrakSummary[]> {
  if (!kodeCustomer) return [];
  const rows = await prisma.psspKontrak.findMany({
    where: { kdCust: kodeCustomer },
    // id tiebreaker (2026-08-18) — without it, rows tied on prdAkhir+cUrut
    // (multiple products under the same contract) get an arbitrary,
    // query-plan-dependent order from Postgres, which made this diverge from
    // getPsspHistoryByCustomers' batched IN-list version of the same query.
    orderBy: [{ prdAkhir: "desc" }, { cUrut: "asc" }, { id: "asc" }],
    select: {
      id: true, cUrut: true, nmProduk: true, kdProduk: true,
      prdAwal: true, prdAkhir: true, biaya: true,
      estBaris: true, totalLunas: true,
      snapshotDate: true, kdOutlet: true, nmOutlet: true,
    },
  });

  return rows.map((r: {
    id: string; cUrut: string; nmProduk: string | null; kdProduk: string | null;
    prdAwal: string; prdAkhir: string;
    biaya: { toString(): string };
    estBaris: { toString(): string } | null;
    totalLunas: { toString(): string } | null;
    snapshotDate: Date | null;
    kdOutlet: string | null; nmOutlet: string | null;
  }) => ({
    id: r.id,
    cUrut: r.cUrut,
    nmProduk: r.nmProduk,
    kdProduk: r.kdProduk,
    prdAwal: r.prdAwal,
    prdAkhir: r.prdAkhir,
    biaya: parseFloat(r.biaya.toString()) || 0,
    estBaris: parseFloat(r.estBaris?.toString() ?? "0") || 0,
    totalLunas: parseFloat(r.totalLunas?.toString() ?? "0") || 0,
    snapshotDate: r.snapshotDate ? r.snapshotDate.toISOString().slice(0, 10) : null,
    kdOutlet: r.kdOutlet,
    nmOutlet: r.nmOutlet,
  }));
}

/**
 * Batched twin of getPsspHistory — one query for every kodeCustomer in scope
 * instead of one round trip per customer. Added 2026-08-18 (bug report: the
 * team Excel export was calling getPsspHistory in a sequential per-customer
 * loop — ~1,400 distinct customers company-wide meant ~1,400 sequential DB
 * round trips just for this one column set, on top of two other loops doing
 * the same thing, which was long enough to trip the reverse proxy's timeout
 * (502 Bad Gateway) for ADMIN/SFE/VIEWER's company-wide export). Same
 * ordering guarantee per customer as the single-row version — global
 * ORDER BY prdAkhir desc, cUrut asc preserves each customer's relative order
 * once grouped, since it's a stable partition of one ordered result set.
 */
export async function getPsspHistoryByCustomers(kodeCustomers: string[]): Promise<Map<string, PsspKontrakSummary[]>> {
  const distinct = [...new Set(kodeCustomers.filter(Boolean))];
  const map = new Map<string, PsspKontrakSummary[]>();
  if (distinct.length === 0) return map;

  const rows = await prisma.psspKontrak.findMany({
    where: { kdCust: { in: distinct } },
    orderBy: [{ prdAkhir: "desc" }, { cUrut: "asc" }, { id: "asc" }],
    select: {
      id: true, kdCust: true, cUrut: true, nmProduk: true, kdProduk: true,
      prdAwal: true, prdAkhir: true, biaya: true,
      estBaris: true, totalLunas: true,
      snapshotDate: true, kdOutlet: true, nmOutlet: true,
    },
  });

  for (const r of rows as {
    id: string; kdCust: string; cUrut: string; nmProduk: string | null; kdProduk: string | null;
    prdAwal: string; prdAkhir: string;
    biaya: { toString(): string };
    estBaris: { toString(): string } | null;
    totalLunas: { toString(): string } | null;
    snapshotDate: Date | null;
    kdOutlet: string | null; nmOutlet: string | null;
  }[]) {
    const summary: PsspKontrakSummary = {
      id: r.id,
      cUrut: r.cUrut,
      nmProduk: r.nmProduk,
      kdProduk: r.kdProduk,
      prdAwal: r.prdAwal,
      prdAkhir: r.prdAkhir,
      biaya: parseFloat(r.biaya.toString()) || 0,
      estBaris: parseFloat(r.estBaris?.toString() ?? "0") || 0,
      totalLunas: parseFloat(r.totalLunas?.toString() ?? "0") || 0,
      snapshotDate: r.snapshotDate ? r.snapshotDate.toISOString().slice(0, 10) : null,
      kdOutlet: r.kdOutlet,
      nmOutlet: r.nmOutlet,
    };
    const list = map.get(r.kdCust) ?? [];
    list.push(summary);
    map.set(r.kdCust, list);
  }
  return map;
}

export interface VisitHistorySummary {
  periodeAwal: string;
  periodeAkhir: string;
  totalVisits: number;
  byNip: { nip: string; total: number }[];
}

/**
 * Visit history for a customer at a specific outlet, accumulated over the
 * last 3 months (2026-08-04, stakeholder item #7 — "Histori Visit Per
 * Outlet Per Customer (Akumulasi 3 Bulan Terakhir)"). Sourced from the
 * external Exodus Activity API (see src/lib/exodusApi.ts) — returns null
 * when that API isn't configured/reachable, same "degrade to no data"
 * contract as getPsspHospinetSnapshot below for its own external source.
 */
export async function getVisitHistoryByCustomerOutlet(
  kodeCustomer: string,
  kodePI: string
): Promise<VisitHistorySummary | null> {
  if (!kodeCustomer || !kodePI) return null;
  const { periodeAwal, periodeAkhir } = lastNMonthsRange(3);
  const rows = await getVisitCountByCustomerOutlet(kodeCustomer, kodePI, periodeAwal, periodeAkhir);
  if (rows === null) return null;

  const byNip = rows.map((r) => ({
    nip: r.nip,
    total: Object.values(r.actualVisitByPeriod).reduce((s, v) => s + v, 0),
  }));
  const totalVisits = byNip.reduce((s, r) => s + r.total, 0);

  return { periodeAwal, periodeAkhir, totalVisits, byNip };
}

export interface PsspHospinetSnapshotSummary {
  statusCustomer: string;
  psspBerjalan: boolean;
  valuePssp: number;
  pelunasan: number;
  rr: number | null;
}

/**
 * Customer-level PSSP snapshot for divisions PsspKontrak doesn't cover (e.g.
 * Hospinet — see PsspHospinetSnapshot in schema.prisma). Many of these
 * customers have no kodeCustomer (code-less, name-matched at import time),
 * so this looks them up by name+outlet instead of a code, mirroring how
 * they were resolved at import.
 */
export async function getPsspHospinetSnapshot(namaCustomer: string, kodePI: string): Promise<PsspHospinetSnapshotSummary | null> {
  if (!namaCustomer || !kodePI) return null;
  const row = await prisma.psspHospinetSnapshot.findFirst({
    where: { kodePI, customer: { namaCustomer: { equals: namaCustomer, mode: "insensitive" } } },
    select: { statusCustomer: true, psspBerjalan: true, valuePssp: true, pelunasan: true, rr: true },
  });
  if (!row) return null;
  return {
    statusCustomer: row.statusCustomer,
    psspBerjalan: row.psspBerjalan,
    valuePssp: parseFloat(row.valuePssp.toString()) || 0,
    pelunasan: parseFloat(row.pelunasan.toString()) || 0,
    rr: row.rr != null ? parseFloat(row.rr.toString()) : null,
  };
}

export interface HospinetSnapshotRow extends PsspHospinetSnapshotSummary {
  namaCustomer: string;
  kodeCustomer: string | null; // Hospinet's own numbering — see PsspHospinetSnapshot.kodeCustomer
  kodePI: string;
  namaOutlet: string | null;
  periodeAwal: string | null;  // YYYYMM
  periodeAkhir: string | null; // YYYYMM
}

/**
 * Returns every Hospinet PSSP snapshot across a set of outlets — the
 * aggregate-only counterpart to getActivePsspByOutlets (PsspKontrak), used
 * for the "PSSP Hospinet" export sheets so managers can see pelunasan for
 * customers this coarser source covers that PsspKontrak doesn't.
 */
export async function getHospinetSnapshotsByOutlets(kodePIs: string[]): Promise<HospinetSnapshotRow[]> {
  const distinct = [...new Set(kodePIs.filter(Boolean))];
  if (distinct.length === 0) return [];

  const rows = await prisma.psspHospinetSnapshot.findMany({
    where: { kodePI: { in: distinct } },
    include: { customer: { select: { namaCustomer: true } }, outlet: { select: { namaOutlet: true } } },
  });

  return rows.map((r: {
    customer: { namaCustomer: string };
    kodeCustomer: string | null;
    kodePI: string;
    outlet: { namaOutlet: string } | null;
    statusCustomer: string;
    psspBerjalan: boolean;
    periodeAwal: string | null;
    periodeAkhir: string | null;
    valuePssp: { toString(): string };
    pelunasan: { toString(): string };
    rr: { toString(): string } | null;
  }) => ({
    namaCustomer: r.customer.namaCustomer,
    kodeCustomer: r.kodeCustomer,
    kodePI: r.kodePI,
    namaOutlet: r.outlet?.namaOutlet ?? null,
    statusCustomer: r.statusCustomer,
    psspBerjalan: r.psspBerjalan,
    periodeAwal: r.periodeAwal,
    periodeAkhir: r.periodeAkhir,
    valuePssp: parseFloat(r.valuePssp.toString()) || 0,
    pelunasan: parseFloat(r.pelunasan.toString()) || 0,
    rr: r.rr != null ? parseFloat(r.rr.toString()) : null,
  }));
}

export interface ActivePsspRow extends PsspKontrakSummary {
  kdCust: string;
  nmCust: string | null;
  kdOutlet: string | null;
  nmOutlet: string | null;
}

/**
 * Returns still-ACTIVE PSSP contract rows (prdAkhir >= current period) across
 * many customers at once — used by the draft/ringkasan view, which covers
 * every doctor in a POA rather than one at a time like the fill-form sidebar.
 *
 * Includes kdOutlet so callers can restrict to contracts at the SAME outlet the
 * MR is planning for: a doctor can hold PSSP contracts at other outlets too
 * (e.g. practices at multiple hospitals), which must not count toward an MR
 * whose POA only covers one of those outlets.
 */
/**
 * Returns still-ACTIVE PSSP contract rows (prdAkhir >= current period) across
 * many outlets at once — every contract at an outlet, regardless of which
 * doctor holds it or whether that doctor is already a line item in any
 * particular POA. Used for the "PSSP Aktif" portfolio view: an MR should see
 * every running commitment across their whole territory, not just the
 * doctors they happen to have drafted into the current POA.
 */
export async function getActivePsspByOutlets(kodePIs: string[]): Promise<ActivePsspRow[]> {
  const distinct = [...new Set(kodePIs.filter(Boolean))];
  if (distinct.length === 0) return [];

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  const rows = await prisma.psspKontrak.findMany({
    where: { kdOutlet: { in: distinct }, prdAkhir: { gte: currentPeriod } },
    orderBy: [{ prdAkhir: "desc" }, { cUrut: "asc" }],
    select: {
      id: true, kdCust: true, nmCust: true, kdOutlet: true, nmOutlet: true, cUrut: true, nmProduk: true, kdProduk: true,
      prdAwal: true, prdAkhir: true, biaya: true,
      estBaris: true, totalLunas: true,
      snapshotDate: true,
    },
  });

  return rows.map((r: {
    id: string; kdCust: string; nmCust: string | null; kdOutlet: string | null; nmOutlet: string | null; cUrut: string; nmProduk: string | null; kdProduk: string | null;
    prdAwal: string; prdAkhir: string;
    biaya: { toString(): string };
    estBaris: { toString(): string } | null;
    totalLunas: { toString(): string } | null;
    snapshotDate: Date | null;
  }) => ({
    id: r.id,
    kdCust: r.kdCust,
    nmCust: r.nmCust,
    kdOutlet: r.kdOutlet,
    nmOutlet: r.nmOutlet,
    cUrut: r.cUrut,
    nmProduk: r.nmProduk,
    kdProduk: r.kdProduk,
    prdAwal: r.prdAwal,
    prdAkhir: r.prdAkhir,
    biaya: parseFloat(r.biaya.toString()) || 0,
    estBaris: parseFloat(r.estBaris?.toString() ?? "0") || 0,
    totalLunas: parseFloat(r.totalLunas?.toString() ?? "0") || 0,
    snapshotDate: r.snapshotDate ? r.snapshotDate.toISOString().slice(0, 10) : null,
  }));
}

export async function getActivePsspByCustomers(kodeCustomers: string[]): Promise<ActivePsspRow[]> {
  const distinct = [...new Set(kodeCustomers.filter(Boolean))];
  if (distinct.length === 0) return [];

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  const rows = await prisma.psspKontrak.findMany({
    where: { kdCust: { in: distinct }, prdAkhir: { gte: currentPeriod } },
    orderBy: [{ prdAkhir: "desc" }, { cUrut: "asc" }],
    select: {
      id: true, kdCust: true, nmCust: true, kdOutlet: true, nmOutlet: true, cUrut: true, nmProduk: true, kdProduk: true,
      prdAwal: true, prdAkhir: true, biaya: true,
      estBaris: true, totalLunas: true,
      snapshotDate: true,
    },
  });

  return rows.map((r: {
    id: string; kdCust: string; nmCust: string | null; kdOutlet: string | null; nmOutlet: string | null; cUrut: string; nmProduk: string | null; kdProduk: string | null;
    prdAwal: string; prdAkhir: string;
    biaya: { toString(): string };
    estBaris: { toString(): string } | null;
    totalLunas: { toString(): string } | null;
    snapshotDate: Date | null;
  }) => ({
    id: r.id,
    kdCust: r.kdCust,
    nmCust: r.nmCust,
    kdOutlet: r.kdOutlet,
    nmOutlet: r.nmOutlet,
    cUrut: r.cUrut,
    nmProduk: r.nmProduk,
    kdProduk: r.kdProduk,
    prdAwal: r.prdAwal,
    prdAkhir: r.prdAkhir,
    biaya: parseFloat(r.biaya.toString()) || 0,
    estBaris: parseFloat(r.estBaris?.toString() ?? "0") || 0,
    totalLunas: parseFloat(r.totalLunas?.toString() ?? "0") || 0,
    snapshotDate: r.snapshotDate ? r.snapshotDate.toISOString().slice(0, 10) : null,
  }));
}

/**
 * Which of the given kodeCustomer values have EVER had a PSSP contract (any
 * period, active or expired — the full PsspKontrak history, not just
 * still-running ones). Used to decide whether DraftChecklist's "Tercacah
 * (Kuartal Ini)" tile is a meaningful figure or just a confusing duplicate of
 * the doctor's own fresh Estimasi — same treatment as a brand-new doctor
 * (2026-08-04, stakeholder item #11: confirmed "dokter baru" and "tanpa
 * riwayat PSSP" mean the same thing here, so a doctor already matched to a
 * Customer record but who's never actually had a PSSP contract should be
 * hidden too, not just ones with no kodeCust at all).
 */
export async function getPsspEverKodeCust(kodeCustomers: string[]): Promise<string[]> {
  const distinct = [...new Set(kodeCustomers.filter(Boolean))];
  if (distinct.length === 0) return [];
  const rows = await prisma.psspKontrak.findMany({
    where: { kdCust: { in: distinct } },
    select: { kdCust: true },
    distinct: ["kdCust"],
  });
  return rows.map((r: { kdCust: string }) => r.kdCust);
}

export interface PsspStatusByCustomer {
  kdCust: string;
  everPssp: boolean;
  /** Most recent contract's pelunasan % (0-100) — null only if everPssp is
   * true but that contract has no est/lunas figures to compute a ratio from. */
  latestPelunasanPct: number | null;
  isActive: boolean; // true if that most-recent contract hasn't expired yet
  latestPrdAwal: string; // YYYYMM — most recent contract's start period
  latestPrdAkhir: string; // YYYYMM — most recent contract's end period, used to sort/flag by proximity to quarter end
  /** This customer's total distinct PSSP contract count — i.e. the most
   * recent contract's ordinal ("PSSP ke-N"), surfaced in the doctor picker
   * badge (2026-07-28 request) alongside the sidebar's per-contract label. */
  psspKe: number;
}

/**
 * PSSP status per customer at an outlet — "pernah PSSP or not", and their
 * MOST RECENT contract's pelunasan % (summed across that contract's
 * products) — used to tag the doctor picker so an MR can see this before
 * even selecting anyone (2026-07-24 request). Distinct from
 * computePelunasan3Bln (LineItemEditor.tsx), which is a rolling-3-month
 * figure scoped to one already-selected doctor.
 */
export async function getPsspStatusByOutlet(kodePI: string): Promise<PsspStatusByCustomer[]> {
  if (!kodePI) return [];

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  const rows = await prisma.psspKontrak.findMany({
    where: { kdOutlet: kodePI },
    orderBy: [{ prdAkhir: "desc" }],
    select: { kdCust: true, cUrut: true, prdAwal: true, prdAkhir: true, estBaris: true, totalLunas: true },
  });

  // Group by customer, then by contract (cUrut) within that customer.
  const byCustomer = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byCustomer.get(r.kdCust) ?? [];
    list.push(r);
    byCustomer.set(r.kdCust, list);
  }

  const result: PsspStatusByCustomer[] = [];
  for (const [kdCust, custRows] of byCustomer) {
    // Rows are already prdAkhir-desc, so the first row's cUrut is the most recent contract.
    const latestCUrut = custRows[0].cUrut;
    const latestRows = custRows.filter((r: { cUrut: string }) => r.cUrut === latestCUrut);
    const est = latestRows.reduce((s: number, r: { estBaris: { toString(): string } | null }) => s + (parseFloat(r.estBaris?.toString() ?? "0") || 0), 0);
    const lunas = latestRows.reduce((s: number, r: { totalLunas: { toString(): string } | null }) => s + (parseFloat(r.totalLunas?.toString() ?? "0") || 0), 0);
    result.push({
      kdCust,
      everPssp: true,
      latestPelunasanPct: est > 0 ? (lunas / est) * 100 : null,
      isActive: custRows[0].prdAkhir >= currentPeriod,
      latestPrdAwal: custRows[0].prdAwal,
      latestPrdAkhir: custRows[0].prdAkhir,
      psspKe: new Set(custRows.map((r: { cUrut: string }) => r.cUrut)).size,
    });
  }
  return result;
}

export interface ListingFeeKontrakSummary {
  id: string;
  noreq: string;
  nmProduk: string | null;
  kdProduk: string | null;
  prdAwal: string;
  prdAkhir: string;
  value: number;
  targetSales: number | null;
  snapshotDate: string | null;
}

/** Returns Listing Fee contract history for a customer by their kodeCustomer. */
export async function getListingFeeHistory(kodeCustomer: string): Promise<ListingFeeKontrakSummary[]> {
  if (!kodeCustomer) return [];
  const rows = await prisma.listingFeeKontrak.findMany({
    where: { kdCust: kodeCustomer },
    orderBy: [{ prdAkhir: "desc" }, { noreq: "asc" }],
    select: {
      id: true, noreq: true, nmProduk: true, kdProduk: true,
      prdAwal: true, prdAkhir: true, value: true, targetSales: true,
      snapshotDate: true,
    },
  });

  return rows.map((r: {
    id: string; noreq: string; nmProduk: string | null; kdProduk: string | null;
    prdAwal: string; prdAkhir: string;
    value: { toString(): string };
    targetSales: { toString(): string } | null;
    snapshotDate: Date | null;
  }) => ({
    id: r.id,
    noreq: r.noreq,
    nmProduk: r.nmProduk,
    kdProduk: r.kdProduk,
    prdAwal: r.prdAwal,
    prdAkhir: r.prdAkhir,
    value: parseFloat(r.value.toString()) || 0,
    targetSales: r.targetSales != null ? parseFloat(r.targetSales.toString()) || 0 : null,
    snapshotDate: r.snapshotDate ? r.snapshotDate.toISOString().slice(0, 10) : null,
  }));
}

/** Focused doctors at a given outlet+spesialisasi, non-focused ones appended after. */
export async function getCustomersByOutletSpesialisasi(
  kodePI: string,
  spesialisasi: string
): Promise<CustomerOption[]> {
  const rows = await prisma.customerOutlet.findMany({
    where: { kodePI, customer: { spesialisasi } },
    include: { customer: true },
    orderBy: [{ isFokus: "desc" }, { customer: { namaCustomer: "asc" } }],
  });

  return rows.map((r: { isFokus: boolean; customer: { id: string; kodeCustomer: string | null; namaCustomer: string; spesialisasi: string } }) => ({
    id: r.customer.id,
    kodeCustomer: r.customer.kodeCustomer,
    namaCustomer: r.customer.namaCustomer,
    spesialisasi: r.customer.spesialisasi,
    jabatan: r.customer.spesialisasi,
    isFokus: r.isFokus,
  }));
}

interface SourcedCustomer {
  vbCode: string | null;
  namaCustomer: string;
  spesialisasi: string;
  /** Raw Exodus "position" (e.g. "Dokter", "Non Dokter") — used to compute `jabatan`, see computeJabatan(). */
  position: string | null;
  /** Exodus's own `IsVerified` (2026-09-10) — used to dedup same-name duplicates Exodus itself sends for one outlet, see fetchCustomersForOutlet. */
  isVerified: boolean;
}

/** IF position is "Non Dokter" (case-insensitive) → jabatan = specialist, ELSE jabatan = position (2026-08-27, user request). */
function computeJabatan(position: string | null, specialist: string): string {
  const isNonDokter = (position ?? "").trim().toLowerCase() === "non dokter";
  const value = isNonDokter ? specialist : position;
  return value && value.trim() ? value.trim() : "-";
}

/**
 * Customer/dokter source for POA Estimasi + POA Standarisasi — switched
 * 2026-09-02 (user request) to Exodus's genuinely outlet-scoped endpoint
 * (`getExodusCustomersByOutletCode`, src/lib/exodusApi.ts:
 * core/v1/outlets?outlet_code=... → core/v1/outlets/{id}/customers), replacing
 * the 2026-08-27 MR-roster-via-nip approach (`getExodusCustomersForMr`) that
 * existed only because the per-nip endpoint carries no outlet mapping at
 * all. Best-effort only, same "no data" degradation as the rest of
 * exodusApi.ts.
 */
async function fetchCustomersForOutlet(kodePI: string): Promise<SourcedCustomer[]> {
  const customers = await getExodusCustomersByOutletCode(kodePI);
  if (!customers) return [];

  const mapped = customers.map((c) => ({
    vbCode: c.customerCode,
    namaCustomer: c.name,
    // Fall back to position when Exodus gives no specialist (2026-09-03,
    // user request) — position is still better than the bare "-" placeholder.
    spesialisasi: c.specialist && c.specialist.trim() ? c.specialist.trim() : (c.position && c.position.trim() ? c.position.trim() : "-"),
    position: c.position,
    isVerified: c.isVerified,
  }));

  // Exodus itself can send more than one row for the same doctor at this
  // outlet (2026-09-10 bug report — duplicate dokter in the picker). This
  // endpoint DOES carry `IsVerified` (unlike customers-databases's
  // user_nip-scoped shape, see getExodusCustomerDatabaseByNip's own note),
  // so prefer the verified row on a name collision instead of the earlier
  // keep-first-arbitrary fallback.
  const byName = new Map<string, SourcedCustomer>();
  for (const c of mapped) {
    const key = c.namaCustomer.trim().toUpperCase();
    const existing = byName.get(key);
    if (!existing || (c.isVerified && !existing.isVerified)) byName.set(key, c);
  }
  return [...byName.values()];
}

/**
 * Bulk kodeCustomer → spesialisasi lookup, built from the Exodus-backed
 * fetchCustomersForOutlet across every given outlet. Still fans out per
 * outlet with limited concurrency; outlets whose id was already resolved
 * transparently reuse getExodusCustomersByOutletCode's own caches instead of
 * re-fetching. Best-effort per outlet — an outlet this fails to resolve for
 * just contributes no spesialisasi entries, never throws.
 */
export async function getNexusSpesialisasiByOutlets(outletKodes: string[]): Promise<Map<string, string>> {
  const spesByKode = new Map<string, string>();
  const CONCURRENCY = 10;
  const uniqueOutlets = [...new Set(outletKodes)];
  for (let i = 0; i < uniqueOutlets.length; i += CONCURRENCY) {
    const batch = uniqueOutlets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((kodePI) => fetchCustomersForOutlet(kodePI)));
    for (const customers of results) {
      for (const c of customers) {
        if (c.vbCode) spesByKode.set(c.vbCode.toUpperCase(), c.spesialisasi);
      }
    }
  }
  return spesByKode;
}

type LocalCustomerOutletRow = { customer: { id: string; kodeCustomer: string | null; namaCustomer: string }; isFokus: boolean };

/**
 * Materializes a local Customer + CustomerOutlet row for an Exodus-confirmed
 * doctor at this outlet that has no local match yet — same find-or-create
 * shape as createCustomerAction's manual "Daftar User Baru" flow, just
 * triggered by an Exodus-confirmed read instead of MR input. isFokus always
 * false (never settable except by scripts/syncCustomers.ts Pass 2, same rule
 * as createCustomerAction). Falls back to re-reading on a unique-constraint
 * race (kodeCustomer) instead of throwing — best-effort, same degrade
 * contract as the rest of this file's Exodus-backed reads.
 */
async function materializeLocalCustomerOutlet(kodePI: string, nc: SourcedCustomer): Promise<LocalCustomerOutletRow | null> {
  try {
    if (nc.vbCode) {
      const existing = await prisma.customer.findUnique({
        where: { kodeCustomer: nc.vbCode },
        include: { outlets: { where: { kodePI } } },
      });
      if (existing) {
        if (existing.outlets.length === 0) {
          await prisma.customerOutlet.create({ data: { customerId: existing.id, kodePI, isFokus: false } });
        }
        return { customer: existing, isFokus: existing.outlets[0]?.isFokus ?? false };
      }
    }
    const created = await prisma.customer.create({
      data: {
        namaCustomer: nc.namaCustomer,
        spesialisasi: nc.spesialisasi && nc.spesialisasi.trim() ? nc.spesialisasi.trim() : "-",
        kodeCustomer: nc.vbCode,
        outlets: { create: { kodePI, isFokus: false } },
      },
    });
    return { customer: created, isFokus: false };
  } catch {
    // Unique constraint (kodeCustomer) race with a concurrent request — the
    // row exists now, re-read it instead of failing this one entry.
    if (nc.vbCode) {
      const existing = await prisma.customer.findUnique({
        where: { kodeCustomer: nc.vbCode },
        include: { outlets: { where: { kodePI } } },
      });
      if (existing) return { customer: existing, isFokus: existing.outlets[0]?.isFokus ?? false };
    }
    return null;
  }
}

/**
 * Customers actually AT this outlet — lets an MR search by the doctor's own
 * NAME first when they don't know/remember the spesialisasi, instead of
 * being forced to guess through the spesialisasi dropdown before the
 * customer list can even load (2026-07-23).
 *
 * `fetchCustomersForOutlet` is genuinely outlet-scoped at the source
 * (2026-09-02, core/v1/outlets/{id}/customers) — the old local-DB gate
 * (2026-08-28, from back when the source was an unfiltered MR roster) is
 * dropped: every doctor Exodus confirms at this outlet is now trusted
 * directly, with a local Customer/CustomerOutlet row materialized on the fly
 * (`materializeLocalCustomerOutlet`) for whichever entries don't have one yet
 * — same shape as the manual "Daftar User Baru" flow. `id` is always a real
 * `Customer.id`.
 *
 * Enrichment pass (2026-09-07, user report: inactive customers not showing
 * up here) — `fetchCustomersForOutlet`'s source (core/v1/outlets/{id}/
 * customers) appears to drop inactive customers entirely. Merges in the
 * logged-in MR's own roster from getExodusCustomerDatabaseByNip (carries
 * ALL statuses, filtered to this outlet by outlet_code) for any doctor not
 * already returned by the primary source — additive only, never replaces a
 * primary-source entry.
 */
export async function getCustomersByOutlet(kodePI: string): Promise<CustomerOption[]> {
  const session = await getCurrentUser();
  const [localRows, sourcedCustomers, dbRoster] = await Promise.all([
    prisma.customerOutlet.findMany({
      where: { kodePI },
      include: { customer: true },
    }),
    fetchCustomersForOutlet(kodePI),
    session ? getExodusCustomerDatabaseByNip(session.nip) : Promise.resolve(null),
  ]);

  if (dbRoster) {
    const known = new Set(sourcedCustomers.map((c) => c.vbCode?.toUpperCase()).filter((v): v is string => !!v));
    // dbRoster itself can carry duplicate doctors for the same outlet (Exodus's
    // own data, not a bug on our side — confirmed 2026-09-10). No `is_verified`
    // field to disambiguate: it only appears on the company-wide (no `user_nip`)
    // shape of this endpoint, unreachable with our external client credential
    // (`user_nip` is required for us, per the API's own param doc). Dedup by
    // normalized NAME (not just code — two rows for the same doctor can carry
    // different/missing customer_code) as the best available fallback, keep-first.
    const knownNames = new Set(sourcedCustomers.map((c) => c.namaCustomer.trim().toUpperCase()));
    for (const entry of dbRoster) {
      if (entry.outletCode !== kodePI) continue;
      const key = entry.customerCode?.toUpperCase();
      const nameKey = entry.name.trim().toUpperCase();
      if (key && known.has(key)) continue;
      if (knownNames.has(nameKey)) continue;
      sourcedCustomers.push({
        vbCode: entry.customerCode,
        namaCustomer: entry.name,
        spesialisasi: entry.specialist && entry.specialist.trim() ? entry.specialist.trim() : (entry.position && entry.position.trim() ? entry.position.trim() : "-"),
        position: entry.position,
        isVerified: false, // customers-databases carries no IsVerified field (see note above)
      });
      if (key) known.add(key);
      knownNames.add(nameKey);
    }
  }

  const localByKode = new Map<string, LocalCustomerOutletRow>();
  const localByName = new Map<string, LocalCustomerOutletRow>();
  for (const r of localRows) {
    if (r.customer.kodeCustomer) localByKode.set(r.customer.kodeCustomer.toUpperCase(), r);
    else localByName.set(r.customer.namaCustomer.trim().toUpperCase(), r);
  }

  const result: CustomerOption[] = [];
  for (const nc of sourcedCustomers) {
    const key = nc.vbCode?.toUpperCase();
    // Fall back to a name match even when the source gives a vbCode: an old
    // manually-entered Customer row (kodeCustomer null) never lands in
    // localByKode, so without this fallback it's never found once the source
    // starts returning a code for that same doctor (2026-08-26 bug report).
    let localMatch = (key ? localByKode.get(key) : undefined)
      ?? localByName.get(nc.namaCustomer.trim().toUpperCase());
    if (!localMatch) {
      const materialized = await materializeLocalCustomerOutlet(kodePI, nc);
      if (!materialized) continue; // DB write failed — skip this entry rather than surface a fake id
      localMatch = materialized;
    }
    result.push({
      id: localMatch.customer.id,
      kodeCustomer: nc.vbCode,
      namaCustomer: nc.namaCustomer,
      spesialisasi: nc.spesialisasi,
      jabatan: computeJabatan(nc.position, nc.spesialisasi),
      isFokus: localMatch.isFokus,
    });
  }

  result.sort((a, b) => {
    if (a.isFokus !== b.isFokus) return a.isFokus ? -1 : 1;
    return a.namaCustomer.localeCompare(b.namaCustomer, "id");
  });

  return result;
}

export interface KriteriaByOutlet {
  kodeProduk: string;
  paket: string;
  kriteriaBaru: string;
  /** "Low Hanging Fruit" | "Blue Ocean" | "Red Ocean" */
  kategori: string;
}

/** Returns OutletProductKriteria for a given outlet — used to annotate the product dropdown. */
export async function getKriteriaByOutlet(kodePI: string): Promise<KriteriaByOutlet[]> {
  if (!kodePI) return [];
  const rows = await prisma.outletProductKriteria.findMany({
    where: { kodePI },
    select: { kodeProduk: true, paket: true, kriteriaBaru: true, kategori: true },
  });
  return rows as KriteriaByOutlet[];
}

/**
 * Distinct product names that have EVER shown up in a PSSP contract at this
 * outlet — any customer, any period, expired or active. Used to auto-mark a
 * product "Sudah Standarisasi" on the product picker even when it has no
 * OutletProductKriteria row: if a product was already under PSSP at this
 * outlet, it's necessarily already listed there, regardless of what the
 * kriteria import happens to say (2026-07-27 request — kriteria-based
 * auto-populate alone missed products PSSP already proves are established).
 */
export async function getPsspProductNamesByOutlet(kodePI: string): Promise<string[]> {
  if (!kodePI) return [];
  const rows = await prisma.psspKontrak.findMany({
    where: { kdOutlet: kodePI, nmProduk: { not: null } },
    select: { nmProduk: true },
    distinct: ["nmProduk"],
  });
  return rows.map((r: { nmProduk: string | null }) => r.nmProduk as string);
}

export interface KompetitorHistoryEntry {
  namaProduk: string;
  pct: number;
  /** pct% of potensiBulan, rounded — null when potensiBulan isn't on file. */
  qty: number | null;
}

// First contiguous run of letters/hyphens — a rough "brand root" (e.g.
// "NEBACETIN" from both "NEBACETIN POWDER 5 G" and the survey's abbreviated
// "NEBACETIN PWD  5G"). Used to decide whether a History Produk entry is one
// of our own products: if ANY Product.namaProduk shares this root, treat the
// entry as ours and exclude it from the competitor suggestion — errs toward
// under- rather than over-reporting competitors, which matches what was
// asked ("kalau history produknya produk kita, jangan masukkan ke
// kompetitor").
function brandRoot(namaProduk: string): string {
  const m = namaProduk.trim().toUpperCase().match(/^[A-Z][A-Z-]*/);
  return m ? m[0] : namaProduk.trim().toUpperCase();
}

export interface SurveyRekomendasiInfo {
  /** Non-Pharos products from the row's History Produk — see brandRoot() above. */
  kompetitor: KompetitorHistoryEntry[];
  /** Survey's own "Potensi / Bulan" figure for this doctor+outlet+product. */
  potensiBulan: number | null;
}

// Shared by getSurveyRekomendasiInfo (single row) and getSurveyRekomendasiByOutlet
// (all rows) — parses the raw "PRODUCT NAME (XX.X%); ..." string and drops
// entries that are actually our own products (see brandRoot() above).
function parseKompetitorHistory(
  historyProduk: string,
  pharosRoots: Set<string>,
  potensiBulan: number | null
): KompetitorHistoryEntry[] {
  const entries: KompetitorHistoryEntry[] = historyProduk.split(";").map((s: string) => {
    const trimmed = s.trim();
    const m = trimmed.match(/^(.*)\((\d+(?:\.\d+)?)%\)\s*$/);
    const pct = m ? parseFloat(m[2]) : 0;
    const namaProduk = m ? m[1].trim() : trimmed;
    const qty = pct > 0 && potensiBulan != null ? Math.round((pct / 100) * potensiBulan) : null;
    return { namaProduk, pct, qty };
  }).filter((e: KompetitorHistoryEntry) => e.namaProduk);
  return entries.filter((e) => !pharosRoots.has(brandRoot(e.namaProduk)));
}

async function getPharosRoots(): Promise<Set<string>> {
  const products = await prisma.product.findMany({ select: { namaProduk: true } });
  return new Set(products.map((p: { namaProduk: string }) => brandRoot(p.namaProduk)));
}

/**
 * Returns SurveyRekomendasi info for one specific (doctor, outlet,
 * recommended product) — used to auto-suggest "Produk Kompetitor Utama" and
 * show the survey's monthly potential when an MR picks that exact product
 * in the POA form's product dropdown (see SurveyRekomendasi doc comment in
 * schema.prisma for the source file's shape).
 */
export async function getSurveyRekomendasiInfo(
  kodeCustomer: string, kodePI: string, kodeProduk: string
): Promise<SurveyRekomendasiInfo | null> {
  if (!kodeCustomer || !kodePI || !kodeProduk) return null;

  const row = await prisma.surveyRekomendasi.findUnique({
    where: { kodePI_kodeCustomer_kodeProduk: { kodePI, kodeCustomer, kodeProduk } },
    select: { historyProduk: true, potensiBulan: true },
  });
  if (!row) return null;

  const pharosRoots = await getPharosRoots();
  const potensiBulan = row.potensiBulan != null ? parseFloat(row.potensiBulan.toString()) : null;

  return {
    kompetitor: parseKompetitorHistory(row.historyProduk, pharosRoots, potensiBulan),
    potensiBulan,
  };
}

export interface SurveyRekomendasiRow {
  kodeProduk: string;
  namaProdukRekomendasi: string;
  kompetitor: KompetitorHistoryEntry[];
  potensiBulan: number | null;
}

/**
 * Returns every SurveyRekomendasi row for one (doctor, outlet) — the full
 * set of recommended products, unlike getSurveyRekomendasiInfo() above which
 * is narrowed to whatever product is currently selected in the POA form.
 * Powers the "Data Survey" sidebar tab (2026-07-24) so an MR can see the
 * complete survey picture for this doctor, not just the current row's product.
 */
export async function getSurveyRekomendasiByOutlet(
  kodeCustomer: string, kodePI: string
): Promise<SurveyRekomendasiRow[]> {
  if (!kodeCustomer || !kodePI) return [];

  const rows = await prisma.surveyRekomendasi.findMany({
    where: { kodePI, kodeCustomer },
    select: { kodeProduk: true, namaProdukRekomendasi: true, historyProduk: true, potensiBulan: true },
    orderBy: { namaProdukRekomendasi: "asc" },
  });
  if (rows.length === 0) return [];

  const pharosRoots = await getPharosRoots();

  return rows.map((r: { kodeProduk: string; namaProdukRekomendasi: string; historyProduk: string; potensiBulan: { toString(): string } | null }) => {
    const potensiBulan = r.potensiBulan != null ? parseFloat(r.potensiBulan.toString()) : null;
    return {
      kodeProduk: r.kodeProduk,
      namaProdukRekomendasi: r.namaProdukRekomendasi,
      kompetitor: parseKompetitorHistory(r.historyProduk, pharosRoots, potensiBulan),
      potensiBulan,
    };
  });
}

export interface SurveyRekomendasiOutletRow {
  kodeProduk: string;
  namaProdukRekomendasi: string;
  /** How many distinct dokter at this outlet have this product recommended. */
  jumlahDokter: number;
  /** Sum of potensiBulan across every dokter recommending this product — null when none had a figure. */
  totalPotensiBulan: number | null;
  /** Competitor brands seen across all dokter's history for this product, most-mentioned first. */
  kompetitor: { namaProduk: string; jumlahDokter: number }[];
}

/**
 * Outlet-level rollup of SurveyRekomendasi — unlike getSurveyRekomendasiByOutlet
 * (narrowed to one dokter), this aggregates EVERY dokter's recommendation at
 * the outlet into one row per produk (dokter count, summed potential, merged
 * competitor list). Powers POA Standarisasi's "Data Survey" sidebar tab
 * (Produk × Outlet axis, no single dokter selected — docs/TODO.md #15).
 */
export async function getSurveyRekomendasiByOutletAggregate(kodePI: string): Promise<SurveyRekomendasiOutletRow[]> {
  if (!kodePI) return [];
  const rows = await prisma.surveyRekomendasi.findMany({
    where: { kodePI },
    select: { kodeProduk: true, namaProdukRekomendasi: true, historyProduk: true, potensiBulan: true },
  });
  if (rows.length === 0) return [];

  const pharosRoots = await getPharosRoots();
  const byProduk = new Map<string, { namaProdukRekomendasi: string; jumlahDokter: number; totalPotensiBulan: number | null; kompetitorCount: Map<string, number> }>();

  for (const r of rows) {
    const potensiBulan = r.potensiBulan != null ? parseFloat(r.potensiBulan.toString()) : null;
    let agg = byProduk.get(r.kodeProduk);
    if (!agg) {
      agg = { namaProdukRekomendasi: r.namaProdukRekomendasi, jumlahDokter: 0, totalPotensiBulan: null, kompetitorCount: new Map() };
      byProduk.set(r.kodeProduk, agg);
    }
    agg.jumlahDokter += 1;
    if (potensiBulan != null) agg.totalPotensiBulan = (agg.totalPotensiBulan ?? 0) + potensiBulan;
    for (const k of parseKompetitorHistory(r.historyProduk, pharosRoots, potensiBulan)) {
      agg.kompetitorCount.set(k.namaProduk, (agg.kompetitorCount.get(k.namaProduk) ?? 0) + 1);
    }
  }

  return Array.from(byProduk.entries())
    .map(([kodeProduk, agg]) => ({
      kodeProduk,
      namaProdukRekomendasi: agg.namaProdukRekomendasi,
      jumlahDokter: agg.jumlahDokter,
      totalPotensiBulan: agg.totalPotensiBulan,
      kompetitor: Array.from(agg.kompetitorCount.entries())
        .map(([namaProduk, jumlahDokter]) => ({ namaProduk, jumlahDokter }))
        .sort((a, b) => b.jumlahDokter - a.jumlahDokter),
    }))
    .sort((a, b) => a.namaProdukRekomendasi.localeCompare(b.namaProdukRekomendasi, "id"));
}

/**
 * Batched twin of getSurveyRekomendasiByOutlet — one query for every
 * kodeCustomer in scope (not per kodeCustomer×kodePI pair), keyed by
 * `${kodeCustomer}|${kodePI}` in the returned map. Same 2026-08-18 perf fix
 * as getPsspHistoryByCustomers above — see its doc comment.
 */
export async function getSurveyRekomendasiByCustomers(kodeCustomers: string[]): Promise<Map<string, SurveyRekomendasiRow[]>> {
  const distinct = [...new Set(kodeCustomers.filter(Boolean))];
  const map = new Map<string, SurveyRekomendasiRow[]>();
  if (distinct.length === 0) return map;

  const rows = await prisma.surveyRekomendasi.findMany({
    where: { kodeCustomer: { in: distinct } },
    select: { kodePI: true, kodeCustomer: true, kodeProduk: true, namaProdukRekomendasi: true, historyProduk: true, potensiBulan: true },
    orderBy: { namaProdukRekomendasi: "asc" },
  });
  if (rows.length === 0) return map;

  const pharosRoots = await getPharosRoots();
  for (const r of rows as {
    kodePI: string; kodeCustomer: string; kodeProduk: string; namaProdukRekomendasi: string;
    historyProduk: string; potensiBulan: { toString(): string } | null;
  }[]) {
    const potensiBulan = r.potensiBulan != null ? parseFloat(r.potensiBulan.toString()) : null;
    const key = `${r.kodeCustomer}|${r.kodePI}`;
    const list = map.get(key) ?? [];
    list.push({
      kodeProduk: r.kodeProduk,
      namaProdukRekomendasi: r.namaProdukRekomendasi,
      kompetitor: parseKompetitorHistory(r.historyProduk, pharosRoots, potensiBulan),
      potensiBulan,
    });
    map.set(key, list);
  }
  return map;
}

export interface DiskonByProduct {
  kodeProduk: string;
  newOnPi: number;  // effective on-invoice discount %, e.g. 12.5 for 12.5%
  prdAwal: string;  // YYYYMM
  prdAkhir: string; // YYYYMM
}

/**
 * DiskonKontrak rows for a given outlet — used to default "% Diskon (DPL/DPF)"
 * to the real contracted discount instead of a dummy placeholder. When more
 * than one contract covers the same product+period at this outlet, the
 * caller should take the one with the largest newOnPi.
 */
export async function getDiskonByOutlet(kodePI: string): Promise<DiskonByProduct[]> {
  if (!kodePI) return [];
  // Live Exodus DPL contracts replace DiskonKontrak as the primary source
  // (2026-08-28 decision) — falls back to the DB/Excel-import table only
  // when Exodus is unreachable/unconfigured, same degrade contract as
  // masterData.ts's applyLivePricing.
  const live = await getExodusDplContracts(kodePI);
  if (live) return live;
  const rows = await prisma.diskonKontrak.findMany({
    where: { kodePI, newOnPi: { not: null } },
    select: { kodeProduk: true, newOnPi: true, prdAwal: true, prdAkhir: true },
  });
  return rows.map((r: { kodeProduk: string; newOnPi: { toString(): string } | null; prdAwal: string; prdAkhir: string }) => ({
    kodeProduk: r.kodeProduk,
    newOnPi: parseFloat(r.newOnPi!.toString()),
    prdAwal: r.prdAwal,
    prdAkhir: r.prdAkhir,
  }));
}

export interface DiskonHistoryByProduct {
  kodeProduk: string;
  maxDiskonPct: number; // highest single-invoice historical % Total Diskon, not period-scoped
}

/**
 * DiskonHistory rows for a given outlet — fallback ONLY, used when
 * getDiskonByOutlet has no DPL contract covering the outlet+product+period.
 * See scripts/importDiskonHistory.ts.
 */
export async function getDiskonHistoryByOutlet(kodePI: string): Promise<DiskonHistoryByProduct[]> {
  if (!kodePI) return [];
  // Live Exodus DPF requests replace DiskonHistory as the fallback source
  // (2026-08-28 decision) — see getDiskonByOutlet above for the same
  // degrade-to-DB contract.
  const live = await getExodusDiskonHistory(kodePI);
  if (live) return live;
  const rows = await prisma.diskonHistory.findMany({
    where: { kodePI },
    select: { kodeProduk: true, maxDiskonPct: true },
  });
  return rows.map((r: { kodeProduk: string; maxDiskonPct: { toString(): string } }) => ({
    kodeProduk: r.kodeProduk,
    maxDiskonPct: parseFloat(r.maxDiskonPct.toString()),
  }));
}

/** Batched twin of getDiskonByOutlet — one query for every kodePI in scope. Same 2026-08-18 perf fix as getPsspHistoryByCustomers above. */
export async function getDiskonByOutlets(kodePIs: string[]): Promise<Map<string, DiskonByProduct[]>> {
  const distinct = [...new Set(kodePIs.filter(Boolean))];
  const map = new Map<string, DiskonByProduct[]>();
  if (distinct.length === 0) return map;
  const rows = await prisma.diskonKontrak.findMany({
    where: { kodePI: { in: distinct }, newOnPi: { not: null } },
    select: { kodePI: true, kodeProduk: true, newOnPi: true, prdAwal: true, prdAkhir: true },
  });
  for (const r of rows as { kodePI: string; kodeProduk: string; newOnPi: { toString(): string } | null; prdAwal: string; prdAkhir: string }[]) {
    const list = map.get(r.kodePI) ?? [];
    list.push({ kodeProduk: r.kodeProduk, newOnPi: parseFloat(r.newOnPi!.toString()), prdAwal: r.prdAwal, prdAkhir: r.prdAkhir });
    map.set(r.kodePI, list);
  }
  return map;
}

/** Batched twin of getDiskonHistoryByOutlet — one query for every kodePI in scope. Same 2026-08-18 perf fix as getPsspHistoryByCustomers above. */
export async function getDiskonHistoryByOutlets(kodePIs: string[]): Promise<Map<string, DiskonHistoryByProduct[]>> {
  const distinct = [...new Set(kodePIs.filter(Boolean))];
  const map = new Map<string, DiskonHistoryByProduct[]>();
  if (distinct.length === 0) return map;
  const rows = await prisma.diskonHistory.findMany({
    where: { kodePI: { in: distinct } },
    select: { kodePI: true, kodeProduk: true, maxDiskonPct: true },
  });
  for (const r of rows as { kodePI: string; kodeProduk: string; maxDiskonPct: { toString(): string } }[]) {
    const list = map.get(r.kodePI) ?? [];
    list.push({ kodeProduk: r.kodeProduk, maxDiskonPct: parseFloat(r.maxDiskonPct.toString()) });
    map.set(r.kodePI, list);
  }
  return map;
}
