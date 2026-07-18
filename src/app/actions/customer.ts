"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

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

  const namaCustomer  = (formData.get("namaCustomer")  as string | null)?.trim() ?? "";
  const spesialisasi  = (formData.get("spesialisasi")  as string | null)?.trim() ?? "";
  const kodePI        = (formData.get("kodePI")        as string | null)?.trim() ?? "";
  const kodeCustomer  = (formData.get("kodeCustomer")  as string | null)?.trim() || null;
  const isFokus       = formData.get("isFokus") === "true";

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

  const customer = await prisma.customer.create({
    data: {
      namaCustomer,
      spesialisasi,
      kodeCustomer,
      outlets: { create: { kodePI, isFokus } },
    },
  });

  return { ok: true, customerId: customer.id };
}

export interface CustomerOption {
  id: string;
  kodeCustomer: string | null;
  namaCustomer: string;
  spesialisasi: string;
  isFokus: boolean;
}

/** Distinct spesialisasi for all doctors at a given outlet (fokus first, then rest). */
export async function getSpesialisasiByOutlet(kodePI: string): Promise<string[]> {
  const rows = await prisma.customerOutlet.findMany({
    where: { kodePI },
    select: { customer: { select: { spesialisasi: true } }, isFokus: true },
    distinct: ["customerId"],
  });

  // Put spesialisasi that have fokus doctors first
  const fokusSpecs = new Set<string>();
  const allSpecs = new Set<string>();
  for (const r of rows as { isFokus: boolean; customer: { spesialisasi: string } }[]) {
    if (r.isFokus) fokusSpecs.add(r.customer.spesialisasi);
    allSpecs.add(r.customer.spesialisasi);
  }
  const sorted = [
    ...[...fokusSpecs].sort(),
    ...[...allSpecs].filter((s) => !fokusSpecs.has(s)).sort(),
  ];
  return sorted;
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
}

/** Returns PSSP contract history for a customer by their kodeCustomer. */
export async function getPsspHistory(kodeCustomer: string): Promise<PsspKontrakSummary[]> {
  if (!kodeCustomer) return [];
  const rows = await prisma.psspKontrak.findMany({
    where: { kdCust: kodeCustomer },
    orderBy: [{ prdAkhir: "desc" }, { cUrut: "asc" }],
    select: {
      id: true, cUrut: true, nmProduk: true, kdProduk: true,
      prdAwal: true, prdAkhir: true, biaya: true,
      estBaris: true, totalLunas: true,
      snapshotDate: true,
    },
  });

  return rows.map((r: {
    id: string; cUrut: string; nmProduk: string | null; kdProduk: string | null;
    prdAwal: string; prdAkhir: string;
    biaya: { toString(): string };
    estBaris: { toString(): string } | null;
    totalLunas: { toString(): string } | null;
    snapshotDate: Date | null;
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
    isFokus: r.isFokus,
  }));
}

export interface KriteriaByOutlet {
  kodeProduk: string;
  paket: string;
  kriteriaBaru: string;
}

/** Returns OutletProductKriteria for a given outlet — used to annotate the product dropdown. */
export async function getKriteriaByOutlet(kodePI: string): Promise<KriteriaByOutlet[]> {
  if (!kodePI) return [];
  const rows = await prisma.outletProductKriteria.findMany({
    where: { kodePI },
    select: { kodeProduk: true, paket: true, kriteriaBaru: true },
  });
  return rows as KriteriaByOutlet[];
}

export interface Sales3BlnByProduct {
  itemKode: string;
  qty3Bln: number;  // summed qty over the last 3 completed months
}

/** Actual sales qty for the last 3 completed months, per product, for one outlet. */
export async function getSales3BlnByOutlet(kodePI: string): Promise<Sales3BlnByProduct[]> {
  if (!kodePI) return [];

  const now = new Date();
  const months: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const rows = await prisma.outletSalesMonthly.findMany({
    where: { kodePI, periode: { in: months } },
    select: { itemKode: true, qty: true },
  });

  const byProduct = new Map<string, number>();
  for (const r of rows as { itemKode: string; qty: { toString(): string } }[]) {
    const v = parseFloat(r.qty.toString()) || 0;
    byProduct.set(r.itemKode, (byProduct.get(r.itemKode) ?? 0) + v);
  }

  return [...byProduct.entries()].map(([itemKode, qty3Bln]) => ({ itemKode, qty3Bln }));
}
