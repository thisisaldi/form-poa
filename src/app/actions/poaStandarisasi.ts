"use server";

/**
 * POA Standarisasi — server actions. See docs/poa-standarisasi/ for the spec
 * this implements (business rules, data model, role/access). Produk × Outlet
 * sub-form, wizard 5-phase: Planning Standarisasi → Approval Atasan →
 * Approval User/Dokter → Menunggu Meeting KFT → Finalisasi. All estimasi
 * fields are PER BULAN (resolved Q4, docs/poa-standarisasi/01-business-rules.md
 * §7) — never multiplied by periodeBulan here.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isWriteBlocked, WRITE_BLOCKED_MESSAGE } from "@/lib/maintenance";
import { canCreatePoa, canViewPoaStandarisasi, canEditPoaStandarisasi, canEditPoaStandarisasiStep5, canApprovePoaStandarisasiAtasan } from "@/lib/authz";
import { hargaST } from "@/lib/masterData";
import type { Product as ProductLite } from "@/lib/masterData";
import { getDiscountsForOutlet, type ExodusDiscountPct } from "@/lib/exodusApi";
import { getSurveyRekomendasiInfo, getCustomersByOutlet, getDiskonByOutlet } from "@/app/actions/customer";
import { uploadFileToPoaStandarisasiDrive, isGoogleDriveConfigured, describeGoogleDriveConfig } from "@/lib/googleDrive";
import { POA_STANDARISASI_UPLOAD_DISABLED, POA_STANDARISASI_UPLOAD_DISABLED_MESSAGE } from "@/lib/poaStandarisasiUploadFlag";
import type { Product as PrismaProduct, Prisma } from "@prisma/client";

async function requireSession() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (await isWriteBlocked(session.role)) throw new Error(WRITE_BLOCKED_MESSAGE);
  return session;
}

/** authz.ts's canX() helpers take a full Prisma `User` row (not SessionData) — same pattern as poa.ts's `actor`. */
async function requireActor() {
  const session = await requireSession();
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  return { session, actor };
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Creates the pengajuan AND saves the full Planning Standarisasi payload in one
 * shot (outlet, KPDM, jabatan, tipe, produk, dokter klinis) — the "new" form is
 * literally the same Planning Standarisasi form as Phase 1 of the wizard, not a
 * separate outlet-only pre-step (2026-08-19 redesign).
 */
export async function createPoaStandarisasiAction(input: PlanningInput & { kodePI: string }): Promise<void> {
  const session = await requireSession();
  // Re-opened to MR 2026-09-10 (user request) — see poa-standarisasi/new/
  // page.tsx's note. Hard gate here too (not just the page), since this
  // action can be called directly.
  if (session.role !== "ADMIN" && session.role !== "MR") redirect("/dashboard");

  const kodePI = input.kodePI.trim();
  if (!kodePI) throw new Error("Outlet wajib dipilih.");

  // Same eligibility as POA Estimasi (MR with an assignment, or ASM/SM/NSM
  // covering a vacant-team outlet) — resolved Q3, docs/poa-standarisasi/01-business-rules.md §7.
  if (!(await canCreatePoa(session.userId))) redirect("/dashboard?error=no_outlets");

  const outlet = await prisma.outlet.findUnique({ where: { kodePI } });
  if (!outlet) throw new Error("Outlet tidak ditemukan.");

  validatePlanningInput(input);
  // The "new" form already collects produk + dokter user (same fields as Phase
  // 1), so a fresh pengajuan created here goes straight to Phase 2 instead of
  // landing back on Phase 1 requiring a second, separate "Lanjut" click.
  validateReadyForApprovalAtasan(input);

  const dplKode = new Set((await getActiveDplByOutletAction(kodePI)).map((d) => d.kodeProduk));
  const pengajuanId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const pengajuan = await tx.poaStandarisasi.create({
      data: {
        ownerId: session.userId,
        kodePI,
        tipeStandarisasi: input.tipeStandarisasi,
        periodeBulan: input.tipeStandarisasi === "PERMANEN" ? null : toNum(input.periodeBulan),
        jumlahBedRs: toNum(input.jumlahBedRs) ?? outlet.jumlahBed,
        estimasiTimelineSelesai: input.estimasiTimelineSelesai ? new Date(input.estimasiTimelineSelesai) : null,
        currentPhase: "APPROVAL_ATASAN",
      },
    });
    await applyPlanningKpdm(tx, pengajuan.id, input.kpdmList);
    await applyPlanningProduk(tx, pengajuan.id, kodePI, input.produk, dplKode);
    return pengajuan.id;
  });

  redirect(`/poa-standarisasi/${pengajuanId}`);
}

// ─── Read ────────────────────────────────────────────────────────────────────

const detailInclude = {
  outlet: true,
  kpdmList: { include: { customer: true }, orderBy: { createdAt: "asc" as const } },
  produk: {
    include: {
      product: true,
      dokterApproval: { include: { customer: true } },
      dokterUser: { include: { customer: true } },
      dokumen: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
  spNonSalesDocuments: { include: { uploadedBy: { select: { name: true } } }, orderBy: { uploadedAt: "desc" as const } },
};

type RawDetail = Prisma.PoaStandarisasiGetPayload<{ include: typeof detailInclude }>;

const d = (v: { toString(): string } | null | undefined): number | null => (v == null ? null : parseFloat(v.toString()));

/**
 * Prisma Decimal fields can't cross the Server→Client Component boundary as-is
 * — stringify/numberify everything before returning. `discounts` (live Exodus
 * principal_percentage + distributor_percentage per kodeProduk, see
 * getDiscountsForOutlet) is only a DEFAULT for finalDiscountPct/
 * diskonDistributorPct when the MR hasn't saved a value of their own yet —
 * Finalisasi stays fully editable, nothing here gets locked to the live
 * Exodus number (2026-09-09 user request, reverted the earlier "always
 * override with live value" behavior which silently discarded edits on the
 * next page load).
 */
function serializeDetail(p: RawDetail, discounts: Map<string, ExodusDiscountPct> | null) {
  return {
    ...p,
    outlet: { ...p.outlet },
    kpdmList: p.kpdmList.map((k) => ({
      ...k,
      entertainEstimasi: d(k.entertainEstimasi),
      entertainFinal: d(k.entertainFinal),
    })),
    produk: p.produk.map((prod) => ({
      ...prod,
      estimasiDiskonPct: d(prod.estimasiDiskonPct),
      estimasiDiskonDistributorPct: d(prod.estimasiDiskonDistributorPct),
      estimasiValueDpRp: d(prod.estimasiValueDpRp),
      estimasiBiayaListingRp: d(prod.estimasiBiayaListingRp),
      finalDiscountPct: d(prod.finalDiscountPct) ?? discounts?.get(prod.product.kodeProduk)?.principalPct ?? null,
      diskonDistributorPct: d(prod.diskonDistributorPct) ?? discounts?.get(prod.product.kodeProduk)?.distributorPct ?? null,
      finalBiayaListingRp: d(prod.finalBiayaListingRp),
      finalValueDpRp: d(prod.finalValueDpRp),
      spNonSalesJumlahBox: d(prod.spNonSalesJumlahBox),
      product: {
        ...prod.product,
        hna: prod.product.hna.toString(),
        nilaiRPersen: prod.product.nilaiRPersen?.toString() ?? null,
        konversiPembagi: prod.product.konversiPembagi?.toString() ?? null,
        qtyPerRxPasien: prod.product.qtyPerRxPasien?.toString() ?? null,
        jumlahPemberianPerHari: prod.product.jumlahPemberianPerHari?.toString() ?? null,
      },
      dokterApproval: prod.dokterApproval.map((da) => ({
        ...da,
        resepPerPasienSt: d(da.resepPerPasienSt),
        estimasiQtyPerBulan: d(da.estimasiQtyPerBulan),
        estimasiNilaiRpPerBulan: d(da.estimasiNilaiRpPerBulan),
        entertainRp: d(da.entertainRp),
      })),
      dokterUser: prod.dokterUser.map((du) => ({
        ...du,
        resepPerPasienSt: d(du.resepPerPasienSt),
        estimasiQtyPerBulan: d(du.estimasiQtyPerBulan),
        estimasiSalesRpPerBulan: d(du.estimasiSalesRpPerBulan),
        entertainRp: d(du.entertainRp),
      })),
      dokumen: prod.dokumen,
    })),
  };
}

export type PoaStandarisasiDetail = ReturnType<typeof serializeDetail>;

export async function getPoaStandarisasiDetail(id: string): Promise<PoaStandarisasiDetail | null> {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });

  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id }, include: detailInclude });
  if (!pengajuan) return null;
  if (!(await canViewPoaStandarisasi(actor, pengajuan))) return null;

  const discounts = await getDiscountsForOutlet(pengajuan.kodePI);
  return serializeDetail(pengajuan, discounts);
}

