"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { invalidateBankSpesialisCache } from "@/lib/bankSpesialisStore";

/** Admin Bank Spesialis (docs/poa-bank-spesialis/): daftar produk kontes per spesialis, bisa diubah tanpa deploy. */

interface Result {
  ok: boolean;
  error?: string;
}

async function requireAdmin() {
  const session = await getCurrentUser();
  if (!session) throw new Error("Sesi tidak valid.");
  if (session.role !== "ADMIN") throw new Error("Hanya admin yang bisa mengubah Bank Spesialis.");
  return session;
}

export interface BankSpesialisAdminRow {
  id: string;
  spesialis: string;
  kodeProduk: string;
  namaProduk: string;
  keterangan: string | null;
  updatedByNip: string | null;
  updatedAt: string;
}

export async function getBankSpesialisAdminAction(): Promise<BankSpesialisAdminRow[]> {
  await requireAdmin();
  const rows: (Omit<BankSpesialisAdminRow, "updatedAt"> & { updatedAt: Date })[] = await prisma.bankSpesialis.findMany({
    orderBy: [{ spesialis: "asc" }, { namaProduk: "asc" }],
  });
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

function done(): Result {
  invalidateBankSpesialisCache();
  revalidatePath("/", "layout"); // layout memuat Bank untuk komponen client
  return { ok: true };
}

export async function addBankSpesialisAction(input: { spesialis: string; kodeProduk: string; keterangan?: string }): Promise<Result> {
  try {
    const session = await requireAdmin();
    const spesialis = input.spesialis.trim().toUpperCase();
    const kodeProduk = input.kodeProduk.trim();
    if (!spesialis || !kodeProduk) return { ok: false, error: "Spesialis dan kode produk wajib diisi." };
    const known = await prisma.bankSpesialis.findFirst({ where: { spesialis }, select: { id: true } });
    if (!known) return { ok: false, error: `Spesialis "${spesialis}" tidak ada di Bank. Pilih dari daftar yang ada.` };
    const product = await prisma.product.findUnique({ where: { kodeProduk }, select: { namaProduk: true } });
    if (!product) return { ok: false, error: `Kode produk ${kodeProduk} tidak ditemukan di master produk.` };
    const keterangan = input.keterangan?.trim() || null;
    await prisma.bankSpesialis.upsert({
      where: { spesialis_kodeProduk: { spesialis, kodeProduk } },
      update: { namaProduk: product.namaProduk, keterangan, updatedByNip: session.userId },
      create: { spesialis, kodeProduk, namaProduk: product.namaProduk, keterangan, updatedByNip: session.userId },
    });
    return done();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menyimpan." };
  }
}

export async function updateBankKeteranganAction(id: string, keterangan: string): Promise<Result> {
  try {
    const session = await requireAdmin();
    await prisma.bankSpesialis.update({ where: { id }, data: { keterangan: keterangan.trim() || null, updatedByNip: session.userId } });
    return done();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menyimpan." };
  }
}

export async function removeBankSpesialisAction(id: string): Promise<Result> {
  try {
    await requireAdmin();
    await prisma.bankSpesialis.delete({ where: { id } });
    return done();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menghapus." };
  }
}
