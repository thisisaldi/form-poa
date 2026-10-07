"use server";

/**
 * POA Standarisasi Pusat (Hospital Key Account) — docs/poa-standarisasi-pusat/.
 * Produk x Grup HKA. Fase: Approval Atasan -> Approval User/Dokter -> Finalisasi
 * (Planning disatukan dengan create, sama seperti createPoaStandarisasiAction
 * cabang). Semua action mengembalikan `{ error }` alih-alih throw: production
 * Next.js memask pesan error server action.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isWriteBlocked, WRITE_BLOCKED_MESSAGE } from "@/lib/maintenance";
import { getCustomersByOutlet } from "@/app/actions/customer";
import { actionableRows, discountApprovalLevel, levelsUpTo, type ApprovalLevel, type ProdukApprovalRow } from "@/lib/discountApprovalLevel";
import { canApprovePusatLevel, canViewPusat, hkaCreatorLevel, isAutoApprovedLevel } from "@/lib/hka";
import type { Prisma, User } from "@prisma/client";

export type PusatResult = { error?: string; id?: string };

async function run(fn: () => Promise<string | void>): Promise<PusatResult> {
  try {
    const id = await fn();
    return id ? { id } : {};
  } catch (e) {
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) throw e;
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan." };
  }
}

async function requireActor(): Promise<User> {
  const session = await getCurrentUser();
  if (!session) throw new Error("Sesi tidak valid.");
  if (await isWriteBlocked(session.role)) throw new Error(WRITE_BLOCKED_MESSAGE);
  return prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

/** Owner (atau ADMIN) saja, dan hanya sebelum submit akhir. */
function canEditPusat(user: User, p: { ownerId: string; submittedAt: Date | null }): boolean {
  return !p.submittedAt && (user.role === "ADMIN" || p.ownerId === user.nip);
}

// ─── Create (Planning + snapshot approval) ───────────────────────────────────

export interface PusatProdukInput {
  kodeProduk: string;
  skemaPembayaran: "DISKON" | "DP";
  estimasiDiskonPct: string | null;
  estimasiDiskonDistributorPct: string | null;
  estimasiValueDpRp: string | null;
  catatan: string | null;
}

export interface PusatCreateInput {
  hkaGroup: string;
  tipeStandarisasi: "PERIODIC" | "SISIPAN" | "PERMANEN";
  periodeBulan: string | null;
  produk: PusatProdukInput[];
}

function validPct(v: number | null): boolean {
  return v === null || (v >= 0 && v <= 100);
}

export async function createPusatAction(input: PusatCreateInput): Promise<PusatResult> {
  return run(async () => {
    const actor = await requireActor();
    if (!actor.isHka && actor.role !== "ADMIN") throw new Error("Hanya tim HKA yang dapat membuat standarisasi pusat.");

    const hkaGroup = input.hkaGroup.trim();
    if (!hkaGroup || !(await prisma.outlet.findFirst({ where: { hkaGroup }, select: { kodePI: true } }))) throw new Error("Grup HKA tidak ditemukan.");
    if ((input.tipeStandarisasi === "PERIODIC" || input.tipeStandarisasi === "SISIPAN") && !toNum(input.periodeBulan)) {
      throw new Error("Periode wajib diisi untuk tipe Periodic/Sisipan.");
    }
    if (input.produk.length === 0) throw new Error("Tambahkan minimal 1 produk.");
    const kodes = input.produk.map((p) => p.kodeProduk);
    if (new Set(kodes).size !== kodes.length) throw new Error("Produk tidak boleh duplikat.");
    const found = await prisma.product.count({ where: { kodeProduk: { in: kodes } } });
    if (found !== kodes.length) throw new Error("Ada produk yang tidak ditemukan.");
    for (const p of input.produk) {
      if (!validPct(toNum(p.estimasiDiskonPct)) || !validPct(toNum(p.estimasiDiskonDistributorPct))) throw new Error("Persentase diskon harus 0–100.");
    }

    const creatorLevel = hkaCreatorLevel(actor.role);
    const now = new Date();
    const id = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const pengajuan = await tx.poaStandarisasiPusat.create({
        data: {
          ownerId: actor.nip,
          hkaGroup,
          tipeStandarisasi: input.tipeStandarisasi,
          periodeBulan: input.tipeStandarisasi === "PERMANEN" ? null : toNum(input.periodeBulan),
        },
      });
      let waiting = 0;
      for (const p of input.produk) {
        const row = await tx.poaStandarisasiPusatProduk.create({
          data: {
            pengajuanId: pengajuan.id,
            kodeProduk: p.kodeProduk,
            skemaPembayaran: p.skemaPembayaran,
            estimasiDiskonPct: toNum(p.estimasiDiskonPct),
            estimasiDiskonDistributorPct: toNum(p.estimasiDiskonDistributorPct),
            estimasiValueDpRp: toNum(p.estimasiValueDpRp),
            catatan: p.catatan?.trim() || null,
          },
        });
        // Level dari diskon PI (skema DP / kosong = 0% = ASM), sama dengan cabang.
        const pct = p.skemaPembayaran === "DISKON" ? toNum(p.estimasiDiskonPct) ?? 0 : 0;
        const data = levelsUpTo(discountApprovalLevel(pct)).map((level) => {
          const auto = isAutoApprovedLevel(level, creatorLevel);
          if (!auto) waiting++;
          return {
            produkId: row.id,
            level,
            status: auto ? ("DISETUJUI" as const) : ("MENUNGGU" as const),
            autoApproved: auto,
            decidedByNip: auto ? actor.nip : null,
            decidedAt: auto ? now : null,
          };
        });
        await tx.poaStandarisasiPusatProdukApproval.createMany({ data });
      }
      // Semua level otomatis lolos -> langsung ke fase dokter.
      if (waiting === 0) await tx.poaStandarisasiPusat.update({ where: { id: pengajuan.id }, data: { currentPhase: "APPROVAL_USER_DOKTER" } });
      return pengajuan.id;
    });
    return id;
  });
}

