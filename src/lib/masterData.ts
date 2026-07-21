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
  satuan: string;           // SJ (Satuan Jual), e.g. "BOX"
  hna: string;              // HNA per SJ
  nilaiRPersen: string | null;
  satuanTerkecil: string | null;   // ST unit name, e.g. "TABLET", "BOTOL"
  konversiPembagi: string | null;  // how many ST per SJ
  // Dosis reference data — from "List Product pharos.xlsx"
  dosisKekuatanSediaan: string | null;
  qtyPerRxPasien: string | null;
  lamaPemberianHari: number | null;
  jumlahPemberianPerHari: string | null;
  bentukSediaan: string | null;
  packing: string | null;
  indikasi: string | null;
}

// ─── Outlet queries ───────────────────────────────────────────────────────────

function toMockCustomer(o: { kodePI: string; namaOutlet: string; sector?: string | null; subSektor?: string | null; groupRS?: string | null }): MockCustomer {
  return {
    kodeRequest: o.kodePI,
    kodeCust: o.kodePI,
    namaCust: o.namaOutlet,
    role: o.sector ?? "",
    spesialisasi: o.subSektor ?? "",
    historisPSSP: null,
    kodePI: o.kodePI,
    namaOutlet: o.namaOutlet,
    groupRS: o.groupRS ?? null,
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

  // Dummy (workshop/demo) accounts can pick from every outlet, not just assigned ones.
  const user = await prisma.user.findUnique({ where: { nip: userId }, select: { isDummy: true, role: true } });
  if (user?.isDummy) return getCustomers();

  const assignments = await prisma.mrOutletAssignment.findMany({
    where: { nipMR: userId },
    include: { outlet: true },
  });
  const fromAssignments = assignments.map(({ outlet: o }: { outlet: { kodePI: string; namaOutlet: string; sector: string | null; subSektor: string | null; groupRS: string | null } }) =>
    toMockCustomer(o)
  );

  // ASM/SM/NSM never get MrOutletAssignment rows themselves (those are only
  // ever written for the MR role) — but they can still create a POA scoped to
  // specific outlets whose own MR/ASM/SM chain is vacant down to them (see
  // canCreatePoa in authz.ts and Outlet.coveredByNip/coveredByRole).
  if (user?.role && user.role !== "MR") {
    const covered = await prisma.outlet.findMany({
      where: { coveredByNip: userId, coveredByRole: { not: "MR" } },
    });
    return [...fromAssignments, ...covered.map(toMockCustomer)];
  }

  return fromAssignments;
}

export async function getOutletByKodePI(kodePI: string): Promise<MockCustomer | null> {
  const { prisma } = await import("@/lib/prisma");
  const o = await prisma.outlet.findUnique({ where: { kodePI } });
  return o ? toMockCustomer(o) : null;
}

// ─── Product queries ──────────────────────────────────────────────────────────

export async function getProducts(): Promise<Product[]> {
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.product.findMany({ where: { hna: { gt: 0 }, namaGroupBrand: { not: "—" }, nilaiRPersen: { not: null } }, orderBy: { namaProduk: "asc" } });
  return rows.map((p: { kodeProduk: string; namaGroupBrand: string; namaProduk: string; zatAktif: string | null; satuan: string; hna: { toString(): string }; nilaiRPersen: { toString(): string } | null; satuanTerkecil: string | null; konversiPembagi: { toString(): string } | null; dosisKekuatanSediaan: string | null; qtyPerRxPasien: { toString(): string } | null; lamaPemberianHari: number | null; jumlahPemberianPerHari: { toString(): string } | null; bentukSediaan: string | null; packing: string | null; indikasi: string | null }) => ({
    ...p,
    hna: p.hna.toString(),
    nilaiRPersen: p.nilaiRPersen?.toString() ?? null,
    satuanTerkecil: p.satuanTerkecil,
    konversiPembagi: p.konversiPembagi?.toString() ?? null,
    qtyPerRxPasien: p.qtyPerRxPasien?.toString() ?? null,
    jumlahPemberianPerHari: p.jumlahPemberianPerHari?.toString() ?? null,
  }));
}

export async function getProductByKode(kodeProduk: string): Promise<Product | null> {
  const { prisma } = await import("@/lib/prisma");
  const p = await prisma.product.findUnique({ where: { kodeProduk } });
  if (!p) return null;
  return {
    ...p,
    hna: p.hna.toString(),
    nilaiRPersen: p.nilaiRPersen?.toString() ?? null,
    satuanTerkecil: p.satuanTerkecil,
    konversiPembagi: p.konversiPembagi?.toString() ?? null,
    qtyPerRxPasien: p.qtyPerRxPasien?.toString() ?? null,
    jumlahPemberianPerHari: p.jumlahPemberianPerHari?.toString() ?? null,
  };
}
