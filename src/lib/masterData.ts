/**
 * Outlet and product lookup abstraction.
 * Both mock and production paths use prisma — the mock client transparently
 * serves in-memory / generated-data.json data when USE_MOCK_DB=true.
 */

import type { MockCustomer } from "./mock/data";
import type { Role, User } from "@prisma/client";
import type { Product } from "./hargaST";
import { nexusAuthHeaders } from "@/lib/nexusAuth";

export type { MockCustomer as Customer };

// Product/hargaST live in ./hargaST (client-safe, no prisma import) — see
// that file's doc comment. Re-exported here so existing server-side callers
// of `@/lib/masterData` keep working unchanged.
export type { Product } from "./hargaST";
export { hargaST } from "./hargaST";

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
  return rows.map((p: any) => ({
    ...p,
    hna: p.hna.toString(),
    nilaiRPersen: p.nilaiRPersen?.toString() ?? null,
    satuanTerkecil: p.satuanTerkecil,
    konversiPembagi: p.konversiPembagi?.toString() ?? null,
    qtyPerRxPasien: p.qtyPerRxPasien?.toString() ?? null,
    jumlahPemberianPerHari: p.jumlahPemberianPerHari?.toString() ?? null,
  }));
}

export async function getScProducts(): Promise<Product[]> {
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.product.findMany({ where: { hna: { gt: 0 }, namaGroupBrand: { not: "—" } }, orderBy: { namaProduk: "asc" } });
  return rows.map((p: any) => ({
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

export async function getSalesCounterOutletsDirect(userId: string): Promise<MockCustomer[]> {
  let targetUserId = userId;
  if (userId === "SCMR123456") targetUserId = "P250091";

  try {
    const auth = Buffer.from("poa_exodus:poA_3x0dus").toString("base64");
    const res = await fetch(`https://api-nexus.pharos.id/api/r/poa/get_outlet_by_nip?nip=${encodeURIComponent(targetUserId)}`, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      console.error(`Failed to fetch outlets from Nexus: ${res.status} ${res.statusText}`);
      return getOutletsByUser(userId);
    }
    const json = await res.json();
    const outlets = json?.data?.outlets;
    if (!Array.isArray(outlets)) {
      return getOutletsByUser(userId);
    }
    return outlets.map((o: any) => ({
      kodeRequest: o.code,
      kodeCust: o.code,
      namaCust: o.name,
      role: o.sector ?? "",
      spesialisasi: "",
      historisPSSP: null,
      kodePI: o.code,
      namaOutlet: o.name,
      groupRS: null,
    }));
  } catch (error) {
    console.error("Error fetching outlets directly from Nexus:", error);
    return getOutletsByUser(userId);
  }
}