/**
 * Delete a pengajuan (2026-09-09 user request: "tambahin button hapus juga
 * di page /poa-standarisasi sama kayak yang poa estimasi"). Restricted to
 * Phase 1 (PLANNING) only — same DRAFT-only spirit as POA Estimasi's
 * deletePoaAction (poa.ts), before ASM/SM or any dokter has acted on it.
 * Every child row (produk, dokter, kpdm, dokumen, reassign logs) cascades
 * via `onDelete: Cascade` in schema.prisma — no manual cleanup needed here,
 * unlike PoaForm's separate poaAuditLog table.
 */
export async function deletePoaStandarisasiAction(id: string): Promise<{ error?: string }> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) return { error: "Pengajuan tidak ditemukan." };
  if (!canEditPoaStandarisasi(actor, pengajuan)) return { error: "Tidak punya akses." };
  if (pengajuan.currentPhase !== "PLANNING") return { error: "Hanya pengajuan di tahap Planning yang bisa dihapus." };

  await prisma.poaStandarisasi.delete({ where: { id } });
  revalidatePath("/poa-standarisasi");
  return {};
}

export async function listMyPoaStandarisasiAction() {
  const session = await requireSession();
  const rows = await prisma.poaStandarisasi.findMany({
    where: { ownerId: session.userId },
    include: {
      outlet: { select: { namaOutlet: true } },
      produk: {
        select: {
          id: true,
          product: { select: { namaProduk: true } },
          standarisasiGagal: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((p: (typeof rows)[number]) => ({
    ...p,
    produk: p.produk.map((prod: (typeof p.produk)[number]) => ({
      id: prod.id,
      namaProduk: prod.product.namaProduk,
      standarisasiGagal: prod.standarisasiGagal,
    })),
  }));
}

/**
 * POA Standarisasi pengajuan currently sitting in Phase 2 (Approval Atasan)
 * that THIS atasan (ASM/SM/NSM, or ADMIN for testing) can act on right now —
 * dedicated "tampilan atasan" (2026-09-10 user request), separate from the
 * MR-facing wizard at /poa-standarisasi/[id] which stays MR-only.
 *
 * Bounded scan, not company-wide: only pengajuan actively in
 * currentPhase=APPROVAL_ATASAN (a small, naturally-limited set — everything
 * else is either still Planning or already past this phase), so the
 * per-row canApprovePoaStandarisasiAtasan call (itself a couple of extra
 * queries via getPoaStandarisasiApprovers) doesn't hit docs/PERFORMANCE.md's
 * call-in-loop constraint the way an unbounded company-wide scan would.
 */
export async function getPendingPoaStandarisasiForAtasanAction() {
  const { actor } = await requireActor();

  const candidates = await prisma.poaStandarisasi.findMany({
    where: { currentPhase: "APPROVAL_ATASAN" },
    include: {
      owner: { select: { nip: true, name: true } },
      outlet: { select: { namaOutlet: true } },
      produk: { select: { id: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  const result: (typeof candidates[number] & { pendingLevel: "ASM" | "SM" | "NSM" })[] = [];
  for (const p of candidates) {
    // Sequential chain (ASM -> SM -> NSM): the level still awaiting action is
    // the first one not yet DISETUJUI — same rule approvePoaStandarisasiAtasanAction
    // enforces when advancing to Phase 3.
    const pendingLevel: "ASM" | "SM" | "NSM" =
      p.statusApprovalAsm !== "DISETUJUI" ? "ASM" : p.statusApprovalSm !== "DISETUJUI" ? "SM" : "NSM";
    if (await canApprovePoaStandarisasiAtasan(actor, p, pendingLevel)) {
      result.push({ ...p, pendingLevel });
    }
  }
  return result;
}

/** "Golongan yang Dipakai Saat Ini" per dokter — resolved Q1, reuses the exact
 * function backing "Produk Kompetitor Utama" in the POA Estimasi form. */
export async function getGolonganSaatIniAction(kodeCustomer: string, kodePI: string, kodeProduk: string) {
  return getSurveyRekomendasiInfo(kodeCustomer, kodePI, kodeProduk);
}

export async function getDokterOptionsAction(kodePI: string) {
  return getCustomersByOutlet(kodePI);
}

/**
 * Live Exodus discount (principal_percentage + distributor_percentage),
 * keyed by kodeProduk, for pre-filling Planning's "Estimasi Diskon (PI)" and
 * "Estimasi Diskon Distributor" so an MR doesn't start from a blank field and
 * can immediately see/adjust the margin math (2026-08-28 user request for PI,
 * extended to distributor 2026-09-07) — same source as Finalisasi's
 * read-only Discount Final / Diskon Distributor (`getDiscountsForOutlet`),
 * but here it's just a DEFAULT: both fields stay editable, the caller only
 * applies this when the row's own value is still empty (never overwrites
 * what the MR already typed/saved).
 */
export async function getEstimasiDiskonPreviewAction(kodePI: string): Promise<Record<string, ExodusDiscountPct>> {
  if (!kodePI) return {};
  const discounts = await getDiscountsForOutlet(kodePI);
  if (!discounts) return {};
  return Object.fromEntries(discounts);
}

/**
 * Baseline for the "estimasi diskon" margin warning (2026-08-28, replaces a
 * flat "diskon% > 20%" cap that compared the NEW discount straight to a
 * constant with no historical basis — user-confirmed correct formula):
 * warn when the NEW proposed discount cost (this outlet+produk's new
 * estimated sales × new diskon%) exceeds the historical margin budget (this
 * outlet+produk's 12-month sales history × 20%, the company's target gross
 * margin). Only returns an entry — i.e. only shows the warning at all — for
 * a kodeProduk that currently HAS a live Exodus discount request; existence
 * is the gate, the live discount's own rate isn't used in the math.
 */
export async function getMarginWarningBaselineAction(kodePI: string, kodeProdukList: string[]): Promise<Record<string, number>> {
  if (!kodePI || kodeProdukList.length === 0) return {};
  const discounts = await getDiscountsForOutlet(kodePI);
  if (!discounts) return {};
  const salesRows = await prisma.outletSalesHistory.findMany({
    where: { kodePI, itemKode: { in: kodeProdukList } },
    select: { itemKode: true, totalSales12Bln: true },
  });
  const salesByKode = new Map<string, number>(salesRows.map((r: (typeof salesRows)[number]) => [r.itemKode, parseFloat(r.totalSales12Bln.toString())]));
  const result: Record<string, number> = {};
  for (const kodeProduk of kodeProdukList) {
    if (discounts.has(kodeProduk)) result[kodeProduk] = salesByKode.get(kodeProduk) ?? 0;
  }
  return result;
}

export interface StandarisasiDataForDokterProduk {
  jumlahPasien: number | null;
  jumlahHariPraktekPerBulan: number | null;
  resepPerPasienSt: number | null;
}

/**
 * "Tarik Data POA Standarisasi" toggle in POA Estimasi (2026-09-08, atasan
 * redline) — lets an MR pull Pasien Baru/Hari + Jml Produk ST/Pasien Baru
 * straight from a POA Standarisasi Finalisasi row for the SAME outlet +
 * dokter + produk, instead of retyping numbers already entered there. Only
 * returns a match when that pengajuan has actually reached Finalisasi
 * (`currentPhase === "FINALISASI"`, which also covers post-submit/Step 5 —
 * this app never advances currentPhase past FINALISASI) — a match earlier in
 * the flow (still Planning/Approval) isn't final enough to trust yet.
 * "Hari Praktek" (`jumlahHariPraktekPerBulan`) is included since 2026-09-09 —
 * POA Standarisasi didn't have that field yet when this toggle was first
 * built (2026-09-08), so it originally only pulled Pasien/Resep.
 */
export async function getStandarisasiDataForDokterProdukAction(
  kodePI: string,
  kodeCustomer: string,
  kodeProduk: string
): Promise<StandarisasiDataForDokterProduk | null> {
  if (!kodePI || !kodeCustomer || !kodeProduk) return null;
  const row = await prisma.poaStandarisasiDokterUser.findFirst({
    where: {
      customer: { kodeCustomer },
      produk: { kodeProduk, pengajuan: { kodePI, currentPhase: "FINALISASI" } },
    },
    orderBy: { createdAt: "desc" },
    select: { jumlahPasien: true, jumlahHariPraktekPerBulan: true, resepPerPasienSt: true },
  });
  if (!row) return null;
  return {
    jumlahPasien: row.jumlahPasien,
    jumlahHariPraktekPerBulan: row.jumlahHariPraktekPerBulan,
    resepPerPasienSt: row.resepPerPasienSt != null ? parseFloat(row.resepPerPasienSt.toString()) : null,
  };
}

export interface StandarisasiProdukForDokter extends StandarisasiDataForDokterProduk {
  kodeProduk: string;
}

/**
 * Semua produk di POA Standarisasi (Finalisasi) untuk outlet + dokter ini —
 * dipakai toggle "Tarik Data POA Standarisasi" di POA Estimasi buat auto-isi
 * daftar produknya sekaligus (bukan cuma angka per produk yang sudah dipilih
 * manual). Satu baris per produk, pengajuan terbaru menang.
 */
export async function getStandarisasiProdukForDokterAction(kodePI: string, kodeCustomer: string): Promise<StandarisasiProdukForDokter[]> {
  if (!kodePI || !kodeCustomer) return [];
  const rows = await prisma.poaStandarisasiDokterUser.findMany({
    where: { customer: { kodeCustomer }, produk: { pengajuan: { kodePI, currentPhase: "FINALISASI" } } },
    orderBy: { createdAt: "desc" },
    select: { jumlahPasien: true, jumlahHariPraktekPerBulan: true, resepPerPasienSt: true, produk: { select: { kodeProduk: true } } },
  });
  const byKode = new Map<string, StandarisasiProdukForDokter>();
  for (const r of rows) {
    if (byKode.has(r.produk.kodeProduk)) continue;
    byKode.set(r.produk.kodeProduk, {
      kodeProduk: r.produk.kodeProduk,
      jumlahPasien: r.jumlahPasien,
      jumlahHariPraktekPerBulan: r.jumlahHariPraktekPerBulan,
      resepPerPasienSt: r.resepPerPasienSt != null ? parseFloat(r.resepPerPasienSt.toString()) : null,
    });
  }
  return Array.from(byKode.values());
}

/**
 * Kode produk yang sedang dalam proses POA Standarisasi di outlet ini —
 * pengajuan sudah dibuat tapi belum disubmit (`submittedAt` null). Dipakai POA
 * Estimasi buat auto-set Status Standarisasi = "Proses Pengajuan".
 */
export async function getStandarisasiProsesKodeByOutletAction(kodePI: string): Promise<string[]> {
  if (!kodePI) return [];
  const rows = await prisma.poaStandarisasiProduk.findMany({
    where: { pengajuan: { kodePI, submittedAt: null } },
    select: { kodeProduk: true },
    distinct: ["kodeProduk"],
  });
  return rows.map((r: (typeof rows)[number]) => r.kodeProduk);
}

export interface SalesHistoryOutletRow {
  kodeProduk: string;
  namaProduk: string;
  totalSales12Bln: number;
  periodeFrom: string; // YYYYMM
  periodeTo: string; // YYYYMM
}

/**
 * Widget "Historical Sales per Produk/Outlet" di sidebar Planning
 * (2026-09-08, user request) — flat 12-bulan rollup per produk untuk outlet
 * terpilih, sumber sama seperti getMarginWarningBaselineAction/
 * computeStatusPengajuanMap (`OutletSalesHistory`), tapi di sini ditampilkan
 * apa adanya (bukan cuma dipakai buat gate warning/status).
 */
export async function getSalesHistoryByOutletAction(kodePI: string): Promise<SalesHistoryOutletRow[]> {
  if (!kodePI) return [];
  const rows = await prisma.outletSalesHistory.findMany({ where: { kodePI }, orderBy: { totalSales12Bln: "desc" } });
  if (rows.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { kodeProduk: { in: rows.map((r: (typeof rows)[number]) => r.itemKode) } },
    select: { kodeProduk: true, namaProduk: true },
  });
  const namaByKode = new Map(products.map((p: (typeof products)[number]) => [p.kodeProduk, p.namaProduk]));
  return rows.map((r: (typeof rows)[number]) => ({
    kodeProduk: r.itemKode,
    namaProduk: namaByKode.get(r.itemKode) ?? r.itemKode,
    totalSales12Bln: parseFloat(r.totalSales12Bln.toString()),
    periodeFrom: r.periodeFrom,
    periodeTo: r.periodeTo,
  }));
}

export interface StandarisasiProdukOutletRow {
  kodeProduk: string;
  namaProduk: string;
  tipeStandarisasi: string;
  statusPengajuan: string;
  submittedAt: Date;
}

/**
 * Products already submitted (finalized) under POA Standarisasi at this
 * outlet — one row per produk, latest submission wins if resubmitted more
 * than once. Powers the "Sudah Standarisasi" sidebar tab so an MR doesn't
 * duplicate work already done for a product at this outlet (docs/TODO.md
 * #15). Excludes the pengajuan currently being edited (its own produk aren't
 * "already done" from its own point of view).
 */
export async function getStandarisasiProdukByOutletAction(kodePI: string, excludePengajuanId?: string): Promise<StandarisasiProdukOutletRow[]> {
  if (!kodePI) return [];
  const rows = await prisma.poaStandarisasiProduk.findMany({
    where: {
      pengajuan: {
        kodePI,
        submittedAt: { not: null },
        ...(excludePengajuanId ? { id: { not: excludePengajuanId } } : {}),
      },
    },
    select: {
      kodeProduk: true,
      statusPengajuan: true,
      product: { select: { namaProduk: true } },
      pengajuan: { select: { tipeStandarisasi: true, submittedAt: true } },
    },
    orderBy: { pengajuan: { submittedAt: "desc" } },
  });

  const byKode = new Map<string, StandarisasiProdukOutletRow>();
  for (const r of rows) {
    if (byKode.has(r.kodeProduk)) continue; // ordered submittedAt desc — first hit per kodeProduk is the latest
    byKode.set(r.kodeProduk, {
      kodeProduk: r.kodeProduk,
      namaProduk: r.product.namaProduk,
      tipeStandarisasi: r.pengajuan.tipeStandarisasi,
      statusPengajuan: r.statusPengajuan,
      submittedAt: r.pengajuan.submittedAt!,
    });
  }
  return Array.from(byKode.values());
}

// ─── Phase 1: Planning Standarisasi ─────────────────────────────────────────

export interface PlanningDokterKlinisInput {
  customerId: string;
  jumlahPasien: number | string | null;
  jumlahHariPraktekPerBulan: number | string | null;
  resepPerPasienSt: number | string | null;
  entertainRp: number | string | null;
}

export interface PlanningProdukInput {
  id?: string;
  kodeProduk: string;
  skemaPembayaran: "DISKON" | "DP";
  estimasiDiskonPct: number | string | null;
  estimasiDiskonDistributorPct: number | string | null;
  estimasiValueDpRp: number | string | null;
  estimasiBiayaListingRp: number | string | null;
  dokterKlinis: PlanningDokterKlinisInput[];
}

export interface PlanningKpdmInput {
  customerId: string;
  nama: string;
  jabatan: string | null;
  entertainEstimasi: number | string | null;
}

export interface PlanningInput {
  kpdmList: PlanningKpdmInput[];
  tipeStandarisasi: "PERIODIC" | "SISIPAN" | "PERMANEN";
  periodeBulan: number | string | null;
  jumlahBedRs: number | string | null;
  estimasiTimelineSelesai: string | null; // yyyy-mm-dd
  produk: PlanningProdukInput[];
}

function toProductLite(product: PrismaProduct): ProductLite {
  return {
    kodeProduk: product.kodeProduk,
    namaGroupBrand: product.namaGroupBrand,
    namaProduk: product.namaProduk,
    zatAktif: product.zatAktif,
    satuan: product.satuan,
    hna: product.hna.toString(),
    nilaiRPersen: product.nilaiRPersen?.toString() ?? null,
    satuanTerkecil: product.satuanTerkecil,
    konversiPembagi: product.konversiPembagi?.toString() ?? null,
    dosisKekuatanSediaan: product.dosisKekuatanSediaan,
    qtyPerRxPasien: product.qtyPerRxPasien?.toString() ?? null,
    lamaPemberianHari: product.lamaPemberianHari,
    jumlahPemberianPerHari: product.jumlahPemberianPerHari?.toString() ?? null,
    bentukSediaan: product.bentukSediaan,
    packing: product.packing,
    indikasi: product.indikasi,
    spesialisasiRekomendasi: product.spesialisasiRekomendasi,
  };
}

/**
 * estimasiQty/estimasiNilai are PER BULAN, never multiplied by periodeBulan
 * — resolved Q4. jumlahPasien is PER HARI (label UI "Jumlah Pasien / Hari",
 * 2026-09-09) — jumlahHariPraktekPerBulan is the new multiplier that turns it
 * into a monthly qty, see 01-business-rules.md §3.
 */
async function computeEstimasiPerBulan(
  kodeProduk: string,
  jumlahPasien: number | null,
  jumlahHariPraktekPerBulan: number | null,
  resepPerPasienSt: number | null
) {
  if (!jumlahPasien || !jumlahHariPraktekPerBulan || !resepPerPasienSt) return { estimasiQtyPerBulan: null, estimasiQtyUbPerBulan: null, estimasiNilaiRpPerBulan: null };
  const product = await prisma.product.findUnique({ where: { kodeProduk } });
  if (!product) return { estimasiQtyPerBulan: null, estimasiQtyUbPerBulan: null, estimasiNilaiRpPerBulan: null };
  const hst = hargaST(toProductLite(product));
  const qty = jumlahPasien * jumlahHariPraktekPerBulan * resepPerPasienSt;
  const konversi = Number(product.konversiPembagi ?? 1) || 1;
  return { estimasiQtyPerBulan: qty, estimasiQtyUbPerBulan: Math.ceil(qty / konversi), estimasiNilaiRpPerBulan: Math.round(qty * hst) };
}

/**
 * Kode produk yang punya DPL aktif di outlet ini — periode DPL (prdAwal..prdAkhir,
 * YYYYMM) mencakup bulan berjalan. DPL adalah output standarisasi, jadi ada DPL
 * aktif = produk sudah standarisasi (sinyal tambahan, 2026-09-21). Sumber sama
 * dengan "% Diskon (DPL/DPF)" di POA Estimasi (getDiskonByOutlet: Exodus live,
 * fallback DiskonKontrak). Detail = prdAkhir terjauh per produk.
 */
export async function getActiveDplByOutletAction(kodePI: string): Promise<{ kodeProduk: string; prdAkhir: string }[]> {
  if (!kodePI) return [];
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const byKode = new Map<string, string>();
  for (const c of await getDiskonByOutlet(kodePI)) {
    if (c.prdAwal <= ym && ym <= c.prdAkhir && (byKode.get(c.kodeProduk) ?? "") < c.prdAkhir) byKode.set(c.kodeProduk, c.prdAkhir);
  }
  return Array.from(byKode, ([kodeProduk, prdAkhir]) => ({ kodeProduk, prdAkhir }));
}

/**
 * Status Pengajuan (Baru/Perpanjangan) — auto-derived per produk×outlet, NOT
 * user-picked (2026-08-27, user request: dulu manual dropdown, sekarang label
 * read-only). PERPANJANGAN kalau SALAH SATU dari tiga sinyal berikut true
 * (OR, 2026-08-28 user request — "sudah standarisasi" berarti pernah
 * standarisasi dan sekarang mau diajukan lagi, jadi harus konsisten dengan
 * label "Sudah Standarisasi" sidebar, bukan cuma sinyal sales):
 * 1. Ada sales (qty > 0) produk ini di outlet ini dalam 3 bulan terakhir yang
 *    sudah selesai (OutletSalesMonthly, bulan berjalan tidak dihitung —
 *    2026-09-21 user request, sebelumnya 12 bulan via OutletSalesHistory);
 * 2. Produk ini pernah di-submit di POA Standarisasi lain di outlet yang
 *    sama (query sama seperti getStandarisasiProdukByOutletAction's "Sudah
 *    Standarisasi" — excludePengajuanId supaya pengajuan yang sedang dibuka
 *    tidak menghitung dirinya sendiri);
 * 3. Import master data `OutletProductKriteria.kriteriaBaru` untuk
 *    produk×outlet ini sudah berlabel "Produk Sudah Terstandarisasi..." (baik
 *    "- Ada Sales" maupun "- Tidak Ada Sales") — sinyal INDEPENDEN dari #1/#2
 *    (bisa saja sudah dilabeli standarisasi di import lama sebelum pernah ada
 *    sales tercatat ATAU pengajuan ter-submit di app ini). Match EXACT sama
 *    seperti RekomendasiSidebar's `standarisasiMerged` (`.startsWith(...)`),
 *    supaya auto-fill ini konsisten dengan label "Sudah Standarisasi" yang
 *    dilihat user di sidebar.
 * 4. Ada DPL aktif di bulan berjalan untuk produk×outlet ini
 *    (getActiveDplByOutletAction, 2026-09-21) — `dplKode` dari caller. Di
 *    dalam transaksi caller wajib fetch SEBELUM $transaction supaya HTTP
 *    Exodus tidak makan timeout tx.
 * Kalau keempat sinyal negatif → Baru. Batched (satu findMany per sinyal utk
 * seluruh kodeProduk sekaligus), bukan query per produk — sama pola
 * no-N+1 seperti applyPlanningProduk lainnya.
 */
async function computeStatusPengajuanMap(
  client: Prisma.TransactionClient | typeof prisma,
  kodePI: string,
  kodeProdukList: string[],
  excludePengajuanId?: string,
  dplKode?: Set<string>
): Promise<Map<string, "BARU" | "PERPANJANGAN">> {
  const map = new Map<string, "BARU" | "PERPANJANGAN">(kodeProdukList.map((k) => [k, "BARU"]));
  if (kodeProdukList.length === 0) return map;
  const now = new Date();
  const last3Months = [1, 2, 3].map((i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [salesRows, priorSubmittedRows, kriteriaRows] = await Promise.all([
    client.outletSalesMonthly.findMany({
      where: { kodePI, itemKode: { in: kodeProdukList }, periode: { in: last3Months }, qty: { gt: 0 } },
      select: { itemKode: true },
    }),
    client.poaStandarisasiProduk.findMany({
      where: {
        kodeProduk: { in: kodeProdukList },
        pengajuan: {
          kodePI,
          submittedAt: { not: null },
          ...(excludePengajuanId ? { id: { not: excludePengajuanId } } : {}),
        },
      },
      select: { kodeProduk: true },
    }),
    client.outletProductKriteria.findMany({
      where: { kodePI, kodeProduk: { in: kodeProdukList } },
      select: { kodeProduk: true, kriteriaBaru: true },
    }),
  ]);
  for (const r of salesRows) {
    map.set(r.itemKode, "PERPANJANGAN");
  }
  for (const r of priorSubmittedRows) {
    map.set(r.kodeProduk, "PERPANJANGAN");
  }
  for (const r of kriteriaRows) {
    if (r.kriteriaBaru.startsWith("Produk Sudah Terstandarisasi")) map.set(r.kodeProduk, "PERPANJANGAN");
  }
  for (const k of kodeProdukList) {
    if (dplKode?.has(k)) map.set(k, "PERPANJANGAN");
  }
  return map;
}

/** Read-only preview for the Planning UI — same logic as computeStatusPengajuanMap,
 * called live as the MR picks products, before anything is saved. */
export async function getStatusPengajuanPreviewAction(
  kodePI: string,
  kodeProdukList: string[],
  excludePengajuanId?: string
): Promise<Record<string, "BARU" | "PERPANJANGAN">> {
  if (!kodePI || kodeProdukList.length === 0) return {};
  const dplKode = new Set((await getActiveDplByOutletAction(kodePI)).map((d) => d.kodeProduk));
  const map = await computeStatusPengajuanMap(prisma, kodePI, kodeProdukList, excludePengajuanId, dplKode);
  return Object.fromEntries(map);
}

function validatePlanningInput(input: PlanningInput) {
  if ((input.tipeStandarisasi === "PERIODIC" || input.tipeStandarisasi === "SISIPAN") && !toNum(input.periodeBulan)) {
    throw new Error("Periode wajib diisi untuk tipe Periodic/Sisipan.");
  }
  if (input.kpdmList.length === 0) throw new Error("KPDM wajib dipilih minimal 1.");
}

/** Same "ready for Approval Atasan" rule as advanceToApprovalAtasanAction — reused
 * by createPoaStandarisasiAction so a freshly-created pengajuan can skip straight to
 * Phase 2 instead of landing back on Phase 1 requiring a second, separate "Lanjut" click. */
function validateReadyForApprovalAtasan(input: PlanningInput) {
  if (input.produk.length === 0) throw new Error("Tambahkan minimal 1 produk sebelum lanjut.");
  if (input.produk.some((p) => p.dokterKlinis.length === 0)) {
    throw new Error("Setiap produk wajib punya minimal 1 dokter user.");
  }
}

/** Upserts KPDM rows for a pengajuan (can be more than one per outlet) — same
 * add/update/remove-by-diff pattern as applyPlanningProduk's dokter loop. */
async function applyPlanningKpdm(tx: Prisma.TransactionClient, pengajuanId: string, kpdmList: PlanningKpdmInput[]) {
  const existing = await tx.poaStandarisasiKpdm.findMany({ where: { pengajuanId }, select: { customerId: true } });
  const existingSet = new Set(existing.map((k) => k.customerId));
  const wantSet = new Set(kpdmList.map((k) => k.customerId));

  const toRemove = [...existingSet].filter((cid) => !wantSet.has(cid));
  if (toRemove.length > 0) {
    await tx.poaStandarisasiKpdm.deleteMany({ where: { pengajuanId, customerId: { in: toRemove } } });
  }

  for (const k of kpdmList) {
    const data = {
      namaSnapshot: k.nama,
      jabatanSnapshot: k.jabatan,
      entertainEstimasi: toNum(k.entertainEstimasi),
    };
    if (existingSet.has(k.customerId)) {
      await tx.poaStandarisasiKpdm.updateMany({ where: { pengajuanId, customerId: k.customerId }, data });
    } else {
      await tx.poaStandarisasiKpdm.create({ data: { ...data, pengajuanId, customerId: k.customerId } });
    }
  }
}

/** Upserts produk + per-dokter estimasi rows for a pengajuan — shared between
 * savePlanningAction (existing pengajuan, may delete removed produk) and
 * createPoaStandarisasiAction (freshly created pengajuan, produk are all new). */
async function applyPlanningProduk(tx: Prisma.TransactionClient, pengajuanId: string, kodePI: string, produk: PlanningProdukInput[], dplKode: Set<string>) {
  const statusMap = await computeStatusPengajuanMap(tx, kodePI, produk.map((p) => p.kodeProduk), pengajuanId, dplKode);

  for (const p of produk) {
    const data = {
      kodeProduk: p.kodeProduk,
      statusPengajuan: statusMap.get(p.kodeProduk) ?? "BARU",
      skemaPembayaran: p.skemaPembayaran,
      estimasiDiskonPct: toNum(p.estimasiDiskonPct),
      estimasiDiskonDistributorPct: toNum(p.estimasiDiskonDistributorPct),
      estimasiValueDpRp: toNum(p.estimasiValueDpRp),
      estimasiBiayaListingRp: toNum(p.estimasiBiayaListingRp),
    };

    const produkRow = p.id
      ? await tx.poaStandarisasiProduk.update({ where: { id: p.id }, data })
      : await tx.poaStandarisasiProduk.create({ data: { ...data, pengajuanId } });

    const existingDokter = await tx.poaStandarisasiDokterApproval.findMany({ where: { produkId: produkRow.id }, select: { customerId: true } });
    const existingSet = new Set(existingDokter.map((d) => d.customerId));
    const wantSet = new Set(p.dokterKlinis.map((dk) => dk.customerId));

    const toRemove = [...existingSet].filter((cid) => !wantSet.has(cid));
    if (toRemove.length > 0) {
      await tx.poaStandarisasiDokterApproval.deleteMany({ where: { produkId: produkRow.id, customerId: { in: toRemove } } });
    }

    for (const dk of p.dokterKlinis) {
      const jumlahPasien = toNum(dk.jumlahPasien);
      const jumlahHariPraktekPerBulan = toNum(dk.jumlahHariPraktekPerBulan);
      const resepPerPasienSt = toNum(dk.resepPerPasienSt);
      const { estimasiQtyPerBulan, estimasiQtyUbPerBulan, estimasiNilaiRpPerBulan } = await computeEstimasiPerBulan(p.kodeProduk, jumlahPasien, jumlahHariPraktekPerBulan, resepPerPasienSt);
      const dokterData = {
        jumlahPasien: jumlahPasien != null ? Math.round(jumlahPasien) : null,
        jumlahHariPraktekPerBulan: jumlahHariPraktekPerBulan != null ? Math.round(jumlahHariPraktekPerBulan) : null,
        resepPerPasienSt,
        estimasiQtyPerBulan,
        estimasiQtyUbPerBulan,
        estimasiNilaiRpPerBulan,
        entertainRp: toNum(dk.entertainRp),
      };

      if (existingSet.has(dk.customerId)) {
        await tx.poaStandarisasiDokterApproval.updateMany({ where: { produkId: produkRow.id, customerId: dk.customerId }, data: dokterData });
      } else {
        await tx.poaStandarisasiDokterApproval.create({ data: { ...dokterData, produkId: produkRow.id, customerId: dk.customerId, wajib: true } });
      }
    }
  }
}

export async function savePlanningAction(id: string, input: PlanningInput): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");

  validatePlanningInput(input);

  const dplKode = new Set((await getActiveDplByOutletAction(pengajuan.kodePI)).map((d) => d.kodeProduk));
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.poaStandarisasi.update({
      where: { id },
      data: {
        tipeStandarisasi: input.tipeStandarisasi,
        periodeBulan: input.tipeStandarisasi === "PERMANEN" ? null : toNum(input.periodeBulan),
        jumlahBedRs: toNum(input.jumlahBedRs),
        estimasiTimelineSelesai: input.estimasiTimelineSelesai ? new Date(input.estimasiTimelineSelesai) : null,
      },
    });

    await applyPlanningKpdm(tx, id, input.kpdmList);

    const existingProduk = await tx.poaStandarisasiProduk.findMany({ where: { pengajuanId: id }, select: { id: true } });
    const keepIds = new Set(input.produk.filter((p) => p.id).map((p) => p.id!));
    const toDelete = existingProduk.filter((p) => !keepIds.has(p.id)).map((p) => p.id);
    if (toDelete.length > 0) {
      await tx.poaStandarisasiProduk.deleteMany({ where: { id: { in: toDelete } } });
    }

    await applyPlanningProduk(tx, id, pengajuan.kodePI, input.produk, dplKode);
  });

  revalidatePath(`/poa-standarisasi/${id}`);
}

/** Phase 1 → Phase 2. Requires at least one produk, each with at least one dokter. */
export async function advanceToApprovalAtasanAction(id: string): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id }, include: { produk: { include: { dokterApproval: true } } } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.currentPhase !== "PLANNING") throw new Error("Pengajuan sudah melewati fase Planning.");
  if (pengajuan.produk.length === 0) throw new Error("Tambahkan minimal 1 produk sebelum lanjut.");
  if (pengajuan.produk.some((p: (typeof pengajuan.produk)[number]) => p.dokterApproval.length === 0)) {
    throw new Error("Setiap produk wajib punya minimal 1 dokter user.");
  }

  await prisma.poaStandarisasi.update({ where: { id }, data: { currentPhase: "APPROVAL_ATASAN" } });
  revalidatePath(`/poa-standarisasi/${id}`);
}

// ─── Phase 2: Approval Atasan (blocking, sequential ASM → SM → NSM) ────────

export async function approvePoaStandarisasiAtasanAction(
  id: string,
  level: "ASM" | "SM" | "NSM",
  decision: "DISETUJUI" | "DITOLAK"
): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (pengajuan.currentPhase !== "APPROVAL_ATASAN") throw new Error("Pengajuan tidak sedang di fase Approval Atasan.");
  if (!(await canApprovePoaStandarisasiAtasan(actor, pengajuan, level))) {
    throw new Error("Anda tidak berhak melakukan approval di level ini.");
  }

  const data =
    level === "ASM"
      ? { statusApprovalAsm: decision, tanggalApprovalAsm: new Date() }
      : level === "SM"
      ? { statusApprovalSm: decision, tanggalApprovalSm: new Date() }
      : { statusApprovalNsm: decision, tanggalApprovalNsm: new Date() };

  const updated = await prisma.poaStandarisasi.update({ where: { id }, data });

  // Blocking, sequential: only advance to Phase 3 once ALL THREE are DISETUJUI.
  if (updated.statusApprovalAsm === "DISETUJUI" && updated.statusApprovalSm === "DISETUJUI" && updated.statusApprovalNsm === "DISETUJUI") {
    await prisma.poaStandarisasi.update({ where: { id }, data: { currentPhase: "APPROVAL_USER_DOKTER" } });
  }

  revalidatePath(`/poa-standarisasi/${id}`);
}

// ─── Phase 3: Approval User/Dokter ──────────────────────────────────────────
// "Sudah TTD" adalah checkbox manual (setDokterTtdAction) — sempat diganti
// upload-derived 2026-08-26 (docs/TODO.md #8/#14), dibalikin lagi ke checkbox
// karena upload Google Drive-nya bermasalah di staging. Dokter di list ini
// juga bisa ditambah/dihapus di fase ini (bukan cuma fixed dari Planning).

/** Adds a dokter to a produk's Approval User/Dokter checklist — lets an
 * atasan/MR change who needs to sign after Planning, not just what was
 * picked there. Customer must already be a real row (materialize "nexus:"
 * ids via createCustomerAction client-side first, same pattern as Planning). */
export async function addDokterApprovalAction(produkId: string, customerId: string): Promise<void> {
  const { actor } = await requireActor();
  const produk = await prisma.poaStandarisasiProduk.findUnique({ where: { id: produkId }, include: { pengajuan: true } });
  if (!produk) throw new Error("Produk tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, produk.pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (produk.pengajuan.currentPhase !== "APPROVAL_USER_DOKTER") throw new Error("Pengajuan tidak sedang di fase ini.");

  await prisma.poaStandarisasiDokterApproval.upsert({
    where: { produkId_customerId: { produkId, customerId } },
    update: {},
    create: { produkId, customerId, wajib: true },
  });
  revalidatePath(`/poa-standarisasi/${produk.pengajuanId}`);
}

export async function removeDokterApprovalAction(produkId: string, customerId: string): Promise<void> {
  const { actor } = await requireActor();
  const produk = await prisma.poaStandarisasiProduk.findUnique({ where: { id: produkId }, include: { pengajuan: true } });
  if (!produk) throw new Error("Produk tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, produk.pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (produk.pengajuan.currentPhase !== "APPROVAL_USER_DOKTER") throw new Error("Pengajuan tidak sedang di fase ini.");

  await prisma.poaStandarisasiDokterApproval.deleteMany({ where: { produkId, customerId } });
  revalidatePath(`/poa-standarisasi/${produk.pengajuanId}`);
}

/**
 * "Ganti Dokter" di Approval User/Dokter — remove lama + add baru dalam satu
 * transaksi, PLUS wajib alasan (2026-09-08, user request: mandatory reason
 * box saat re-assign dokter user di level approval ini) yang dicatat ke
 * PoaStandarisasiDokterReassignLog buat audit trail (siapa ganti siapa,
 * kapan, kenapa). `reason` divalidasi non-kosong di server juga — jangan
 * cuma percaya validasi client.
 */
export async function reassignDokterApprovalAction(produkId: string, oldCustomerId: string, newCustomerId: string, reason: string): Promise<void> {
  const { actor } = await requireActor();
  if (!reason.trim()) throw new Error("Alasan wajib diisi.");
  const produk = await prisma.poaStandarisasiProduk.findUnique({ where: { id: produkId }, include: { pengajuan: true } });
  if (!produk) throw new Error("Produk tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, produk.pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (produk.pengajuan.currentPhase !== "APPROVAL_USER_DOKTER") throw new Error("Pengajuan tidak sedang di fase ini.");

  const [oldCustomer, newCustomer] = await Promise.all([
    prisma.customer.findUnique({ where: { id: oldCustomerId }, select: { namaCustomer: true } }),
    prisma.customer.findUnique({ where: { id: newCustomerId }, select: { namaCustomer: true } }),
  ]);
  if (!oldCustomer || !newCustomer) throw new Error("Dokter tidak ditemukan.");

  await prisma.$transaction([
    prisma.poaStandarisasiDokterApproval.deleteMany({ where: { produkId, customerId: oldCustomerId } }),
    prisma.poaStandarisasiDokterApproval.upsert({
      where: { produkId_customerId: { produkId, customerId: newCustomerId } },
      update: {},
      create: { produkId, customerId: newCustomerId, wajib: true },
    }),
    prisma.poaStandarisasiDokterReassignLog.create({
      data: {
        produkId,
        oldCustomerId,
        oldNamaSnapshot: oldCustomer.namaCustomer,
        newCustomerId,
        newNamaSnapshot: newCustomer.namaCustomer,
        reason: reason.trim(),
        actorNip: actor.nip,
      },
    }),
  ]);
  revalidatePath(`/poa-standarisasi/${produk.pengajuanId}`);
}

/** Toggles "Sudah TTD" manually — checkbox, not upload-derived anymore
 * (docs batch standarisasi #11, reverts docs/TODO.md #8/#14 2026-08-26). */
export async function setDokterTtdAction(produkId: string, customerId: string, sudahTtd: boolean): Promise<void> {
  const { actor } = await requireActor();
  const produk = await prisma.poaStandarisasiProduk.findUnique({ where: { id: produkId }, include: { pengajuan: true } });
  if (!produk) throw new Error("Produk tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, produk.pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (produk.pengajuan.currentPhase !== "APPROVAL_USER_DOKTER") throw new Error("Pengajuan tidak sedang di fase ini.");

  await prisma.poaStandarisasiDokterApproval.updateMany({ where: { produkId, customerId }, data: { sudahTtd } });
  revalidatePath(`/poa-standarisasi/${produk.pengajuanId}`);
}

/**
 * "Jadwal Meeting KFT" — sekarang cuma satu field optional di card kecil
 * sidebar Approval User/Dokter (2026-09-08, redline kedua user: bukan phase
 * terpisah lagi, lihat advanceToFinalisasiAction di bawah). Phase-agnostic
 * (tidak gate ke currentPhase tertentu) — sama seperti field lain yang boleh
 * diedit kapan saja pengajuan masih editable, bukan cuma di satu step.
 */
export async function saveJadwalMeetingKftAction(id: string, jadwalMeetingKft: string | null): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");

  await prisma.poaStandarisasi.update({
    where: { id },
    data: { jadwalMeetingKft: jadwalMeetingKft ? new Date(jadwalMeetingKft) : null },
  });
  revalidatePath(`/poa-standarisasi/${id}`);
}

/**
 * Phase 3 → Phase 5, langsung (2026-09-08, user request: hapus "Menunggu
 * Meeting KFT" dari flow — was Phase 3 → Phase 4 → Phase 5, dua actions
 * terpisah, digabung jadi satu di sini). Requires "Sudah TTD" dicentang untuk
 * setiap dokter WAJIB di setiap produk, sama seperti sebelumnya. Enum
 * PoaStandarisasiPhase.MENUNGGU_MEETING_KFT tetap ada di schema (data
 * historis), tapi tidak pernah di-set lagi mulai sekarang.
 */
export async function advanceToFinalisasiAction(id: string): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({
    where: { id },
    include: { produk: { include: { dokterApproval: true } } },
  });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.currentPhase !== "APPROVAL_USER_DOKTER") throw new Error("Pengajuan tidak sedang di fase Approval User/Dokter.");
  const belumTtd = pengajuan.produk.some((p: (typeof pengajuan.produk)[number]) =>
    p.dokterApproval.some((d: (typeof p.dokterApproval)[number]) => d.wajib && !d.sudahTtd)
  );
  if (belumTtd) throw new Error("Centang Sudah TTD untuk semua dokter wajib sebelum lanjut.");

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Seed PoaStandarisasiDokterUser from every sudahTtd dokter in Phase 3
    // (docs/poa-standarisasi/02-data-model.md — "defaultnya di-seed dari
    // dokter yang sudah TTD di Phase 3") — was never actually done, leaving
    // Finalisasi's dokter list permanently empty. skipDuplicates makes this
    // safe to re-run if the pengajuan ever revisits this transition.
    // 2026-09-08 bug fix: seed dulu cuma copy {produkId, customerId} — angka
    // (jumlahPasien/resepPerPasienSt/estimasi*/entertainRp) dibiarkan null,
    // jadi Finalisasi tampil 0 padahal sudah diisi di Planning. Sekarang
    // seed langsung bawa angka Planning-nya juga, sama seperti pola diskon
    // (finalDiscountPct dst. default dari estimasiDiskonPct).
    for (const p of pengajuan.produk) {
      const ttdDokter = p.dokterApproval.filter((d: (typeof p.dokterApproval)[number]) => d.sudahTtd);
      if (ttdDokter.length === 0) continue;
      await tx.poaStandarisasiDokterUser.createMany({
        data: ttdDokter.map((d: (typeof p.dokterApproval)[number]) => ({
          produkId: p.id,
          customerId: d.customerId,
          jumlahPasien: d.jumlahPasien,
          jumlahHariPraktekPerBulan: d.jumlahHariPraktekPerBulan,
          resepPerPasienSt: d.resepPerPasienSt,
          estimasiQtyPerBulan: d.estimasiQtyPerBulan,
          estimasiQtyUbPerBulan: d.estimasiQtyUbPerBulan,
          estimasiSalesRpPerBulan: d.estimasiNilaiRpPerBulan,
          entertainRp: d.entertainRp,
        })),
        skipDuplicates: true,
      });
    }
    await tx.poaStandarisasi.update({ where: { id }, data: { currentPhase: "FINALISASI" } });
  });
  revalidatePath(`/poa-standarisasi/${id}`);
}

// ─── Phase 5: Finalisasi ────────────────────────────────────────────────────

export interface FinalisasiDokterUserInput {
  customerId: string;
  jumlahPasien: number | string | null;
  jumlahHariPraktekPerBulan: number | string | null;
  resepPerPasienSt: number | string | null;
  entertainRp: number | string | null;
}

export interface FinalisasiProdukInput {
  id: string;
  // Bisa diganti lagi di Finalisasi (2026-09-09 bug report — lihat schema.prisma).
  skemaPembayaran: "DISKON" | "DP";
  finalDiscountPct: number | string | null;
  diskonDistributorPct: number | string | null;
  finalValueDpRp: number | string | null;
  finalBiayaListingRp: number | string | null;
  standarisasiGagal: boolean;
  dokterUser: FinalisasiDokterUserInput[];
}

export interface FinalisasiKpdmInput {
  customerId: string;
  // Cuma dipakai kalau KPDM ini baru ditambah di Finalisasi (belum ada row-nya dari Planning) — lihat saveFinalisasiAction.
  nama?: string;
  jabatan?: string | null;
  entertainFinal: number | string | null;
}

export interface FinalisasiInput {
  distributors: string[];
  kpdmList: FinalisasiKpdmInput[];
  produk: FinalisasiProdukInput[];
}

const DISTRIBUTOR_PILIHAN = ["AMS", "PPG", "MPI"] as const;

export async function saveFinalisasiAction(id: string, input: FinalisasiInput): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id }, include: { produk: true } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.currentPhase !== "FINALISASI") throw new Error("Pengajuan tidak sedang di fase Finalisasi.");

  const distributors = input.distributors.filter((d): d is (typeof DISTRIBUTOR_PILIHAN)[number] => (DISTRIBUTOR_PILIHAN as readonly string[]).includes(d));

  const produkByKode = new Map<string, string>(pengajuan.produk.map((p: (typeof pengajuan.produk)[number]) => [p.id, p.kodeProduk] as const));

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.poaStandarisasi.update({
      where: { id },
      data: { distributors },
    });

    // Add/update/remove — mirrors applyPlanningKpdm, since KPDM can now be
    // added/removed at Finalisasi too (2026-09-09 user request), not just
    // Planning. A blind updateMany (the old behavior) silently dropped any
    // KPDM added here because no row existed yet to match against.
    const existingKpdm = await tx.poaStandarisasiKpdm.findMany({ where: { pengajuanId: id }, select: { customerId: true } });
    const existingKpdmSet = new Set(existingKpdm.map((k: (typeof existingKpdm)[number]) => k.customerId));
    const wantKpdmSet = new Set(input.kpdmList.map((k) => k.customerId));
    const toRemoveKpdm = [...existingKpdmSet].filter((cid) => !wantKpdmSet.has(cid));
    if (toRemoveKpdm.length > 0) {
      await tx.poaStandarisasiKpdm.deleteMany({ where: { pengajuanId: id, customerId: { in: toRemoveKpdm } } });
    }
    for (const k of input.kpdmList) {
      if (existingKpdmSet.has(k.customerId)) {
        await tx.poaStandarisasiKpdm.updateMany({
          where: { pengajuanId: id, customerId: k.customerId },
          data: { entertainFinal: toNum(k.entertainFinal) },
        });
      } else {
        await tx.poaStandarisasiKpdm.create({
          data: {
            pengajuanId: id,
            customerId: k.customerId,
            namaSnapshot: k.nama ?? "",
            jabatanSnapshot: k.jabatan ?? null,
            entertainFinal: toNum(k.entertainFinal),
          },
        });
      }
    }

    for (const p of input.produk) {
      const kodeProduk = produkByKode.get(p.id);
      if (!kodeProduk) continue;

      await tx.poaStandarisasiProduk.update({
        where: { id: p.id },
        data: {
          skemaPembayaran: p.skemaPembayaran,
          finalDiscountPct: toNum(p.finalDiscountPct),
          diskonDistributorPct: toNum(p.diskonDistributorPct),
          finalValueDpRp: toNum(p.finalValueDpRp),
          finalBiayaListingRp: toNum(p.finalBiayaListingRp),
          standarisasiGagal: p.standarisasiGagal,
        },
      });

      const existing = await tx.poaStandarisasiDokterUser.findMany({ where: { produkId: p.id }, select: { customerId: true } });
      const existingSet = new Set(existing.map((d) => d.customerId));
      const wantIds = new Set(p.dokterUser.map((d) => d.customerId));

      const toRemove = [...existingSet].filter((cid) => !wantIds.has(cid));
      if (toRemove.length > 0) {
        await tx.poaStandarisasiDokterUser.deleteMany({ where: { produkId: p.id, customerId: { in: toRemove } } });
      }

      for (const d of p.dokterUser) {
        const jumlahPasien = toNum(d.jumlahPasien);
        const jumlahHariPraktekPerBulan = toNum(d.jumlahHariPraktekPerBulan);
        const resepPerPasienSt = toNum(d.resepPerPasienSt);
        const { estimasiQtyPerBulan, estimasiQtyUbPerBulan, estimasiNilaiRpPerBulan } = await computeEstimasiPerBulan(kodeProduk, jumlahPasien, jumlahHariPraktekPerBulan, resepPerPasienSt);

        const data = {
          jumlahPasien: jumlahPasien != null ? Math.round(jumlahPasien) : null,
          jumlahHariPraktekPerBulan: jumlahHariPraktekPerBulan != null ? Math.round(jumlahHariPraktekPerBulan) : null,
          resepPerPasienSt,
          estimasiQtyPerBulan,
          estimasiQtyUbPerBulan,
          estimasiSalesRpPerBulan: estimasiNilaiRpPerBulan,
          entertainRp: toNum(d.entertainRp),
        };

        if (existingSet.has(d.customerId)) {
          await tx.poaStandarisasiDokterUser.updateMany({ where: { produkId: p.id, customerId: d.customerId }, data });
        } else {
          await tx.poaStandarisasiDokterUser.create({ data: { ...data, produkId: p.id, customerId: d.customerId } });
        }
      }
    }
  });

  revalidatePath(`/poa-standarisasi/${id}`);
}

