/**
 * Outlet and product lookup abstraction.
 * Both mock and production paths use prisma — the mock client transparently
 * serves in-memory / generated-data.json data when USE_MOCK_DB=true.
 */

import type { MockCustomer } from "./mock/data";

export type { MockCustomer as Customer };

export interface Product {
  kodeProduk: string;
  namaGroupBrand: string;
  namaProduk: string;
  zatAktif: string | null;
  satuan: string;
  hna: string;
}

// ─── Outlet queries ───────────────────────────────────────────────────────────

function toMockCustomer(o: { kodePI: string; namaOutlet: string; sector?: string | null; subSektor?: string | null }): MockCustomer {
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

export async function getCustomers(): Promise<MockCustomer[]> {
  const { prisma } = await import("@/lib/prisma");
  const outlets = await prisma.outlet.findMany({ where: { statusOutlet: "A" }, orderBy: { namaOutlet: "asc" } });
  return outlets.map(toMockCustomer);
}

export async function getCustomerByKodeRequest(kodeRequest: string): Promise<MockCustomer | null> {
  return getOutletByKodePI(kodeRequest);
}

export async function getOutletsByUser(userId: string): Promise<MockCustomer[]> {
  const { prisma } = await import("@/lib/prisma");
  const assignments = await prisma.mrOutletAssignment.findMany({
    where: { nipMR: userId },
    include: { outlet: true },
  });
  return assignments.map(({ outlet: o }: { outlet: { kodePI: string; namaOutlet: string; sector: string | null; subSektor: string | null } }) =>
    toMockCustomer(o)
  );
}

export async function getOutletByKodePI(kodePI: string): Promise<MockCustomer | null> {
  const { prisma } = await import("@/lib/prisma");
  const o = await prisma.outlet.findUnique({ where: { kodePI } });
  return o ? toMockCustomer(o) : null;
}

// ─── Product queries ──────────────────────────────────────────────────────────

export async function getProducts(): Promise<Product[]> {
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.product.findMany({ orderBy: { namaProduk: "asc" } });
  return rows.map((p: { kodeProduk: string; namaGroupBrand: string; namaProduk: string; zatAktif: string | null; satuan: string; hna: { toString(): string } }) => ({
    ...p,
    hna: p.hna.toString(),
  }));
}

export async function getProductByKode(kodeProduk: string): Promise<Product | null> {
  const { prisma } = await import("@/lib/prisma");
  const p = await prisma.product.findUnique({ where: { kodeProduk } });
  if (!p) return null;
  return { ...p, hna: p.hna.toString() };
}
