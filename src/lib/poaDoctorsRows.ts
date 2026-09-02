/**
 * Shared row-building logic for /api/poa-doctors (list) and
 * /api/poa-doctors/[id] (detail by uidPoa) — both return the exact same
 * per-doctor shape, this module is the single source of truth for it so the
 * two routes can't drift. See docs/api-poa-doctors.md for the response
 * contract.
 */

import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { verifyBasicAuth } from "@/lib/apiBasicAuth";
import { computeActivePsspStats } from "@/lib/activePssp";
import { currentQuarter, quarterToMonths, quarterDateRange } from "@/lib/quarterUtils";
import { expandPeriodeMonths } from "@/lib/poaUtils";
import { getActivePsspByOutlets, type ActivePsspRow } from "@/app/actions/customer";
import { getLiveProductPricing } from "@/lib/exodusApi";

/**
 * Shared auth gate for every /api/poa-doctors* route: session cookie (app's
 * own browser calls) OR HTTP Basic Auth (external callers, e.g. Exodus) —
 * either is sufficient. See apiBasicAuth.ts for the credential source.
 */
export async function isAuthorizedPoaDoctorsRequest(req: NextRequest): Promise<boolean> {
  const session = await getCurrentUser();
  if (session) return true;
  const credential = await prisma.poaDoctorsApiCredential.findUnique({ where: { id: 1 } });
  return verifyBasicAuth(req, credential);
}

