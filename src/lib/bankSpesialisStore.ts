/**
 * Server-only loader Bank Spesialis (tabel BankSpesialis). Dipanggil di layout (untuk BankSpesialisProvider) dan
 * di setiap titik server yang mengklasifikasi Produk Kontes (summary, export, target). Di-cache singkat per
 * proses; perubahan dari halaman Admin langsung membersihkan cache proses yang menjalankan action itu, replika
 * lain ikut sinkron dalam <= TTL. Gagal baca DB → indeks seed tetap dipakai (tidak di-cache, coba lagi).
 */
import { prisma } from "@/lib/prisma";
import { setBankSpesialis, type BankPayload } from "@/lib/bankSpesialis";

const TTL_MS = 30_000;
let cache: { payload: BankPayload; expiresAt: number } | null = null;

export function invalidateBankSpesialisCache(): void {
  cache = null;
}

export async function loadBankSpesialis(): Promise<BankPayload | null> {
  if (cache && cache.expiresAt > Date.now()) {
    setBankSpesialis(cache.payload); // proses ini bisa saja di-reload sejak terakhir diisi
    return cache.payload;
  }
  try {
    const rows: BankPayload["rows"] = await prisma.bankSpesialis.findMany({
      select: { spesialis: true, kodeProduk: true, namaProduk: true, keterangan: true },
      orderBy: [{ spesialis: "asc" }, { namaProduk: "asc" }],
    });
    const products: { kodeProduk: string; namaProduk: string }[] = rows.length
      ? await prisma.product.findMany({ where: { kodeProduk: { in: [...new Set(rows.map((r) => r.kodeProduk))] } }, select: { kodeProduk: true, namaProduk: true } })
      : [];
    const payload: BankPayload = { rows, masterNames: Object.fromEntries(products.map((p) => [p.kodeProduk, p.namaProduk])) };
    setBankSpesialis(payload);
    cache = { payload, expiresAt: Date.now() + TTL_MS };
    return payload;
  } catch (err) {
    console.error("[bankSpesialis] gagal baca BankSpesialis, memakai data seed:", err);
    return null;
  }
}