export async function submitPoaStandarisasiAction(id: string): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id }, include: { produk: true } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.currentPhase !== "FINALISASI") throw new Error("Pengajuan belum di fase Finalisasi.");
  // Form Approval Standarisasi & Surat Approval Standarisasi KFT keduanya
  // optional (2026-09-07, user request) — tidak lagi gate submit.

  await prisma.poaStandarisasi.update({ where: { id }, data: { submittedAt: new Date() } });
  revalidatePath(`/poa-standarisasi/${id}`);
}

// ─── File upload (Google Drive, same service account/pattern as Input Data Survey) ──

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB, per preview UI copy ("PDF atau JPG, maks 10MB")
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];
const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function sanitizeForFileName(s: string): string {
  return s.replace(/[/\\?%*:|"<>]/g, "-").trim();
}

/**
 * Uploads "Form Approval Standarisasi" (per produk, Finalisasi) or "Surat
 * Approval Standarisasi KFT" (per pengajuan, resolved Q6 — one file, not per
 * produk). Each goes to its own ADMIN-settable GoogleDriveConfig folder,
 * separate from the survey folder and from each other (2026-09-07, user
 * request — see src/lib/googleDrive.ts).
 */
export async function uploadPoaStandarisasiFileAction(formData: FormData): Promise<{ driveFileId: string; namaFile: string }> {
  if (POA_STANDARISASI_UPLOAD_DISABLED) throw new Error(POA_STANDARISASI_UPLOAD_DISABLED_MESSAGE);
  const { session, actor } = await requireActor();
  if (!isGoogleDriveConfigured) throw new Error("Fitur upload belum dikonfigurasi.");

  const file = formData.get("file");
  const pengajuanId = (formData.get("pengajuanId") as string | null) ?? "";
  const kind = (formData.get("kind") as string | null) ?? ""; // "formApproval" | "suratKft"
  const produkId = (formData.get("produkId") as string | null) || null;

  if (!(file instanceof File)) throw new Error("File wajib diisi.");
  if (!pengajuanId) throw new Error("Pengajuan tidak valid.");

  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id: pengajuanId } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");

  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) throw new Error("File harus berformat PDF atau JPG/PNG.");
  if (file.size === 0) throw new Error("File kosong.");
  if (file.size > MAX_FILE_SIZE_BYTES) throw new Error("Ukuran file maksimum 10MB.");

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
  const label = kind === "suratKft" ? "Surat Approval Standarisasi KFT" : "Form Approval Standarisasi";
  const namaFile = `${timestamp} - ${label} - POA Standarisasi ${sanitizeForFileName(pengajuan.kodePI)} oleh ${sanitizeForFileName(session.name)}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  let driveFileId: string;
  try {
    ({ driveFileId } = await uploadFileToPoaStandarisasiDrive(kind === "suratKft" ? "kftApproval" : "formApproval", namaFile, mimeType, buffer));
  } catch (err) {
    // Same degradation as /api/survey/upload's POST — an unhandled throw
    // here becomes an opaque "Server Components render" digest error in
    // production (2026-08-27 bug report), so surface a real message instead.
    // Server Actions only propagate the Error's message to the client (no
    // separate JSON body to attach a `diag` field to like the REST route
    // does), so the safe diagnostic is appended into the message itself.
    const diag = describeGoogleDriveConfig();
    console.error("[poaStandarisasi/upload] Google Drive upload failed:", err, diag);
    throw new Error(`Upload ke Google Drive gagal, coba lagi. (${JSON.stringify(diag)})`);
  }

  if (kind === "suratKft") {
    await prisma.poaStandarisasi.update({
      where: { id: pengajuanId },
      data: { suratApprovalStandarisasiKftPath: namaFile, suratApprovalStandarisasiKftDriveFileId: driveFileId },
    });
  } else {
    if (!produkId) throw new Error("Produk tidak valid.");
    await prisma.poaStandarisasiProduk.update({
      where: { id: produkId },
      data: { formApprovalFilePath: namaFile, formApprovalDriveFileId: driveFileId },
    });
  }

  revalidatePath(`/poa-standarisasi/${pengajuanId}`);
  return { driveFileId, namaFile };
}

// ─── Step 5: Permintaan SP Non Sales & DPL/DPF ──────────────────────────────
// Muncul otomatis setelah pengajuan.submittedAt terisi (Finalisasi selesai) —
// bukan phase di PoaStandarisasiPhase, gate-nya pakai canEditPoaStandarisasiStep5
// (kebalikan dari canEditPoaStandarisasi: butuh submittedAt SUDAH terisi,
// bukan belum). Tab "Request DPL/DPF" cuma nampilin data existing (Beban
// Discount PI/Distributor = finalDiscountPct/diskonDistributorPct yang sudah
// ada, Distributor = field `distributors` yang sama) — "+ Buat DPL/DPF"
// tetap placeholder di v1 (§6 non-goals, belum ada integrasi sistem
// eksternal), tidak ada action baru untuk itu.

export interface SpNonSalesJumlahInput {
  produkId: string;
  jumlahBox: number | string | null;
}

/** Jumlah SP Non Sales per produk — disimpan lepas dari "Ajukan" supaya MR bisa isi bertahap sebelum submit akhir. */
export async function saveSpNonSalesJumlahAction(id: string, lines: SpNonSalesJumlahInput[]): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasiStep5(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.spNonSalesSubmittedAt) throw new Error("Permintaan SP Non Sales sudah diajukan, tidak bisa diubah lagi.");

  await prisma.$transaction(
    lines.map((l) => prisma.poaStandarisasiProduk.update({ where: { id: l.produkId }, data: { spNonSalesJumlahBox: toNum(l.jumlahBox) } }))
  );
  revalidatePath(`/poa-standarisasi/${id}`);
}

/** "Ajukan Permintaan SP Non Sales" — locks the quantities, doesn't validate a minimum (lenient, matches this feature's other optional-first fields). */
export async function submitSpNonSalesRequestAction(id: string): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasiStep5(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.spNonSalesSubmittedAt) throw new Error("Sudah diajukan sebelumnya.");

  await prisma.poaStandarisasi.update({ where: { id }, data: { spNonSalesSubmittedAt: new Date() } });
  revalidatePath(`/poa-standarisasi/${id}`);
}

/** Distributor terpilih di tab "Request DPL/DPF" — reuse field `distributors` yang sama dipakai Finalisasi, tapi diedit lagi di sini (phase-agnostic, submittedAt Finalisasi sudah lewat). */
export async function updateSpNonSalesDistributorsAction(id: string, distributors: string[]): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasiStep5(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");

  const filtered = distributors.filter((d): d is (typeof DISTRIBUTOR_PILIHAN)[number] => (DISTRIBUTOR_PILIHAN as readonly string[]).includes(d));
  await prisma.poaStandarisasi.update({ where: { id }, data: { distributors: filtered } });
  revalidatePath(`/poa-standarisasi/${id}`);
}

/** Uploads a "Permintaan SP Non Sales" document — multiple files allowed per pengajuan (shared, not per produk), own admin-settable Drive folder. */
export async function uploadSpNonSalesDocumentAction(formData: FormData): Promise<{ driveFileId: string; fileName: string }> {
  if (POA_STANDARISASI_UPLOAD_DISABLED) throw new Error(POA_STANDARISASI_UPLOAD_DISABLED_MESSAGE);
  const { session, actor } = await requireActor();
  if (!isGoogleDriveConfigured) throw new Error("Fitur upload belum dikonfigurasi.");

  const file = formData.get("file");
  const pengajuanId = (formData.get("pengajuanId") as string | null) ?? "";
  if (!(file instanceof File)) throw new Error("File wajib diisi.");
  if (!pengajuanId) throw new Error("Pengajuan tidak valid.");

  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id: pengajuanId } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasiStep5(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.spNonSalesSubmittedAt) throw new Error("Permintaan SP Non Sales sudah diajukan, tidak bisa upload dokumen baru lagi.");

  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) throw new Error("File harus berformat PDF atau JPG/PNG.");
  if (file.size === 0) throw new Error("File kosong.");
  if (file.size > MAX_FILE_SIZE_BYTES) throw new Error("Ukuran file maksimum 10MB.");

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
  const fileName = `${timestamp} - Permintaan SP Non Sales - POA Standarisasi ${sanitizeForFileName(pengajuan.kodePI)} oleh ${sanitizeForFileName(session.name)}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  let driveFileId: string;
  try {
    ({ driveFileId } = await uploadFileToPoaStandarisasiDrive("spNonSales", fileName, mimeType, buffer));
  } catch (err) {
    const diag = describeGoogleDriveConfig();
    console.error("[poaStandarisasi/uploadSpNonSales] Google Drive upload failed:", err, diag);
    throw new Error(`Upload ke Google Drive gagal, coba lagi. (${JSON.stringify(diag)})`);
  }

  await prisma.poaStandarisasiSpNonSalesDocument.create({
    data: { pengajuanId, fileName, driveFileId, uploadedByNip: actor.nip },
  });

  revalidatePath(`/poa-standarisasi/${pengajuanId}`);
  return { driveFileId, fileName };
}

