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
import { getCustomersByOutlet, getDiskonByOutlet } from "@/app/actions/customer";
import { getDiscountsForOutlet, type ExodusDiscountPct } from "@/lib/exodusApi";
import { hargaST, type Product as ProductLite } from "@/lib/masterData";
import { mapWithConcurrency } from "@/lib/mapWithConcurrency";
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

export interface PusatDokterInput {
  customerId: string;
  jumlahPasien: string | null;
  jumlahHariPraktekPerBulan: string | null;
  resepPerPasienSt: string | null;
  entertainRp: string | null;
}

export interface PusatKpdmInput {
  customerId: string;
  nama: string;
  jabatan: string | null;
  entertainEstimasi: string | null;
}

export interface PusatProdukInput {
  kodeProduk: string;
  skemaPembayaran: "DISKON" | "DP";
  estimasiDiskonPct: string | null;
  estimasiDiskonDistributorPct: string | null;
  estimasiValueDpRp: string | null;
  estimasiBiayaListingRp: string | null;
  catatan: string | null;
  dokter: PusatDokterInput[];
}

export interface PusatCreateInput {
  hkaGroup: string;
  tipeStandarisasi: "PERIODIC" | "SISIPAN" | "PERMANEN";
  periodeBulan: string | null;
  /** yyyy-mm-dd dari MonthYearPicker (Target Finalisasi Standarisasi), sama seperti cabang. */
  estimasiTimelineSelesai: string | null;
  kpdmList: PusatKpdmInput[];
  produk: PusatProdukInput[];
}

function validPct(v: number | null): boolean {
  return v === null || (v >= 0 && v <= 100);
}

// ─── Konteks per produk untuk satu grup (preview Planning + status saat create) ─────────

export interface PusatProdukPreview {
  statusPengajuan: "BARU" | "PERPANJANGAN";
  /** DPL aktif paling lama berakhir di salah satu outlet grup (YYYYMM), untuk label "DPL habis". */
  dplAkhir: string | null;
  /** Diskon live Exodus dari outlet grup dengan sales 12 bln produk terbesar yang punya request. */
  diskon: ExodusDiscountPct | null;
  /** Dasar peringatan margin (sama seperti cabang), diambil dari outlet yang sama dengan `diskon`. */
  baseline: { sales12Bln: number; diskonLamaPct: number } | null;
}

