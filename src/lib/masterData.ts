/**
 * Outlet and product lookup abstraction.
 * Both mock and production paths use prisma — the mock client transparently
 * serves in-memory / generated-data.json data when USE_MOCK_DB=true.
 */

import type { MockCustomer } from "./mock/data";
import type { Role, User } from "@prisma/client";

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
  spesialisasiRekomendasi: string[];
}

/** Harga per ST (satuan terkecil) = HNA per SJ / konversiPembagi. Plain helper
 * (not "use client") so both server actions and client components can call it
 * directly — importing from a "use client" module makes every export a client
 * reference, which throws when invoked from server code. */
export function hargaST(product: Product): number {
  const hna = parseFloat(product.hna) || 0;
  const konversi = parseFloat(product.konversiPembagi ?? "1") || 1;
  return hna / konversi;
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
  // ADMIN gets the same treatment (2026-07-24, testing-only POAs — see canCreatePoa
  // in authz.ts) — an admin has no MrOutletAssignment/coveredBy rows of their own.
  const user = await prisma.user.findUnique({ where: { nip: userId }, select: { isDummy: true, role: true } });
  if (user?.isDummy || user?.role === "ADMIN") return getCustomers();

  // MrOutletAssignment is synced monthly (@@unique [nipMR, kodePI, periode]) —
  // one row per outlet PER MONTH, so querying without a periode filter pulled
  // every month this MR has ever been synced, and the SAME outlet came back
  // once per month it appeared in. Scoped the dropdown to just the latest
  // synced periode instead of "this calendar month" (which could be all-empty
  // if this month's sync hasn't run yet) — fixes the "Pilih Outlet" combobox
  // showing duplicate entries per outlet and lagging under the inflated list
  // (2026-08-04 bug report).
  const latestAssignment = await prisma.mrOutletAssignment.findFirst({
    where: { nipMR: userId },
    orderBy: { periode: "desc" },
    select: { periode: true },
  });
  const assignments = latestAssignment
    ? await prisma.mrOutletAssignment.findMany({
        where: { nipMR: userId, periode: latestAssignment.periode },
        include: { outlet: true },
      })
    : [];
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

/**
 * Every outlet assigned to any MR in `mrNips`, latest synced periode only
 * (same "latest periode, not every historic month" fix as getOutletsByUser
 * above — avoids duplicate/stale entries). Used for ASM/SM/NSM, who have no
 * MrOutletAssignment rows of their own (see getOutletsByUser's ASM/SM/NSM
 * branch below) but need visibility over their whole subordinate team's
 * outlets, not just outlets they personally cover via a vacant chain.
 */
export async function getOutletsForMrSubtree(mrNips: string[]): Promise<MockCustomer[]> {
  const { prisma } = await import("@/lib/prisma");
  if (mrNips.length === 0) return [];

  const latestAssignment = await prisma.mrOutletAssignment.findFirst({
    where: { nipMR: { in: mrNips } },
    orderBy: { periode: "desc" },
    select: { periode: true },
  });
  if (!latestAssignment) return [];

  const assignments = await prisma.mrOutletAssignment.findMany({
    where: { nipMR: { in: mrNips }, periode: latestAssignment.periode },
    include: { outlet: true },
  });

  const seen = new Set<string>();
  const result: MockCustomer[] = [];
  for (const { outlet: o } of assignments as { outlet: { kodePI: string; namaOutlet: string; sector: string | null; subSektor: string | null; groupRS: string | null } }[]) {
    if (seen.has(o.kodePI)) continue;
    seen.add(o.kodePI);
    result.push(toMockCustomer(o));
  }
  return result;
}

/**
 * Outlets a session's user may pick for Input Data Survey (2026-08-10 widen —
 * docs/survey-pasien-features/03-ui-and-access.md §5, MR-only v1 broadened to
 * the whole sales chain MR..NSM + ADMIN for testing). MR/ADMIN keep the
 * existing per-user scope; ASM/SM/NSM get every outlet across their
 * subordinate MRs (getOutletsForMrSubtree above), since they have no
 * MrOutletAssignment rows of their own and would otherwise see an empty list
 * whenever their team is fully staffed.
 */
export async function getOutletsForSurveyUpload(session: { nip: string; role: string }): Promise<MockCustomer[]> {
  if (session.role === "MR" || session.role === "ADMIN") {
    return getOutletsByUser(session.nip);
  }
  const { getSubordinateMRNips } = await import("@/lib/authz");
  const mrNips = await getSubordinateMRNips({ nip: session.nip, role: session.role as Role } as User);
  return getOutletsForMrSubtree(mrNips);
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