export async function deleteSpNonSalesDocumentAction(documentId: string): Promise<void> {
  const { actor } = await requireActor();
  const doc = await prisma.poaStandarisasiSpNonSalesDocument.findUnique({ where: { id: documentId }, include: { pengajuan: true } });
  if (!doc) throw new Error("Dokumen tidak ditemukan.");
  if (!canEditPoaStandarisasiStep5(actor, doc.pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (doc.pengajuan.spNonSalesSubmittedAt) throw new Error("Permintaan SP Non Sales sudah diajukan, tidak bisa hapus dokumen lagi.");

  await prisma.poaStandarisasiSpNonSalesDocument.delete({ where: { id: documentId } });
  revalidatePath(`/poa-standarisasi/${doc.pengajuanId}`);
}

// ─── Confidential file download (authenticated proxy + access log) ────────
// User 2026-08-27: dokumen POA Standarisasi (NIE/COA/CPOB/Flyer, Bukti TTD,
// Form Approval Standarisasi, Surat Approval Standarisasi KFT) itu
// confidential — link Drive mentah visibility-nya ikut sharing setting
// FOLDER Drive, bukan authz app. Semua download WAJIB lewat
// /api/poa-standarisasi/dokumen/[driveFileId] (bukan driveViewUrl langsung)
// supaya bisa digerbangi authz + dicatat siapa/kapan/berapa kali.

/** Resolves which pengajuan/produk/dokter owns a given Drive file id, across
 * the 4 places a driveFileId can live — so the download route never has to
 * trust a client-supplied pengajuanId/label. */
async function resolvePoaStandarisasiFileOwner(driveFileId: string) {
  const [dokumen, produk, suratKft, dokterApproval] = await Promise.all([
    prisma.poaStandarisasiDokumen.findFirst({
      where: { driveFileId },
      include: { produk: { include: { pengajuan: true, product: true } } },
    }),
    prisma.poaStandarisasiProduk.findFirst({
      where: { formApprovalDriveFileId: driveFileId },
      include: { pengajuan: true, product: true },
    }),
    prisma.poaStandarisasi.findFirst({ where: { suratApprovalStandarisasiKftDriveFileId: driveFileId } }),
    prisma.poaStandarisasiDokterApproval.findFirst({
      where: { buktiTtdDriveFileId: driveFileId },
      include: { produk: { include: { pengajuan: true, product: true } }, customer: true },
    }),
  ]);

  if (dokumen) return { pengajuan: dokumen.produk.pengajuan, label: `${dokumen.jenis} — ${dokumen.produk.product.namaProduk}` };
  if (produk) return { pengajuan: produk.pengajuan, label: `Form Approval Standarisasi — ${produk.product.namaProduk}` };
  if (suratKft) return { pengajuan: suratKft, label: "Surat Approval Standarisasi KFT" };
  if (dokterApproval) return { pengajuan: dokterApproval.produk.pengajuan, label: `Bukti TTD — ${dokterApproval.customer.namaCustomer} (${dokterApproval.produk.product.namaProduk})` };
  return null;
}

/**
 * Authorizes + logs one access to a confidential POA Standarisasi file,
 * given only its Drive file id. Throws if the file isn't found or the
 * current session isn't authorized to view its pengajuan — the download
 * route must not stream file bytes unless this resolves successfully.
 */
export async function authorizeAndLogPoaStandarisasiFileAccess(driveFileId: string): Promise<void> {
  const session = await getCurrentUser();
  if (!session) throw new Error("Sesi tidak valid.");

  const owner = await resolvePoaStandarisasiFileOwner(driveFileId);
  if (!owner) throw new Error("File tidak ditemukan.");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canViewPoaStandarisasi(actor, owner.pengajuan))) {
    throw new Error("Anda tidak berhak mengakses dokumen ini.");
  }

  await prisma.poaStandarisasiFileAccessLog.create({
    data: { pengajuanId: owner.pengajuan.id, driveFileId, label: owner.label, accessedByNip: actor.nip },
  });
}

export interface FileAccessLogRow {
  id: string;
  driveFileId: string;
  label: string;
  accessedByNip: string;
  accessedByNama: string;
  accessedAt: Date;
}

/** Powers the "Riwayat Akses Dokumen" panel — who opened which file, when, how many times. */
export async function getPoaStandarisasiFileAccessLogAction(pengajuanId: string): Promise<FileAccessLogRow[]> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id: pengajuanId } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!(await canViewPoaStandarisasi(actor, pengajuan))) throw new Error("Anda tidak berhak melihat log ini.");

  const rows = await prisma.poaStandarisasiFileAccessLog.findMany({
    where: { pengajuanId },
    include: { accessedBy: { select: { name: true } } },
    orderBy: { accessedAt: "desc" },
  });
  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    driveFileId: r.driveFileId,
    label: r.label,
    accessedByNip: r.accessedByNip,
    accessedByNama: r.accessedBy.name,
    accessedAt: r.accessedAt,
  }));
}
