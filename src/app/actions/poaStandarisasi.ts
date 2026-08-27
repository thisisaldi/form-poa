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
import { canCreatePoa, canViewPoaStandarisasi, canEditPoaStandarisasi, canApprovePoaStandarisasiAtasan } from "@/lib/authz";
import { hargaST } from "@/lib/masterData";
import type { Product as ProductLite } from "@/lib/masterData";
import { getSurveyRekomendasiInfo, getCustomersByOutlet } from "@/app/actions/customer";
import { uploadFileToSurveyDrive, isGoogleDriveConfigured } from "@/lib/googleDrive";
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
  // ADMIN-only while this feature is under review (2026-08-14), same
  // convention as /monitoring — bypasses the normal MR/ASM/SM/NSM
  // eligibility check below entirely until this is opened back up.
  if (session.role !== "ADMIN") redirect("/dashboard");

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

  const pengajuanId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const pengajuan = await tx.poaStandarisasi.create({
      data: {
        ownerId: session.userId,
        kodePI,
        tipeStandarisasi: input.tipeStandarisasi,
        statusPengajuan: input.statusPengajuan,
        periodeBulan: input.tipeStandarisasi === "PERMANEN" ? null : toNum(input.periodeBulan),
        jumlahBedRs: toNum(input.jumlahBedRs) ?? outlet.jumlahBed,
        estimasiTimelineSelesai: input.estimasiTimelineSelesai ? new Date(input.estimasiTimelineSelesai) : null,
        currentPhase: "APPROVAL_ATASAN",
      },
    });
    await applyPlanningKpdm(tx, pengajuan.id, input.kpdmList);
    await applyPlanningProduk(tx, pengajuan.id, input.produk);
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
};

type RawDetail = Prisma.PoaStandarisasiGetPayload<{ include: typeof detailInclude }>;

const d = (v: { toString(): string } | null | undefined): number | null => (v == null ? null : parseFloat(v.toString()));

/** Prisma Decimal fields can't cross the Server→Client Component boundary as-is — stringify/numberify everything before returning. */
function serializeDetail(p: RawDetail) {
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
      estimasiBiayaListingRp: d(prod.estimasiBiayaListingRp),
      finalDiscountPct: d(prod.finalDiscountPct),
      diskonDistributorPct: d(prod.diskonDistributorPct),
      finalBiayaListingRp: d(prod.finalBiayaListingRp),
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

  return serializeDetail(pengajuan);
}

