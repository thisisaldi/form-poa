"use client";

import { useMemo } from "react";
import { setBankSpesialis, type BankPayload } from "@/lib/bankSpesialis";

/**
 * Menaruh data Bank Spesialis (tabel BankSpesialis) ke indeks modul-level yang dibaca helper kontes
 * (getAllPakets, isProdukSesuaiSpesialisasi, ...) di sisi client. Diisi dari (app)/layout.tsx; `payload` null
 * (DB gagal dibaca) → biarkan indeks seed. Di-set saat render (sebelum anak dirender) supaya komponen anak
 * langsung membaca data yang benar; idempotent untuk payload yang sama.
 */
export function BankSpesialisProvider({ payload, children }: { payload: BankPayload | null; children: React.ReactNode }) {
  useMemo(() => {
    if (payload) setBankSpesialis(payload);
  }, [payload]);
  return <>{children}</>;
}
