/**
 * Outlet and product lookup abstraction.
 * Both mock and production paths use prisma — the mock client transparently
 * serves in-memory / generated-data.json data when USE_MOCK_DB=true.
 */

import type { MockCustomer } from "./mock/data";
import type { Role, User } from "@prisma/client";
import type { Product } from "./hargaST";
import { nexusAuthHeaders } from "@/lib/nexusAuth";
import { getLiveProductPricing } from "@/lib/exodusApi";

export type { MockCustomer as Customer };

// Product/hargaST live in ./hargaST (client-safe, no prisma import) — see
// that file's doc comment. Re-exported here so existing server-side callers
// of `@/lib/masterData` keep working unchanged.
export type { Product } from "./hargaST";
export { hargaST, formatKategoriLabel } from "./hargaST";

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
  // Additionally, for managers simulating MR or territory planning (Option B),
  // include outlets assigned to subordinate MRs in their subtree.
  if (user?.role && user.role !== "MR") {
    const covered = await prisma.outlet.findMany({
      where: { coveredByNip: userId, coveredByRole: { not: "MR" } },
    });
    const { getSubordinateMRNips } = await import("@/lib/authz");
    const mrNips = await getSubordinateMRNips(user as any);
    const subtreeOutlets = await getOutletsForMrSubtree(mrNips);

    const seen = new Set<string>();
    const out: MockCustomer[] = [];
    for (const o of [...fromAssignments, ...covered.map(toMockCustomer), ...subtreeOutlets]) {
      if (o.id && !seen.has(o.id)) {
        seen.add(o.id);
        out.push(o);
      }
    }
    return out;
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

// Overrides hna/nilaiRPersen with the live Exodus API figure when available
// (2026-08-26: API is now the source for these two fields specifically —
// see getLiveProductPricing's doc comment). Falls back to whatever's
// already on the row when the API has no entry for this kodeProduk or is
// unreachable/unconfigured — every other field always comes from the row
// itself, since the API has no equivalent for them.
function applyLivePricing<T extends { kodeProduk: string; hna: string; nilaiRPersen: string | null }>(
  rows: T[],
  live: Map<string, { hna: number; nilaiRPersen: number | null }> | null
): T[] {
  if (!live) return rows;
  return rows.map((r) => {
    const p = live.get(r.kodeProduk);
    if (!p) return r;
    return { ...r, hna: String(p.hna), nilaiRPersen: p.nilaiRPersen != null ? String(p.nilaiRPersen) : null };
  });
}

export async function getProducts(): Promise<Product[]> {
  const { prisma } = await import("@/lib/prisma");
  const [rows, live] = await Promise.all([
    prisma.product.findMany({ where: { hna: { gt: 0 }, namaGroupBrand: { not: "—" }, nilaiRPersen: { not: null } }, orderBy: { namaProduk: "asc" } }),
    getLiveProductPricing(),
  ]);
  return applyLivePricing(rows.map((p: any) => ({
    ...p,
    hna: p.hna.toString(),
    nilaiRPersen: p.nilaiRPersen?.toString() ?? null,
    satuanTerkecil: p.satuanTerkecil,
    konversiPembagi: p.konversiPembagi?.toString() ?? null,
    qtyPerRxPasien: p.qtyPerRxPasien?.toString() ?? null,
    jumlahPemberianPerHari: p.jumlahPemberianPerHari?.toString() ?? null,
  })), live);
}

export async function getScProducts(): Promise<Product[]> {
  const { prisma } = await import("@/lib/prisma");
  const [rows, live] = await Promise.all([
    prisma.product.findMany({ where: { hna: { gt: 0 }, namaGroupBrand: { not: "—" } }, orderBy: { namaProduk: "asc" } }),
    getLiveProductPricing(),
  ]);
  return applyLivePricing(rows.map((p: any) => ({
    ...p,
    hna: p.hna.toString(),
    nilaiRPersen: p.nilaiRPersen?.toString() ?? null,
    satuanTerkecil: p.satuanTerkecil,
    konversiPembagi: p.konversiPembagi?.toString() ?? null,
    qtyPerRxPasien: p.qtyPerRxPasien?.toString() ?? null,
    jumlahPemberianPerHari: p.jumlahPemberianPerHari?.toString() ?? null,
  })), live);
}

export async function getProductByKode(kodeProduk: string): Promise<Product | null> {
  const { prisma } = await import("@/lib/prisma");
  const [p, live] = await Promise.all([
    prisma.product.findUnique({ where: { kodeProduk } }),
    getLiveProductPricing(),
  ]);
  if (!p) return null;
  return applyLivePricing([{
    ...p,
    hna: p.hna.toString(),
    nilaiRPersen: p.nilaiRPersen?.toString() ?? null,
    satuanTerkecil: p.satuanTerkecil,
    konversiPembagi: p.konversiPembagi?.toString() ?? null,
    qtyPerRxPasien: p.qtyPerRxPasien?.toString() ?? null,
    jumlahPemberianPerHari: p.jumlahPemberianPerHari?.toString() ?? null,
  }], live)[0];
}

import { CANVASSER_API_BASE_URL, fetchWithTimeout } from "@/lib/canvasserApi";
import { getBlastInOutletSet } from "@/lib/outletBlastIn";
import { getApotekOnline } from "@/app/(app)/sc/[id]/_services/getApotekOnline";

function stripTestPrefix(nip: string): string {
  return nip.replace(/^test(?:psr|mr)?/i, "");
}

export async function getSalesCounterOutletsDirect(userId: string): Promise<MockCustomer[]> {
  let targetUserId = userId;
  if (userId === "SCMR123456") targetUserId = "P250091";
  else if (userId === "SCASM123456") targetUserId = "L260437";
  else if (userId === "SCSM123456") targetUserId = "P230219";
  else if (userId === "SCNSM123456") targetUserId = "P080855";
  else if (userId?.toLowerCase().startsWith("test")) targetUserId = stripTestPrefix(userId);

  const { prisma } = await import("@/lib/prisma");
  const user = await prisma.user.findUnique({
    where: { nip: userId },
    select: { role: true },
  });
  const position = user?.role || "MR";

  try {
    const [blastInSet, onlineCodes] = await Promise.all([
      getBlastInOutletSet(),
      getApotekOnline(targetUserId, position).catch(() => []),
    ]);
    const onlineSet = new Set(onlineCodes);

    const url = `${CANVASSER_API_BASE_URL}/api/get-sc-poa-outlet-by-nip?nip=${encodeURIComponent(targetUserId)}`;
    const res = await fetchWithTimeout(url, {
      next: { revalidate: 0 },
    }, 5000);
    if (!res.ok) {
      const fallback = await getOutletsByUser(userId);
      return fallback.map((o) => ({
        ...o,
        isBlastIn: blastInSet.has(o.kodeCust),
        isOnline: onlineSet.has(o.kodeCust),
      }));
    }
    const json = await res.json();
    const rawOutlets = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.data?.outlets)
      ? json.data.outlets
      : [];
    if (!Array.isArray(rawOutlets) || rawOutlets.length === 0) {
      const fallback = await getOutletsByUser(userId);
      return fallback.map((o) => ({
        ...o,
        isBlastIn: blastInSet.has(o.kodeCust),
        isOnline: onlineSet.has(o.kodeCust),
      }));
    }

    return rawOutlets.map((o: any) => ({
      kodeRequest: o.code,
      kodeCust: o.code,
      namaCust: o.name,
      role: o.sector ?? o.sektor ?? "",
      spesialisasi: "",
      historisPSSP: null,
      kodePI: o.code,
      namaOutlet: o.name,
      groupRS: null,
      sector: o.sector ?? o.sektor ?? null,
      subSektor: o.subsector ?? null,
      is_sc: !!o.is_sc,
      jumlah_sc: typeof o.jumlah_sc === "number" ? o.jumlah_sc : o.jumlah_sc ? Number(o.jumlah_sc) : null,
      isBlastIn: blastInSet.has(o.code),
      isOnline: onlineSet.has(o.code),
      created: o.created ?? null,
      jumlah_karyawan: typeof o.jumlah_karyawan === "number" ? o.jumlah_karyawan : o.jumlah_karyawan ? Number(o.jumlah_karyawan) : (typeof o.jumlahKaryawan === "number" ? o.jumlahKaryawan : o.jumlahKaryawan ? Number(o.jumlahKaryawan) : (typeof o.karyawan === "number" ? o.karyawan : o.karyawan ? Number(o.karyawan) : null)),
      jumlah_pasien: typeof o.jumlah_pasien === "number" ? o.jumlah_pasien : o.jumlah_pasien ? Number(o.jumlah_pasien) : (typeof o.jumlahPasien === "number" ? o.jumlahPasien : o.jumlahPasien ? Number(o.jumlahPasien) : (typeof o.pasien === "number" ? o.pasien : o.pasien ? Number(o.pasien) : null)),
      jumlah_pasien_resep: typeof o.jumlah_pasien_resep === "number" ? o.jumlah_pasien_resep : o.jumlah_pasien_resep ? Number(o.jumlah_pasien_resep) : (typeof o.jumlahPasienResep === "number" ? o.jumlahPasienResep : o.jumlahPasienResep ? Number(o.jumlahPasienResep) : (typeof o.resep === "number" ? o.resep : o.resep ? Number(o.resep) : null)),
      jumlah_pasien_non_resep: typeof o.jumlah_pasien_non_resep === "number" ? o.jumlah_pasien_non_resep : o.jumlah_pasien_non_resep ? Number(o.jumlah_pasien_non_resep) : (typeof o.jumlahPasienNonResep === "number" ? o.jumlahPasienNonResep : o.jumlahPasienNonResep ? Number(o.jumlahPasienNonResep) : (typeof o.non_resep === "number" ? o.non_resep : o.non_resep ? Number(o.non_resep) : null)),
    }));
  } catch (error) {
    console.error("Error fetching outlets directly from Canvasser API:", error);
    return getOutletsByUser(userId);
  }
}