export async function listMyPoaStandarisasiAction() {
  const session = await requireSession();
  return prisma.poaStandarisasi.findMany({
    where: { ownerId: session.userId },
    include: { outlet: { select: { namaOutlet: true } }, produk: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/** "Golongan yang Dipakai Saat Ini" per dokter — resolved Q1, reuses the exact
 * function backing "Produk Kompetitor Utama" in the POA Estimasi form. */
export async function getGolonganSaatIniAction(kodeCustomer: string, kodePI: string, kodeProduk: string) {
  return getSurveyRekomendasiInfo(kodeCustomer, kodePI, kodeProduk);
}

export async function getDokterOptionsAction(kodePI: string) {
  return getCustomersByOutlet(kodePI);
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
      product: { select: { namaProduk: true } },
      pengajuan: { select: { tipeStandarisasi: true, statusPengajuan: true, submittedAt: true } },
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
      statusPengajuan: r.pengajuan.statusPengajuan,
      submittedAt: r.pengajuan.submittedAt!,
    });
  }
  return Array.from(byKode.values());
}

// ─── Phase 1: Planning Standarisasi ─────────────────────────────────────────

export interface PlanningDokterKlinisInput {
  customerId: string;
  jumlahPasien: number | string | null;
  resepPerPasienSt: number | string | null;
  entertainRp: number | string | null;
}

export interface PlanningProdukInput {
  id?: string;
  kodeProduk: string;
  estimasiDiskonPct: number | string | null;
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
  statusPengajuan: "BARU" | "PERPANJANGAN";
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

/** estimasiQty/estimasiNilai are PER BULAN, never multiplied by periodeBulan — resolved Q4. */
async function computeEstimasiPerBulan(kodeProduk: string, jumlahPasien: number | null, resepPerPasienSt: number | null) {
  if (!jumlahPasien || !resepPerPasienSt) return { estimasiQtyPerBulan: null, estimasiNilaiRpPerBulan: null };
  const product = await prisma.product.findUnique({ where: { kodeProduk } });
  if (!product) return { estimasiQtyPerBulan: null, estimasiNilaiRpPerBulan: null };
  const hst = hargaST(toProductLite(product));
  const qty = jumlahPasien * resepPerPasienSt;
  return { estimasiQtyPerBulan: qty, estimasiNilaiRpPerBulan: Math.round(qty * hst) };
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
async function applyPlanningProduk(tx: Prisma.TransactionClient, pengajuanId: string, produk: PlanningProdukInput[]) {
  for (const p of produk) {
    const data = {
      kodeProduk: p.kodeProduk,
      estimasiDiskonPct: toNum(p.estimasiDiskonPct),
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
      const resepPerPasienSt = toNum(dk.resepPerPasienSt);
      const { estimasiQtyPerBulan, estimasiNilaiRpPerBulan } = await computeEstimasiPerBulan(p.kodeProduk, jumlahPasien, resepPerPasienSt);
      const dokterData = {
        jumlahPasien: jumlahPasien != null ? Math.round(jumlahPasien) : null,
        resepPerPasienSt,
        estimasiQtyPerBulan,
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

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.poaStandarisasi.update({
      where: { id },
      data: {
        tipeStandarisasi: input.tipeStandarisasi,
        statusPengajuan: input.statusPengajuan,
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

    await applyPlanningProduk(tx, id, input.produk);
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
// "Sudah TTD" tidak lagi checkbox manual (2026-08-26, docs/TODO.md #14) —
// di-derive dari upload Bukti TTD (lihat uploadPoaStandarisasiFileAction,
// kind "buktiTtd"). Dokter di list ini juga bisa ditambah/dihapus di fase
// ini (bukan cuma fixed dari Planning), sesuai permintaan user.

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

/** Phase 3 → Phase 4. Requires bukti TTD uploaded for every dokter WAJIB di setiap produk. */
export async function advanceToMenungguMeetingKftAction(id: string): Promise<void> {
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
  if (belumTtd) throw new Error("Upload Bukti TTD untuk semua dokter wajib sebelum lanjut.");

  await prisma.poaStandarisasi.update({ where: { id }, data: { currentPhase: "MENUNGGU_MEETING_KFT" } });
  revalidatePath(`/poa-standarisasi/${id}`);
}

// ─── Phase 4: Menunggu Meeting KFT ──────────────────────────────────────────
// Just the meeting schedule + browsing Dokumen Standarisasi NIE/COA/CPOB/Flyer
// (read-only, diupload dari tempat lain — lihat PoaStandarisasiDokumen).
// "Permintaan SP Non Sales" (dokumen jenis lain) dan upload "Form Approval
// Standarisasi" dipindah ke Finalisasi (2026-08-26, user request).

export interface MenungguMeetingKftInput {
  jadwalMeetingKft: string | null; // ISO datetime
}

export async function saveMenungguMeetingKftAction(id: string, input: MenungguMeetingKftInput): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.currentPhase !== "MENUNGGU_MEETING_KFT") throw new Error("Pengajuan tidak sedang di fase ini.");

  await prisma.poaStandarisasi.update({
    where: { id },
    data: { jadwalMeetingKft: input.jadwalMeetingKft ? new Date(input.jadwalMeetingKft) : null },
  });
  revalidatePath(`/poa-standarisasi/${id}`);
}

/** Phase 4 → Phase 5. Requires "Form Approval Standarisasi" uploaded for every produk. */
export async function advanceToFinalisasiAction(id: string): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.currentPhase !== "MENUNGGU_MEETING_KFT") throw new Error("Pengajuan tidak sedang di fase Menunggu Meeting KFT.");

  await prisma.poaStandarisasi.update({ where: { id }, data: { currentPhase: "FINALISASI" } });
  revalidatePath(`/poa-standarisasi/${id}`);
}

// ─── Phase 5: Finalisasi ────────────────────────────────────────────────────

export interface FinalisasiDokterUserInput {
  customerId: string;
  jumlahPasien: number | string | null;
  resepPerPasienSt: number | string | null;
  entertainRp: number | string | null;
}

export interface FinalisasiProdukInput {
  id: string;
  finalDiscountPct: number | string | null;
  diskonDistributorPct: number | string | null;
  finalBiayaListingRp: number | string | null;
  dokterUser: FinalisasiDokterUserInput[];
}

export interface FinalisasiKpdmInput {
  customerId: string;
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

    for (const k of input.kpdmList) {
      await tx.poaStandarisasiKpdm.updateMany({
        where: { pengajuanId: id, customerId: k.customerId },
        data: { entertainFinal: toNum(k.entertainFinal) },
      });
    }

    for (const p of input.produk) {
      const kodeProduk = produkByKode.get(p.id);
      if (!kodeProduk) continue;

      await tx.poaStandarisasiProduk.update({
        where: { id: p.id },
        data: {
          finalDiscountPct: toNum(p.finalDiscountPct),
          diskonDistributorPct: toNum(p.diskonDistributorPct),
          finalBiayaListingRp: toNum(p.finalBiayaListingRp),
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
        const resepPerPasienSt = toNum(d.resepPerPasienSt);
        const { estimasiQtyPerBulan, estimasiNilaiRpPerBulan } = await computeEstimasiPerBulan(kodeProduk, jumlahPasien, resepPerPasienSt);

        const data = {
          jumlahPasien: jumlahPasien != null ? Math.round(jumlahPasien) : null,
          resepPerPasienSt,
          estimasiQtyPerBulan,
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
  // Form Approval Standarisasi upload dipindah ke Finalisasi (2026-08-26,
  // user request) — jadi gate-nya pindah ke sini juga, bukan lagi di
  // advanceToMenungguMeetingKftAction.
  if (pengajuan.produk.some((p: (typeof pengajuan.produk)[number]) => !p.formApprovalDriveFileId)) {
    throw new Error("Upload Form Approval Standarisasi untuk setiap produk sebelum submit.");
  }
  if (!pengajuan.suratApprovalStandarisasiKftDriveFileId) {
    throw new Error("Upload Surat Approval Standarisasi KFT sebelum submit.");
  }

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
 * Uploads "Form Approval Standarisasi" (per produk, Finalisasi), "Surat
 * Approval Standarisasi KFT" (per pengajuan, resolved Q6 — one file, not per
 * produk), or "Bukti TTD" (per dokter per produk, Approval User/Dokter —
 * replaces the old manual "Sudah TTD" checkbox, docs/TODO.md #14: uploading
 * sets sudahTtd=true server-side, never toggled directly by the client).
 * Same Google Drive service account/folder as Input Data Survey — no
 * dedicated folder for this feature yet (env var would need to be
 * provisioned separately; reusing GOOGLE_DRIVE_SURVEY_FOLDER_ID for v1).
 */
export async function uploadPoaStandarisasiFileAction(formData: FormData): Promise<{ driveFileId: string; namaFile: string }> {
  const { session, actor } = await requireActor();
  if (!isGoogleDriveConfigured) throw new Error("Fitur upload belum dikonfigurasi.");

  const file = formData.get("file");
  const pengajuanId = (formData.get("pengajuanId") as string | null) ?? "";
  const kind = (formData.get("kind") as string | null) ?? ""; // "formApproval" | "suratKft" | "buktiTtd"
  const produkId = (formData.get("produkId") as string | null) || null;
  const customerId = (formData.get("customerId") as string | null) || null;

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
  const label = kind === "suratKft" ? "Surat Approval Standarisasi KFT" : kind === "buktiTtd" ? "Bukti TTD" : "Form Approval Standarisasi";
  const namaFile = `${timestamp} - ${label} - POA Standarisasi ${sanitizeForFileName(pengajuan.kodePI)} oleh ${sanitizeForFileName(session.name)}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  const { driveFileId } = await uploadFileToSurveyDrive(namaFile, mimeType, buffer);

  if (kind === "suratKft") {
    await prisma.poaStandarisasi.update({
      where: { id: pengajuanId },
      data: { suratApprovalStandarisasiKftPath: namaFile, suratApprovalStandarisasiKftDriveFileId: driveFileId },
    });
  } else if (kind === "buktiTtd") {
    if (!produkId || !customerId) throw new Error("Produk/dokter tidak valid.");
    await prisma.poaStandarisasiDokterApproval.updateMany({
      where: { produkId, customerId },
      data: { buktiTtdFilePath: namaFile, buktiTtdDriveFileId: driveFileId, sudahTtd: true },
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