// ─── Read ────────────────────────────────────────────────────────────────────

export interface PusatListRow {
  id: string;
  hkaGroup: string;
  ownerName: string;
  currentPhase: string;
  submittedAt: string | null;
  createdAt: string;
  produk: string[];
}

export async function listPusatAction(): Promise<PusatListRow[]> {
  const actor = await requireActor();
  if (!canViewPusat(actor)) return [];
  const rows = await prisma.poaStandarisasiPusat.findMany({
    include: { owner: { select: { name: true } }, produk: { select: { id: true, product: { select: { namaProduk: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    hkaGroup: r.hkaGroup,
    ownerName: r.owner.name,
    currentPhase: r.currentPhase,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    produk: r.produk.map((p: (typeof r.produk)[number]) => p.product.namaProduk),
  }));
}

export interface PusatDetail {
  id: string;
  hkaGroup: string;
  tipeStandarisasi: string;
  periodeBulan: number | null;
  currentPhase: "APPROVAL_ATASAN" | "APPROVAL_USER_DOKTER" | "FINALISASI";
  submittedAt: string | null;
  ownerName: string;
  canEdit: boolean;
  myLevels: ApprovalLevel[];
  produk: {
    id: string;
    kodeProduk: string;
    namaProduk: string;
    skemaPembayaran: "DISKON" | "DP";
    estimasiDiskonPct: number | null;
    estimasiDiskonDistributorPct: number | null;
    estimasiValueDpRp: number | null;
    catatan: string | null;
    approvals: { level: ApprovalLevel; status: string; autoApproved: boolean }[];
    dokter: { customerId: string; nama: string; spesialisasi: string; outlet: string; wajib: boolean; sudahTtd: boolean }[];
  }[];
}

export async function getPusatDetail(id: string): Promise<PusatDetail | null> {
  const actor = await requireActor();
  if (!canViewPusat(actor)) return null;
  const p = await prisma.poaStandarisasiPusat.findUnique({
    where: { id },
    include: {
      owner: { select: { nip: true, name: true } },
      produk: {
        include: {
          product: { select: { namaProduk: true } },
          approvals: true,
          dokter: { include: { customer: { select: { id: true, namaCustomer: true, spesialisasi: true, outlets: { select: { outlet: { select: { kodePI: true, namaOutlet: true, hkaGroup: true } } } } } } } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!p) return null;
  const myLevels = (["ASM", "SM", "NSM", "ASD", "SD"] as ApprovalLevel[]).filter((l) => canApprovePusatLevel(actor, l));
  return {
    id: p.id,
    hkaGroup: p.hkaGroup,
    tipeStandarisasi: p.tipeStandarisasi,
    periodeBulan: p.periodeBulan,
    currentPhase: p.currentPhase,
    submittedAt: p.submittedAt?.toISOString() ?? null,
    ownerName: p.owner.name,
    canEdit: canEditPusat(actor, p),
    myLevels,
    produk: p.produk.map((x: (typeof p.produk)[number]) => ({
      id: x.id,
      kodeProduk: x.kodeProduk,
      namaProduk: x.product.namaProduk,
      skemaPembayaran: x.skemaPembayaran,
      estimasiDiskonPct: toNum(x.estimasiDiskonPct),
      estimasiDiskonDistributorPct: toNum(x.estimasiDiskonDistributorPct),
      estimasiValueDpRp: toNum(x.estimasiValueDpRp),
      catatan: x.catatan,
      approvals: x.approvals.map((a: (typeof x.approvals)[number]) => ({ level: a.level as ApprovalLevel, status: a.status, autoApproved: a.autoApproved })),
      dokter: x.dokter.map((d: (typeof x.dokter)[number]) => ({
        customerId: d.customerId,
        nama: d.customer.namaCustomer,
        spesialisasi: d.customer.spesialisasi,
        outlet: d.customer.outlets.map((o: (typeof d.customer.outlets)[number]) => o.outlet).find((o: { hkaGroup: string | null }) => o.hkaGroup === p.hkaGroup)?.namaOutlet ?? "-",
        wajib: d.wajib,
        sudahTtd: d.sudahTtd,
      })),
    })),
  };
}

/** Outlet di grup HKA — dasar pemilih dokter dua langkah (outlet -> dokter). */
export async function getPusatGroupOutletsAction(hkaGroup: string): Promise<{ kodePI: string; namaOutlet: string }[]> {
  const actor = await requireActor();
  if (!canViewPusat(actor) || !hkaGroup) return [];
  return prisma.outlet.findMany({ where: { hkaGroup }, select: { kodePI: true, namaOutlet: true }, orderBy: { namaOutlet: "asc" } });
}

/** Daftar grup HKA yang tersedia (untuk form buat). */
export async function getHkaGroupsAction(): Promise<{ hkaGroup: string; jumlahOutlet: number }[]> {
  const actor = await requireActor();
  if (!canViewPusat(actor)) return [];
  const rows = await prisma.outlet.groupBy({ by: ["hkaGroup"], where: { hkaGroup: { not: null } }, _count: { kodePI: true }, orderBy: { hkaGroup: "asc" } });
  return rows.map((r: (typeof rows)[number]) => ({ hkaGroup: r.hkaGroup as string, jumlahOutlet: r._count.kodePI }));
}

/** Dokter di satu outlet grup (Nexus-primary untuk spesialisasi — bukan getCustomersByOutletSpesialisasi). Outlet wajib bagian dari grup pengajuan. */
export async function getPusatDokterOptionsAction(pengajuanId: string, kodePI: string) {
  const actor = await requireActor();
  if (!canViewPusat(actor)) return [];
  const pengajuan = await prisma.poaStandarisasiPusat.findUnique({ where: { id: pengajuanId }, select: { hkaGroup: true } });
  const outlet = await prisma.outlet.findUnique({ where: { kodePI }, select: { hkaGroup: true } });
  if (!pengajuan || outlet?.hkaGroup !== pengajuan.hkaGroup) return [];
  return getCustomersByOutlet(kodePI);
}

// ─── Fase 1: Approval Atasan ─────────────────────────────────────────────────

export async function approvePusatAction(id: string, level: ApprovalLevel, decision: "DISETUJUI" | "DITOLAK", produkIds?: string[]): Promise<PusatResult> {
  return run(async () => {
    const actor = await requireActor();
    const pengajuan = await prisma.poaStandarisasiPusat.findUnique({ where: { id } });
    if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
    if (pengajuan.currentPhase !== "APPROVAL_ATASAN") throw new Error("Pengajuan tidak sedang di fase Approval Atasan.");
    if (!canApprovePusatLevel(actor, level)) throw new Error("Anda tidak berhak melakukan approval di level ini.");

    const rows: ProdukApprovalRow[] = (await prisma.poaStandarisasiPusatProdukApproval.findMany({
      where: { produk: { pengajuanId: id } },
      select: { produkId: true, level: true, status: true },
    })) as ProdukApprovalRow[];
    const targets = actionableRows(rows, level).filter((r) => !produkIds || produkIds.includes(r.produkId));
    if (targets.length === 0) throw new Error("Tidak ada produk yang menunggu persetujuan Anda di level ini.");

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // status: MENUNGGU di where = idempoten kalau dua klik/approver bersamaan.
      await tx.poaStandarisasiPusatProdukApproval.updateMany({
        where: { produkId: { in: targets.map((t) => t.produkId) }, level, status: "MENUNGGU" },
        data: { status: decision, decidedByNip: actor.nip, decidedAt: new Date() },
      });
      const remaining = await tx.poaStandarisasiPusatProdukApproval.count({ where: { produk: { pengajuanId: id }, status: { not: "DISETUJUI" } } });
      if (remaining === 0) await tx.poaStandarisasiPusat.update({ where: { id }, data: { currentPhase: "APPROVAL_USER_DOKTER" } });
    });
    revalidatePath(`/poa-standarisasi/pusat/${id}`);
  });
}

// ─── Fase 2: Approval User/Dokter ────────────────────────────────────────────

async function loadProdukForEdit(produkId: string, actor: User) {
  const produk = await prisma.poaStandarisasiPusatProduk.findUnique({ where: { id: produkId }, include: { pengajuan: true } });
  if (!produk) throw new Error("Produk tidak ditemukan.");
  if (!canEditPusat(actor, produk.pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (produk.pengajuan.currentPhase !== "APPROVAL_USER_DOKTER") throw new Error("Pengajuan tidak sedang di fase Approval User/Dokter.");
  return produk;
}

export async function addPusatDokterAction(produkId: string, customerId: string): Promise<PusatResult> {
  return run(async () => {
    const actor = await requireActor();
    const produk = await loadProdukForEdit(produkId, actor);
    // Dokter harus terdaftar di salah satu outlet pada grup pengajuan.
    const inGroup = await prisma.customerOutlet.findFirst({ where: { customerId, outlet: { hkaGroup: produk.pengajuan.hkaGroup } }, select: { id: true } });
    if (!inGroup) throw new Error(`Dokter ini tidak terdaftar di outlet grup ${produk.pengajuan.hkaGroup}.`);
    await prisma.poaStandarisasiPusatDokter.upsert({
      where: { produkId_customerId: { produkId, customerId } },
      update: {},
      create: { produkId, customerId, wajib: true },
    });
    revalidatePath(`/poa-standarisasi/pusat/${produk.pengajuanId}`);
  });
}

export async function removePusatDokterAction(produkId: string, customerId: string): Promise<PusatResult> {
  return run(async () => {
    const produk = await loadProdukForEdit(produkId, await requireActor());
    await prisma.poaStandarisasiPusatDokter.deleteMany({ where: { produkId, customerId } });
    revalidatePath(`/poa-standarisasi/pusat/${produk.pengajuanId}`);
  });
}

export async function setPusatDokterTtdAction(produkId: string, customerId: string, sudahTtd: boolean): Promise<PusatResult> {
  return run(async () => {
    const produk = await loadProdukForEdit(produkId, await requireActor());
    await prisma.poaStandarisasiPusatDokter.updateMany({ where: { produkId, customerId }, data: { sudahTtd } });
    revalidatePath(`/poa-standarisasi/pusat/${produk.pengajuanId}`);
  });
}

/** Fase dokter -> Finalisasi: tiap produk minimal 1 dokter, semua dokter wajib sudah TTD. */
export async function advancePusatToFinalisasiAction(id: string): Promise<PusatResult> {
  return run(async () => {
    const actor = await requireActor();
    const p = await prisma.poaStandarisasiPusat.findUnique({ where: { id }, include: { produk: { include: { dokter: true, product: { select: { namaProduk: true } } } } } });
    if (!p) throw new Error("Pengajuan tidak ditemukan.");
    if (!canEditPusat(actor, p)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
    if (p.currentPhase !== "APPROVAL_USER_DOKTER") throw new Error("Pengajuan tidak sedang di fase Approval User/Dokter.");
    for (const x of p.produk) {
      if (x.dokter.length === 0) throw new Error(`${x.product.namaProduk}: wajib punya minimal 1 dokter.`);
      if (x.dokter.some((d: (typeof x.dokter)[number]) => d.wajib && !d.sudahTtd)) throw new Error(`${x.product.namaProduk}: masih ada dokter wajib yang belum TTD.`);
    }
    await prisma.poaStandarisasiPusat.update({ where: { id }, data: { currentPhase: "FINALISASI" } });
    revalidatePath(`/poa-standarisasi/pusat/${id}`);
  });
}

// ─── Fase 3: Finalisasi ──────────────────────────────────────────────────────

/** Submit akhir — menetapkan pengajuan pusat final; gateway cabang membaca `submittedAt` ini. */
export async function submitPusatAction(id: string): Promise<PusatResult> {
  return run(async () => {
    const actor = await requireActor();
    const p = await prisma.poaStandarisasiPusat.findUnique({ where: { id } });
    if (!p) throw new Error("Pengajuan tidak ditemukan.");
    if (!canEditPusat(actor, p)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
    if (p.currentPhase !== "FINALISASI") throw new Error("Pengajuan belum di fase Finalisasi.");
    await prisma.poaStandarisasiPusat.update({ where: { id }, data: { submittedAt: new Date() } });
    revalidatePath(`/poa-standarisasi/pusat/${id}`);
  });
}