export const poaDoctorRowsSelect = {
  id: true,
  seq: true,
  period: true,
  status: true,
  ownerId: true,
  items: {
    select: {
      id: true,
      kodeCust: true,
      namaCust: true,
      spesialisasi: true,
      kodePI: true,
      namaOutlet: true,
      kodeProduk: true,
      namaProduk: true,
      rencanaTotalBiaya: true,
      persenPsspDokter: true,
      pengaliNilaiR: true,
      periodeAwal: true,
      lamaPeriode: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
  doctorApprovals: {
    select: { kodePI: true, namaCust: true, status: true, usedInExodus: true },
  },
} satisfies Prisma.PoaFormSelect;

export type PoaWithDoctorRows = Prisma.PoaFormGetPayload<{ select: typeof poaDoctorRowsSelect }>;
type Item = PoaWithDoctorRows["items"][number];
type DoctorApproval = PoaWithDoctorRows["doctorApprovals"][number];

function doctorKey(item: { kodePI: string | null; namaCust: string }): string {
  return `${item.kodePI ?? ""}|${item.namaCust}`;
}

// "POA0001" — global, never-reset sequence (PoaForm.seq). padStart(4) is a
// display minimum, not a hard cap — seq 12345 just prints "POA12345".
export function formatPoaId(seq: number): string {
  return `POA${String(seq).padStart(4, "0")}`;
}

// Highest role that has actually approved this doctor so far, derived from
// its current PoaStatus (2026-08-24 revision: exodus needs "who last
// approved" not our internal status). SUBMITTED_TO_X means the level below X
// already approved, so it maps to that lower level too. null = never
// approved this cycle (DRAFT/SUBMITTED_TO_ASM/REVISI) — caller drops these.
function approveUntil(status: string): "ASM" | "SM" | "NSM" | null {
  switch (status) {
    case "APPROVED_BY_ASM":
    case "SUBMITTED_TO_SM":
      return "ASM";
    case "APPROVED_BY_SM":
    case "SUBMITTED_TO_NSM":
      return "SM";
    case "APPROVED_BY_NSM":
      return "NSM";
    default:
      return null;
  }
}

const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

// Mirrors computeItemValues() in /api/poa/[id]/export/route.ts — estimasi =
// rencanaTotalBiaya as-is, nilai PSSP = rencanaTotalBiaya × %PSSP × pengali
// nilai R (pengaliNilaiR defaults to 1 when null, same convention used
// everywhere else this field is read).
function computeEstimasiNilaiPssp(item: { rencanaTotalBiaya: unknown; persenPsspDokter: unknown; pengaliNilaiR: unknown }) {
  const estimasi = toNum(item.rencanaTotalBiaya);
  const pengaliNilaiR = item.pengaliNilaiR != null ? toNum(item.pengaliNilaiR) : 1;
  const nilaiPssp = estimasi * toNum(item.persenPsspDokter) * pengaliNilaiR;
  return { estimasi, nilaiPssp };
}

// Qty per calendar month in `quarterMonths`, for one line item — value
// (rencanaTotalBiaya) spread evenly across the item's own periodeAwal..
// periodeAwal+lamaPeriode-1 months (same "rata rata" apportionment as
// computeMonthlyBreakdown in poaUtils.ts), then divided by that product's
// HNA (confirmed formula, 2026-08-27: qty = estimasi ÷ HNA). Months outside
// the item's own period, or where HNA is unknown/zero, get 0.
function computeQtyPerBulan(
  rencanaTotalBiaya: unknown,
  periodeAwal: string | null,
  lamaPeriode: number | null,
  hna: number | null,
  quarterMonths: string[]
): Map<string, number> {
  const result = new Map<string, number>(quarterMonths.map((m) => [m, 0]));
  if (!periodeAwal || !lamaPeriode || lamaPeriode <= 0 || !hna) return result;

  const itemMonths = expandPeriodeMonths(periodeAwal, lamaPeriode);
  const estimasiPerBulan = toNum(rencanaTotalBiaya) / itemMonths.length;
  const qtyPerBulan = estimasiPerBulan / hna;
  for (const m of quarterMonths) {
    if (itemMonths.includes(m)) result.set(m, qtyPerBulan);
  }
  return result;
}

export type PoaDoctorRow = ReturnType<typeof buildDoctorRows>[number];

export interface ProductMaster {
  hna: number;
  /** Raw Rupiah "Nilai R" (Exodus API's r_value) — an amount, not a ratio. */
  nilaiR: number | null;
  exodusProductId: number | null;
  principalId: number | null;
  principalName: string | null;
  principalCode: string | null;
  categoryProduct: string | null;
}

/**
 * Batch-fetch Product master data (HNA, Nilai R in Rupiah) for every
 * kodeProduk referenced by these items.
 *
 * Nilai R here is the RAW Rupiah amount (Exodus core products API's
 * `r_value`, live — see getLiveProductPricing in exodusApi.ts), not the
 * `nilaiRPersen` ratio (`r_value / sell_price`) the app's UI displays as a
 * percentage. Live-first, same "override DB row with live API figure when
 * available" pattern applyLivePricing (masterData.ts) already uses for
 * these two fields — Product.hna/nilaiRPersen in the DB can be stale
 * Excel-import data otherwise. When live data isn't available for a
 * kodeProduk (API down/unconfigured, or that product missing from the live
 * list), Nilai R is reconstructed from the DB row instead: `nilaiRPersen ×
 * hna` — mathematically the same value, since nilaiRPersen was itself
 * derived as `r_value / hna` at import time (scripts/syncNilaiR.ts,
 * scripts/importProductR.ts).
 *
 * PoaLineItem also has its own `nilaiR` column, but it's dead: no create/
 * update/sync path in this codebase ever writes it (confirmed 2026-08-27,
 * 0 non-null rows out of 7090 in production). Do not read from it.
 */
export async function getProductMasterByKodeProduk(items: { kodeProduk: string }[]): Promise<Map<string, ProductMaster>> {
  const kodeProduks = Array.from(new Set(items.map((it) => it.kodeProduk)));
  if (kodeProduks.length === 0) return new Map();

  const [products, live] = await Promise.all([
    prisma.product.findMany({
      where: { kodeProduk: { in: kodeProduks } },
      select: {
        kodeProduk: true, hna: true, nilaiRPersen: true,
        exodusProductId: true, principalId: true, principalName: true, principalCode: true, categoryProduct: true,
      },
    }),
    getLiveProductPricing(),
  ]);

  // Write-through: persist principal/category onto Product whenever this
  // request's live fetch resolved them, so the DB stays populated for
  // callers that only read the DB row (no dedicated import script exists
  // for these fields — see schema.prisma comment on Product).
  type ProductRow = (typeof products)[number];

  if (live) {
    await Promise.all(
      products.map((p: ProductRow) => {
        const l = live.get(p.kodeProduk);
        if (!l || l.principalId == null) return null;
        return prisma.product.update({
          where: { kodeProduk: p.kodeProduk },
          data: {
            exodusProductId: l.exodusProductId,
            principalId: l.principalId,
            principalName: l.principalName,
            principalCode: l.principalCode,
            categoryProduct: l.categoryProduct,
          },
        }).catch(() => null);
      })
    );
  }

  return new Map(
    products.map((p: ProductRow) => {
      const livePricing = live?.get(p.kodeProduk) ?? null;
      const hna = livePricing?.hna ?? toNum(p.hna);
      const nilaiRPersenDb = p.nilaiRPersen != null ? toNum(p.nilaiRPersen) : null;
      const nilaiR = livePricing?.rValue ?? (nilaiRPersenDb != null ? nilaiRPersenDb * hna : null);
      return [p.kodeProduk, {
        hna,
        nilaiR,
        exodusProductId: livePricing?.exodusProductId ?? p.exodusProductId,
        principalId: livePricing?.principalId ?? p.principalId,
        principalName: livePricing?.principalName ?? p.principalName,
        principalCode: livePricing?.principalCode ?? p.principalCode,
        categoryProduct: livePricing?.categoryProduct ?? p.categoryProduct,
      }];
    })
  );
}

/**
 * Customer.customerCodeExodus for a batch of kodeCust — DB-only read, no live
 * Exodus call here. The source call (core/v1/customers/users/{nip}) is
 * PER-NIP, so resolving it live per doctor row would mean one external call
 * per distinct PoaForm owner on the company-wide (no `?nip=`) path —
 * docs/PERFORMANCE.md §2.4 forbids that query/call-in-loop pattern. Backfilled
 * instead by scripts/syncCustomerCodeExodus.ts (batch, per-active-MR loop).
 */
export async function getCustomerCodeExodusByKodeCust(kodeCusts: string[]): Promise<Map<string, string | null>> {
  const codes = Array.from(new Set(kodeCusts));
  if (codes.length === 0) return new Map();
  const customers = await prisma.customer.findMany({
    where: { kodeCustomer: { in: codes } },
    select: { kodeCustomer: true, customerCodeExodus: true },
  });
  type CustomerRow = (typeof customers)[number];
  return new Map(
    customers
      .filter((c: CustomerRow) => !!c.kodeCustomer)
      .map((c: CustomerRow) => [c.kodeCustomer as string, c.customerCodeExodus])
  );
}

/**
 * Resolves one doctor row by `uidPoa` (PoaLineItem.id, the per-row anchor
 * item) — shared by
 * GET /api/poa-doctors/[id] and PATCH /api/poa-doctors/[id] so both apply
 * the exact same "current quarter + fully (NSM) approved" visibility rule
 * (a row invisible to GET must also be unreachable via PATCH). Deliberately
 * does NOT filter on usedInExodus — PATCH must still be able to find an
 * already-used row so it stays idempotent (see route.ts).
 */
export async function findDoctorRowById(id: string): Promise<PoaDoctorRow | null> {
  const item = await prisma.poaLineItem.findUnique({ where: { id }, select: { poaId: true } });
  if (!item) return null;

  const quarter = currentQuarter();
  const poa: PoaWithDoctorRows | null = await prisma.poaForm.findFirst({
    where: { id: item.poaId, period: quarter },
    select: poaDoctorRowsSelect,
  });
  if (!poa) return null;

  const outletKodes = Array.from(new Set(poa.items.map((it) => it.kodePI).filter((k): k is string => !!k)));
  const kodeCusts = Array.from(new Set(poa.items.map((it) => it.kodeCust).filter((k): k is string => !!k)));
  const [activePsspRows, productMasterByKodeProduk, customerCodeExodusByKodeCust] = await Promise.all([
    outletKodes.length > 0 ? getActivePsspByOutlets(outletKodes) : Promise.resolve([]),
    getProductMasterByKodeProduk(poa.items),
    getCustomerCodeExodusByKodeCust(kodeCusts),
  ]);

  return buildDoctorRows(poa, activePsspRows, quarterToMonths(quarter), productMasterByKodeProduk, customerCodeExodusByKodeCust).find((r) => r.uidPoa === id) ?? null;
}

/** All doctor rows for one PoaForm — same grouping/filtering the list endpoint uses. */
export function buildDoctorRows(
  poa: PoaWithDoctorRows,
  activePsspRows: ActivePsspRow[],
  quarterMonths: string[],
  productMasterByKodeProduk: Map<string, ProductMaster>,
  customerCodeExodusByKodeCust: Map<string, string | null> = new Map()
) {
  type Produk = {
    kodeProduk: string;
    namaProduk: string;
    estimasi: number;
    nilaiPssp: number;
    pengaliNilaiR: number;
    nilaiR: number | null;
    hna: number | null;
    qtyPerBulan: Map<string, number>;
    productId: number | null;
    principalId: number | null;
    principalName: string | null;
    principalCode: string | null;
    categoryProduct: string | null;
  };
  type Doctor = {
    // First line item id encountered for this doctor — same "anchor item"
    // concept /poa/[id]/doctor/[itemId]/edit uses (it re-queries every row
    // sharing kodePI+namaCust, so any one of the doctor's item ids works).
    anchorItemId: string;
    kodeCust: string | null;
    namaCust: string;
    spesialisasi: string;
    kodePI: string | null;
    namaOutlet: string;
    produk: Produk[];
    estimasiTotal: number;
    nilaiPsspTotal: number;
  };
  const doctorMap = new Map<string, Doctor>();

  for (const item of poa.items as Item[]) {
    const key = doctorKey(item);
    let entry = doctorMap.get(key);
    if (!entry) {
      entry = {
        anchorItemId: item.id,
        kodeCust: item.kodeCust,
        namaCust: item.namaCust,
        spesialisasi: item.spesialisasi,
        kodePI: item.kodePI,
        namaOutlet: item.namaOutlet,
        produk: [],
        estimasiTotal: 0,
        nilaiPsspTotal: 0,
      };
      doctorMap.set(key, entry);
    }
    const { estimasi, nilaiPssp } = computeEstimasiNilaiPssp(item);
    const pengaliNilaiR = item.pengaliNilaiR != null ? toNum(item.pengaliNilaiR) : 1;
    const productMaster = productMasterByKodeProduk.get(item.kodeProduk);
    const nilaiR = productMaster?.nilaiR ?? null;
    const hna = productMaster?.hna ?? null;
    const qtyPerBulan = computeQtyPerBulan(item.rencanaTotalBiaya, item.periodeAwal, item.lamaPeriode, hna, quarterMonths);
    entry.estimasiTotal += estimasi;
    entry.nilaiPsspTotal += nilaiPssp;
    // One row per (doctor, produk) in practice, but guard against a
    // duplicate kodeProduk row the same way the produk-listing loop already
    // did — accumulate into the existing entry instead of adding a second
    // one. pengaliNilaiR/nilaiR/hna aren't summable, so the duplicate case
    // just keeps whichever value was seen first; qty IS summable (each row
    // contributes its own quantity), same as estimasi/nilaiPssp.
    const existingProduk = entry.produk.find((p) => p.kodeProduk === item.kodeProduk);
    if (existingProduk) {
      existingProduk.estimasi += estimasi;
      existingProduk.nilaiPssp += nilaiPssp;
      for (const [m, qty] of qtyPerBulan) {
        existingProduk.qtyPerBulan.set(m, (existingProduk.qtyPerBulan.get(m) ?? 0) + qty);
      }
    } else {
      entry.produk.push({
        kodeProduk: item.kodeProduk, namaProduk: item.namaProduk, estimasi, nilaiPssp, pengaliNilaiR, nilaiR, hna, qtyPerBulan,
        productId: productMaster?.exodusProductId ?? null,
        principalId: productMaster?.principalId ?? null,
        principalName: productMaster?.principalName ?? null,
        principalCode: productMaster?.principalCode ?? null,
        categoryProduct: productMaster?.categoryProduct ?? null,
      });
    }
  }

  // A doctor still sitting in DRAFT/REVISI within an otherwise in-flight
  // draft has no PoaDoctorApproval row yet (created lazily on submit) —
  // falls back to the PoaForm's own status, which is DRAFT in that case.
  const approvalByKey = new Map<string, DoctorApproval>(
    (poa.doctorApprovals as DoctorApproval[]).map((a) => [doctorKey(a), a])
  );

  const { startDate, endDate } = quarterDateRange(poa.period);

  return [...doctorMap.entries()].flatMap(([key, dokter]) => {
    const approval = approvalByKey.get(key);
    // docs/exodus-poa-usage/ (2026-08-27 revision): Exodus only wants FULLY
    // (NSM) approved doctors, not any partial ASM/SM approval — stricter
    // than approveUntil's own range of possible values.
    const until = approveUntil(approval?.status ?? poa.status);
    if (until !== "NSM") return [];

    const aktifStats = dokter.kodeCust && dokter.kodePI
      ? computeActivePsspStats(
          activePsspRows.filter((r) => r.kdOutlet === dokter.kodePI && r.kdCust === dokter.kodeCust),
          quarterMonths
        )
      : null;

    return [{
      // Per-row identifier (PoaLineItem anchor id) — was `uidCustomer`,
      // renamed to `uidPoa` 2026-09-02 (tim Exodus only needs a per-row id,
      // not the old per-draft PoaForm.id). PoaForm.id is kept internal-only
      // as `poaFormId` (stripped before the response — see route.ts) so
      // PATCH /api/poa-doctors/[id] can still resolve poaId_kodePI_namaCust.
      uidPoa: dokter.anchorItemId,
      poaFormId: poa.id,
      idPoa: formatPoaId(poa.seq),
      path: `/poa/${poa.id}/doctor/${dokter.anchorItemId}/edit`,
      periode: { startDate, endDate },
      approveUntil: until,
      usedInExodus: approval?.usedInExodus ?? false,
      dokter: {
        kodeCust: dokter.kodeCust,
        namaCust: dokter.namaCust,
        spesialisasi: dokter.spesialisasi,
        kodePI: dokter.kodePI,
        namaOutlet: dokter.namaOutlet,
        // outlet_id/customer_id (2026-09-02, tim Exodus request): just our
        // own kodePI/kodeCust under the names Exodus asked for — those ARE
        // the identifiers Exodus's own systems already key outlets/customers
        // by (outletSync.ts upserts Outlet.kodePI directly from Exodus's own
        // OutletCode), no separate Exodus id lookup needed.
        outletId: dokter.kodePI,
        customerId: dokter.kodeCust,
        customerCodeExodus: dokter.kodeCust ? customerCodeExodusByKodeCust.get(dokter.kodeCust) ?? null : null,
      },
      estimasi: dokter.estimasiTotal,
      nilaiPssp: dokter.nilaiPsspTotal,
      estimasiAktif: aktifStats?.estBarisTercacah ?? 0,
      nilaiPsspAktif: aktifStats?.nilaiTercacah ?? 0,
      produk: dokter.produk.map((p) => ({
        kodeProduk: p.kodeProduk,
        namaProduk: p.namaProduk,
        estimasi: p.estimasi,
        nilaiPssp: p.nilaiPssp,
        pengaliNilaiR: p.pengaliNilaiR,
        nilaiR: p.nilaiR, // Rupiah amount (Exodus r_value), not a ratio — see ProductMaster above
        hna: p.hna,
        qtyPerBulan: quarterMonths.map((bulan) => ({ bulan, qty: p.qtyPerBulan.get(bulan) ?? 0 })),
        qtyTotal: [...p.qtyPerBulan.values()].reduce((s, v) => s + v, 0),
        productId: p.productId,
        principalId: p.principalId,
        principalName: p.principalName,
        principalCode: p.principalCode,
        categoryProduct: p.categoryProduct,
      })),
    }];
  });
}
