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

  // isFokus ("Rekomendasi PM") is exclusively driven by the official RS GROUP
  // curation spreadsheet (scripts/syncCustomers.ts Pass 2) — never settable
  // from here, or anyone could self-declare their own doctor a PM recommendation.
  const customer = await prisma.customer.create({
    data: {
      namaCustomer,
      spesialisasi,
      kodeCustomer,
      outlets: { create: { kodePI, isFokus: false } },
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
    orderBy: [{ prdAkhir: "desc" }, { cUrut: "asc" }],
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

interface NexusCustomer {
  vbCode: string | null;
  namaCustomer: string;
  spesialisasi: string;
}

/**
 * Live fallback lookup against the company-wide Nexus API — public, no auth
 * (confirmed 2026-07-23). Best-effort only: any failure (network, timeout,
 * unexpected shape) is swallowed and treated as "no extra results", since
 * this is purely a safety net for gaps in our own DB, not a hard dependency
 * the outlet/customer search should ever be blocked by.
 */
async function fetchNexusCustomersByOutlet(kodePI: string): Promise<NexusCustomer[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://api-nexus.pharos.id/api/r/poa/get_customer_by_outlet?outlet_code=${encodeURIComponent(kodePI)}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return [];

    const json = await res.json();
    const customers = json?.data?.customers;
    if (!Array.isArray(customers)) return [];

    return customers
      .filter((c): c is { vb_code?: string; customer_name?: string; specialist?: string } =>
        !!c && typeof c.customer_name === "string" && typeof c.specialist === "string")
      .map((c) => ({
        vbCode: typeof c.vb_code === "string" && c.vb_code.trim() ? c.vb_code.trim() : null,
        namaCustomer: c.customer_name!.trim(),
        spesialisasi: c.specialist!.trim(),
      }));
  } catch {
    return [];
  }
}

/**
 * Every customer at a given outlet, regardless of spesialisasi — lets an MR
 * search by the doctor's own NAME first when they don't know/remember the
 * spesialisasi, instead of being forced to guess through the spesialisasi
 * dropdown before the customer list can even load (2026-07-23).
 *
 * Merged live with the Nexus API (2026-07-23, business owner: "gabungin aja
 * bareng" — always merge, not just when the DB looks empty) as a safety net
 * for outlets our own Customer/CustomerOutlet import hasn't fully covered
 * yet. Nexus-only entries (no matching local kodeCustomer) get a synthetic
 * "nexus:<vbCode|name>" id — the caller (LineItemEditor's handleCustomerChange)
 * detects that prefix and materializes a real Customer row via
 * createCustomerAction before actually using it as a line item's customerId,
 * since addLineItemAction requires a real Customer.id to exist.
 */
export async function getCustomersByOutlet(kodePI: string): Promise<CustomerOption[]> {
  const [rows, nexusCustomers] = await Promise.all([
    prisma.customerOutlet.findMany({
      where: { kodePI },
      include: { customer: true },
      orderBy: [{ isFokus: "desc" }, { customer: { namaCustomer: "asc" } }],
    }),
    fetchNexusCustomersByOutlet(kodePI),
  ]);

  const local: CustomerOption[] = rows.map((r: { isFokus: boolean; customer: { id: string; kodeCustomer: string | null; namaCustomer: string; spesialisasi: string } }) => ({
    id: r.customer.id,
    kodeCustomer: r.customer.kodeCustomer,
    namaCustomer: r.customer.namaCustomer,
    spesialisasi: r.customer.spesialisasi,
    isFokus: r.isFokus,
  }));

  const localKodeSet = new Set(local.map((c) => c.kodeCustomer?.toUpperCase()).filter(Boolean));
  const localNameSet = new Set(local.map((c) => c.namaCustomer.trim().toUpperCase()));

  const seenNexus = new Set<string>();
  for (const nc of nexusCustomers) {
    const alreadyLocal = (nc.vbCode && localKodeSet.has(nc.vbCode.toUpperCase()))
      || localNameSet.has(nc.namaCustomer.toUpperCase());
    const dedupeKey = nc.vbCode?.toUpperCase() ?? nc.namaCustomer.toUpperCase();
    if (alreadyLocal || seenNexus.has(dedupeKey)) continue;
    seenNexus.add(dedupeKey);
    local.push({
      id: `nexus:${nc.vbCode ?? nc.namaCustomer}`,
      kodeCustomer: nc.vbCode,
      namaCustomer: nc.namaCustomer,
      spesialisasi: nc.spesialisasi,
      isFokus: false,
    });
  }

  return local;
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

export interface KompetitorHistoryEntry {
  namaProduk: string;
  pct: number;
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

  const entries: KompetitorHistoryEntry[] = row.historyProduk.split(";").map((s: string) => {
    const trimmed = s.trim();
    const m = trimmed.match(/^(.*)\((\d+(?:\.\d+)?)%\)\s*$/);
    return m ? { namaProduk: m[1].trim(), pct: parseFloat(m[2]) } : { namaProduk: trimmed, pct: 0 };
  }).filter((e: KompetitorHistoryEntry) => e.namaProduk);

  const products = await prisma.product.findMany({ select: { namaProduk: true } });
  const pharosRoots = new Set(products.map((p: { namaProduk: string }) => brandRoot(p.namaProduk)));

  return {
    kompetitor: entries.filter((e) => !pharosRoots.has(brandRoot(e.namaProduk))),
    potensiBulan: row.potensiBulan != null ? parseFloat(row.potensiBulan.toString()) : null,
  };
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
  avgDiskonPct: number; // weighted-average historical % Total Diskon, not period-scoped
}

/**
 * DiskonHistory rows for a given outlet — fallback ONLY, used when
 * getDiskonByOutlet has no DPL contract covering the outlet+product+period.
 * See scripts/importDiskonHistory.ts.
 */
export async function getDiskonHistoryByOutlet(kodePI: string): Promise<DiskonHistoryByProduct[]> {
  if (!kodePI) return [];
  const rows = await prisma.diskonHistory.findMany({
    where: { kodePI },
    select: { kodeProduk: true, avgDiskonPct: true },
  });
  return rows.map((r: { kodeProduk: string; avgDiskonPct: { toString(): string } }) => ({
    kodeProduk: r.kodeProduk,
    avgDiskonPct: parseFloat(r.avgDiskonPct.toString()),
  }));
}
