/**
 * Product shape + hargaST — split out of masterData.ts (2026-08-19) so client
 * components can import them without pulling in masterData.ts's other
 * exports, which dynamically `import("@/lib/prisma")` (which itself imports
 * "fs" via the mock client) — Turbopack dev bundling doesn't tree-shake that
 * out of the client chunk, so any client component importing anything from
 * masterData.ts failed to compile ("Module not found: Can't resolve 'fs'").
 */

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