function currentYm(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Status Pengajuan / DPL / diskon untuk produk di GRUP (docs/poa-standarisasi-pusat/04-layout-parity.md Q6/Q7):
 * PERPANJANGAN kalau di SALAH SATU outlet grup produk punya sales 3 bulan penuh terakhir DAN DPL aktif
 * (aturan cabang, di-OR lintas outlet); diskon & baseline margin dari outlet dengan sales 12 bln terbesar
 * yang punya request diskon live. Panggilan Exodus dibatasi concurrency 4 (grup bisa ~25 outlet).
 */
async function computePusatProdukContext(hkaGroup: string, kodeProdukList: string[]): Promise<Map<string, PusatProdukPreview>> {
  const result = new Map<string, PusatProdukPreview>(kodeProdukList.map((k) => [k, { statusPengajuan: "BARU", dplAkhir: null, diskon: null, baseline: null }]));
  if (!hkaGroup || kodeProdukList.length === 0) return result;
  const outlets: { kodePI: string }[] = await prisma.outlet.findMany({ where: { hkaGroup }, select: { kodePI: true } });
  const kodePIs = outlets.map((o) => o.kodePI);
  if (kodePIs.length === 0) return result;

  const now = new Date();
  const last3Months = [1, 2, 3].map((i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const ym = currentYm();

  const [salesRows, history, dplPerOutlet] = await Promise.all([
    prisma.outletSalesMonthly.findMany({
      where: { kodePI: { in: kodePIs }, itemKode: { in: kodeProdukList }, periode: { in: last3Months }, qty: { gt: 0 } },
      select: { kodePI: true, itemKode: true },
    }) as Promise<{ kodePI: string; itemKode: string }[]>,
    prisma.outletSalesHistory.findMany({
      where: { kodePI: { in: kodePIs }, itemKode: { in: kodeProdukList } },
      select: { kodePI: true, itemKode: true, totalSales12Bln: true },
    }) as Promise<{ kodePI: string; itemKode: string; totalSales12Bln: { toString(): string } }[]>,
    mapWithConcurrency(kodePIs, 4, async (kodePI) => ({ kodePI, dpl: await getDiskonByOutlet(kodePI).catch(() => []) })),
  ]);

  const hasSales = new Set(salesRows.map((r) => `${r.kodePI}|${r.itemKode}`));
  const sales12 = new Map(history.map((r) => [`${r.kodePI}|${r.itemKode}`, parseFloat(r.totalSales12Bln.toString()) || 0]));
  for (const { kodePI, dpl } of dplPerOutlet) {
    for (const c of dpl) {
      const ctx = result.get(c.kodeProduk);
      if (!ctx || !(c.prdAwal <= ym && ym <= c.prdAkhir)) continue;
      if ((ctx.dplAkhir ?? "") < c.prdAkhir) ctx.dplAkhir = c.prdAkhir;
      if (hasSales.has(`${kodePI}|${c.kodeProduk}`)) ctx.statusPengajuan = "PERPANJANGAN";
    }
  }

  // Diskon live: outlet dengan sales 12 bln terbesar per produk, dicoba berurutan sampai ada yang punya request (maks 3).
  const rankedByProduk = new Map<string, string[]>(
    kodeProdukList.map((k) => [k, kodePIs.filter((pi) => (sales12.get(`${pi}|${k}`) ?? 0) > 0).sort((a, b) => (sales12.get(`${b}|${k}`) ?? 0) - (sales12.get(`${a}|${k}`) ?? 0)).slice(0, 3)])
  );
  const candidatePIs = [...new Set([...rankedByProduk.values()].flat())];
  const discountsByPI = new Map<string, Map<string, ExodusDiscountPct> | null>(
    await mapWithConcurrency(candidatePIs, 4, async (pi) => [pi, await getDiscountsForOutlet(pi).catch(() => null)] as const)
  );
  for (const k of kodeProdukList) {
    for (const pi of rankedByProduk.get(k) ?? []) {
      const d = discountsByPI.get(pi)?.get(k);
      if (!d) continue;
      const ctx = result.get(k)!;
      ctx.diskon = d;
      ctx.baseline = { sales12Bln: sales12.get(`${pi}|${k}`) ?? 0, diskonLamaPct: d.principalPct + d.distributorPct };
      break;
    }
  }
  return result;
}

export async function getPusatProdukPreviewAction(hkaGroup: string, kodeProdukList: string[]): Promise<Record<string, PusatProdukPreview>> {
  const actor = await requireActor().catch(() => null);
  if (!actor || !canViewPusat(actor)) return {};
  return Object.fromEntries(await computePusatProdukContext(hkaGroup, [...new Set(kodeProdukList.filter(Boolean))]));
}

/** Dokter/KPDM di satu outlet grup untuk form BUAT (belum ada pengajuan). Outlet wajib bagian dari grup. */
export async function getPusatGroupDokterAction(hkaGroup: string, kodePI: string) {
  const actor = await requireActor().catch(() => null);
  if (!actor || !canViewPusat(actor) || !hkaGroup || !kodePI) return [];
  const outlet = await prisma.outlet.findUnique({ where: { kodePI }, select: { hkaGroup: true } });
  if (outlet?.hkaGroup !== hkaGroup) return [];
  return getCustomersByOutlet(kodePI);
}

/** Rumus sama dengan cabang (computeEstimasiPerBulan di poaStandarisasi.ts): pasien/hari × hari praktek/bln × resep/pasien. */
function computeEstimasiDokter(product: { hna: { toString(): string }; konversiPembagi: { toString(): string } | null }, jumlahPasien: number | null, hari: number | null, resep: number | null) {
  if (!jumlahPasien || !hari || !resep) return { estimasiQtyPerBulan: null, estimasiQtyUbPerBulan: null, estimasiNilaiRpPerBulan: null };
  const qty = jumlahPasien * hari * resep;
  const konversi = Number(product.konversiPembagi ?? 1) || 1;
  const hst = hargaST({ hna: product.hna.toString(), konversiPembagi: product.konversiPembagi?.toString() ?? null } as ProductLite);
  return { estimasiQtyPerBulan: qty, estimasiQtyUbPerBulan: Math.ceil(qty / konversi), estimasiNilaiRpPerBulan: Math.round(qty * hst) };
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
    if (input.kpdmList.length === 0) throw new Error("KPDM wajib dipilih minimal 1.");
    if (input.produk.length === 0) throw new Error("Tambahkan minimal 1 produk.");
    const kodes = input.produk.map((p) => p.kodeProduk);
    if (new Set(kodes).size !== kodes.length) throw new Error("Produk tidak boleh duplikat.");
    const products = await prisma.product.findMany({ where: { kodeProduk: { in: kodes } }, select: { kodeProduk: true, hna: true, konversiPembagi: true } });
    if (products.length !== kodes.length) throw new Error("Ada produk yang tidak ditemukan.");
    const productByKode = new Map<string, { hna: { toString(): string }; konversiPembagi: { toString(): string } | null }>(products.map((p: (typeof products)[number]) => [p.kodeProduk, p]));
    for (const p of input.produk) {
      if (!validPct(toNum(p.estimasiDiskonPct)) || !validPct(toNum(p.estimasiDiskonDistributorPct))) throw new Error("Persentase diskon harus 0–100.");
      if (p.dokter.length === 0) throw new Error("Setiap produk wajib punya minimal 1 dokter user.");
      if (new Set(p.dokter.map((d) => d.customerId)).size !== p.dokter.length) throw new Error("Dokter tidak boleh duplikat dalam satu produk.");
    }

    // KPDM dan dokter boleh dari outlet mana pun, asal terdaftar di salah satu outlet grup ini.
    const customerIds = [...new Set([...input.kpdmList.map((k) => k.customerId), ...input.produk.flatMap((p) => p.dokter.map((d) => d.customerId))])];
    const inGroup: { customerId: string }[] = await prisma.customerOutlet.findMany({ where: { customerId: { in: customerIds }, outlet: { hkaGroup } }, select: { customerId: true }, distinct: ["customerId"] });
    if (inGroup.length !== customerIds.length) throw new Error(`Ada KPDM/dokter yang tidak terdaftar di outlet grup ${hkaGroup}.`);

    // Status Pengajuan dihitung server (bukan dipercaya dari klien), sama seperti cabang.
    const context = await computePusatProdukContext(hkaGroup, kodes);

    const creatorLevel = hkaCreatorLevel(actor.role);
    const now = new Date();
    const id = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const pengajuan = await tx.poaStandarisasiPusat.create({
        data: {
          ownerId: actor.nip,
          hkaGroup,
          tipeStandarisasi: input.tipeStandarisasi,
          periodeBulan: input.tipeStandarisasi === "PERMANEN" ? null : toNum(input.periodeBulan),
          estimasiTimelineSelesai: input.estimasiTimelineSelesai ? new Date(input.estimasiTimelineSelesai) : null,
        },
      });
      await tx.poaStandarisasiPusatKpdm.createMany({
        data: input.kpdmList.map((k) => ({
          pengajuanId: pengajuan.id,
          customerId: k.customerId,
          namaSnapshot: k.nama,
          jabatanSnapshot: k.jabatan,
          entertainEstimasi: toNum(k.entertainEstimasi),
        })),
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
            estimasiBiayaListingRp: toNum(p.estimasiBiayaListingRp),
            statusPengajuan: context.get(p.kodeProduk)?.statusPengajuan ?? "BARU",
            catatan: p.catatan?.trim() || null,
          },
        });
        const product = productByKode.get(p.kodeProduk)!;
        await tx.poaStandarisasiPusatDokter.createMany({
          data: p.dokter.map((d) => {
            const jumlahPasien = toNum(d.jumlahPasien);
            const hari = toNum(d.jumlahHariPraktekPerBulan);
            const resep = toNum(d.resepPerPasienSt);
            return {
              produkId: row.id,
              customerId: d.customerId,
              wajib: true,
              jumlahPasien: jumlahPasien === null ? null : Math.round(jumlahPasien),
              jumlahHariPraktekPerBulan: hari === null ? null : Math.round(hari),
              resepPerPasienSt: resep,
              entertainRp: toNum(d.entertainRp),
              ...computeEstimasiDokter(product, jumlahPasien, hari, resep),
            };
          }),
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
  estimasiTimelineSelesai: string | null;
  kpdmList: { customerId: string; nama: string; jabatan: string | null; entertainEstimasi: number | null }[];
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
    estimasiBiayaListingRp: number | null;
    statusPengajuan: "BARU" | "PERPANJANGAN";
    catatan: string | null;
    approvals: { level: ApprovalLevel; status: string; autoApproved: boolean }[];
    dokter: {
      customerId: string; nama: string; spesialisasi: string; outlet: string; wajib: boolean; sudahTtd: boolean;
      jumlahPasien: number | null; jumlahHariPraktekPerBulan: number | null; resepPerPasienSt: number | null;
      estimasiQtyPerBulan: number | null; estimasiQtyUbPerBulan: number | null; estimasiNilaiRpPerBulan: number | null; entertainRp: number | null;
    }[];
  }[];
}

export async function getPusatDetail(id: string): Promise<PusatDetail | null> {
  const actor = await requireActor();
  if (!canViewPusat(actor)) return null;
  const p = await prisma.poaStandarisasiPusat.findUnique({
    where: { id },
    include: {
      owner: { select: { nip: true, name: true } },
      kpdmList: { orderBy: { createdAt: "asc" } },
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
    estimasiTimelineSelesai: p.estimasiTimelineSelesai?.toISOString() ?? null,
    kpdmList: p.kpdmList.map((k: (typeof p.kpdmList)[number]) => ({ customerId: k.customerId, nama: k.namaSnapshot, jabatan: k.jabatanSnapshot, entertainEstimasi: toNum(k.entertainEstimasi) })),
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
      estimasiBiayaListingRp: toNum(x.estimasiBiayaListingRp),
      statusPengajuan: x.statusPengajuan,
      catatan: x.catatan,
      approvals: x.approvals.map((a: (typeof x.approvals)[number]) => ({ level: a.level as ApprovalLevel, status: a.status, autoApproved: a.autoApproved })),
      dokter: x.dokter.map((d: (typeof x.dokter)[number]) => ({
        customerId: d.customerId,
        nama: d.customer.namaCustomer,
        spesialisasi: d.customer.spesialisasi,
        outlet: d.customer.outlets.map((o: (typeof d.customer.outlets)[number]) => o.outlet).find((o: { hkaGroup: string | null }) => o.hkaGroup === p.hkaGroup)?.namaOutlet ?? "-",
        wajib: d.wajib,
        sudahTtd: d.sudahTtd,
        jumlahPasien: d.jumlahPasien,
        jumlahHariPraktekPerBulan: d.jumlahHariPraktekPerBulan,
        resepPerPasienSt: toNum(d.resepPerPasienSt),
        estimasiQtyPerBulan: toNum(d.estimasiQtyPerBulan),
        estimasiQtyUbPerBulan: d.estimasiQtyUbPerBulan,
        estimasiNilaiRpPerBulan: toNum(d.estimasiNilaiRpPerBulan),
        entertainRp: toNum(d.entertainRp),
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
