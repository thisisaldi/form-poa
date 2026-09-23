# SP Non Sales Memo — UI & Access

## Role/access matrix (v1, asumsi kerja — lihat 01-business-rules.md §7 #3)

| Role | Lihat memo | Generate memo | Centang "sudah di-sign" |
|---|---|---|---|
| MR (owner pengajuan) | Ya, punya sendiri | Ya (trigger generate dari tab existing "Permintaan SP Non Sales") | Tidak |
| **Sales Support** (baru) | Ya, SEMUA memo lintas MR (company-wide dalam POA Standarisasi, asumsi §2) | Tidak (cuma proses yang sudah digenerate MR) | **Ya** — satu-satunya role yang bisa centang ini |
| ASM/SM/NSM | Sama seperti akses POA Standarisasi existing (`canViewPoaStandarisasi`, `authz.ts:864-875`) | Tidak | Tidak |
| ADMIN | Semua akses | Ya | Ya (ADMIN bypass, pola sama seperti `canEditPoaStandarisasiStep5`) |

Reuse `canViewPoaStandarisasi`/`canEditPoaStandarisasiStep5` (`authz.ts:864-893`) sebagai basis, tambah cabang baru untuk `Role.SALES_SUPPORT` — JANGAN bikin fungsi authz terpisah yang tidak terhubung ke pola existing.

## Halaman yang diusulkan

- **Tab "Permintaan SP Non Sales" existing** (`PoaStandarisasiWizard.tsx` Step 5) — tombol upload manual **diganti** tombol "Generate Memo" (MR-facing, isi field alasan dulu — lihat `02-data-model.md` `spNonSalesMemoAlasan` — baru generate). Tidak ada upload manual lagi di tab ini untuk memo (RESOLVED §1.3) — flow upload dokumen bebas existing (`PoaStandarisasiSpNonSalesDocument`) tetap ada terpisah kalau masih dibutuhkan untuk keperluan lain (lihat Non-goals).
- **Halaman baru untuk Sales Support** — listing semua memo yang perlu diproses, company-wide. Kemungkinan besar route baru (mis. `/sales-support` atau serupa) karena Sales Support tidak punya akses ke halaman POA Standarisasi biasa (scope dibatasi ke memo doang, bukan seluruh wizard). **Nama route & layout belum diputuskan** — bukan blocking, bisa didesain pas mulai implementasi, tapi perlu diingat ini HALAMAN BARU, bukan tambahan ke halaman existing.

## Non-goals v1

- **Tidak ada approval berlapis untuk status sign** — Sales Support centang sendiri, tidak ada pihak kedua yang confirm centangan itu (dikonfirmasi user, `01-business-rules.md` §1.3).
- **Tidak ada notifikasi ke Sales Support** kalau ada memo baru — mereka harus cek halaman listing sendiri (kecuali diputuskan lain belakangan).
- **Tidak menyentuh flow SP Non Sales existing** (upload manual dokumen bebas, `PoaStandarisasiSpNonSalesDocument`) di luar apa yang diganti langsung oleh flow generate memo ini.
