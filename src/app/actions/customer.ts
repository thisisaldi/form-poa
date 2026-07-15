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
