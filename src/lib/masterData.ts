/**
 * Outlet and product lookup abstraction.
 * - In mock mode (USE_MOCK_DB=true): returns in-memory mock data.
 * - In production: queries the Outlet table synced from MSSQL.
 */

import { MOCK_CUSTOMERS, MOCK_PRODUCTS, type MockCustomer } from "./mock/data";

export type { MockCustomer as Customer };

export interface Product {
  kodeProduk: string;
  namaGroupBrand: string;
  namaProduk: string;
  zatAktif: string | null;
  satuan: string;
  hna: { toString(): string };
}

const isMock = process.env.USE_MOCK_DB === "true";

// ─── Outlet queries ───────────────────────────────────────────────────────────

export async function getCustomers(): Promise<MockCustomer[]> {
  if (isMock) return MOCK_CUSTOMERS;

  const { prisma } = await import("@/lib/prisma");
  const outlets = await prisma.outlet.findMany({
    where: { statusOutlet: "A" },
    orderBy: { namaOutlet: "asc" },
  });

  return outlets.map((o: { kodePI: string; namaOutlet: string; sector: string | null; subSektor: string | null }) => ({
    kodeRequest: o.kodePI,
    kodeCust: o.kodePI,
    namaCust: o.namaOutlet,
    role: o.sector ?? "",
    spesialisasi: o.subSektor ?? "",
    historisPSSP: null,
    kodePI: o.kodePI,
    namaOutlet: o.namaOutlet,
  }));
}

export async function getCustomerByKodeRequest(kodeRequest: string): Promise<MockCustomer | null> {
  if (isMock) return MOCK_CUSTOMERS.find((c) => c.kodeRequest === kodeRequest) ?? null;

  // In production, kodeRequest is stored as kodePI (see getOutletsByUser)
  return getOutletByKodePI(kodeRequest);
}

export async function getOutletsByUser(userId: string): Promise<MockCustomer[]> {
  if (isMock) return MOCK_CUSTOMERS;

  const { prisma } = await import("@/lib/prisma");
  const assignments = await prisma.mrOutletAssignment.findMany({
    where: { nipMR: userId },
    include: { outlet: true },
  });

  return assignments.map(({ outlet: o }: { outlet: { kodePI: string; namaOutlet: string; sector: string | null; subSektor: string | null } }) => ({
    kodeRequest: o.kodePI,
    kodeCust: o.kodePI,
    namaCust: o.namaOutlet,
    role: o.sector ?? "",
    spesialisasi: o.subSektor ?? "",
    historisPSSP: null,
    kodePI: o.kodePI,
    namaOutlet: o.namaOutlet,
  }));
}

export async function getOutletByKodePI(kodePI: string): Promise<MockCustomer | null> {
  if (isMock) return MOCK_CUSTOMERS.find((c) => c.kodePI === kodePI) ?? null;

  const { prisma } = await import("@/lib/prisma");
  const o = await prisma.outlet.findUnique({ where: { kodePI } });
  if (!o) return null;

  return {
    kodeRequest: o.kodePI,
    kodeCust: o.kodePI,
    namaCust: o.namaOutlet,
    role: o.sector ?? "",
    spesialisasi: o.subSektor ?? "",
    historisPSSP: null,
    kodePI: o.kodePI,
    namaOutlet: o.namaOutlet,
  };
}

// ─── Product queries ──────────────────────────────────────────────────────────

export async function getProducts(): Promise<Product[]> {
  if (isMock) return MOCK_PRODUCTS;

  const { prisma } = await import("@/lib/prisma");
  return prisma.product.findMany({ orderBy: { namaProduk: "asc" } });
}

export async function getProductByKode(kodeProduk: string): Promise<Product | null> {
  if (isMock) return MOCK_PRODUCTS.find((p) => p.kodeProduk === kodeProduk) ?? null;

  const { prisma } = await import("@/lib/prisma");
  return prisma.product.findUnique({ where: { kodeProduk } });
}
