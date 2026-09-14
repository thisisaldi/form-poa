# Target Non-Hospital Value — Data Model

## Data yang sudah ada (dipakai ulang, tanpa perubahan skema)

- `User.project` (`"OMEGA"`), `User.role` (`MR` untuk FF & SPV), `User.namaWilayah`/`User.kodeWilayah`, `User.isActive` — sumber kebenaran LIVE untuk "siapa pemegang GT sekarang" (lihat `01-business-rules.md` §"Resolusi pemegang GT"). Disinkron oleh `src/lib/sync/omegaUserSync.ts`, TIDAK disentuh oleh fitur ini.
- `getSubordinateMRNips` (`src/lib/authz.ts`) — dipakai ulang apa adanya untuk resolusi scope GT session NSM (ASM/SM/NSM → subtree MR), sama seperti `/api/target-value`. Fungsi ini generik terhadap project, sudah jalan untuk hospital. (2026-09-14: dulu dipakai buat `?nip=` rollup yang sekarang sudah dihapus — sekarang cuma dipakai internal buat auto-scope session NSM, bukan lagi query param, lihat `docs/API.md`.)
- `verifyBasicAuth` + `PoaDoctorsApiCredential` (`src/lib/apiBasicAuth.ts`) — kredensial Basic Auth yang sama dipakai ulang, tidak ada kredensial baru.

## Data baru (perlu migration)

```prisma
// Monthly Rupiah sales TARGET per territory (GT) untuk tim non-hospital
// (project OMEGA) — dari "internal/Target Non-Hospital (In Value).xlsx",
// satu sheet per area, kolom "TARGET yyyymm (PENGAJUAN)". Satu baris per
// (namaGT, periode); namaGT unik lintas divisi di sumbernya sendiri (baris
// grosir/PBF sudah berprefix "GROSIR " di Nama GT-nya).
//
// Beda dari TargetHospitalValue: TIDAK menyimpan nip/nama ASM & NSM (sumber
// Excel non-hospital cuma punya kolom FF & SM, tidak ada kolom ASM/NSM
// eksplisit per baris) — resolusi ASM/NSM subtree dilakukan LIVE lewat
// getSubordinateMRNips, bukan dari snapshot kolom tabel ini. namaMR di sini
// menyimpan nama "FF" sumber (istilah non-hospital untuk MR/SPV) — dinamai
// namaMR biar konsisten dgn TargetHospitalValue meski istilah sumbernya beda.
model TargetNonHospitalValue {
  id        String   @id @default(uuid())
  namaGT    String
  kodeGT    String?  // 2026-09-14, dari sheet STRUKTUR workbook sumbernya — lihat Catatan desain
  divisi    String // "RETAIL" | "GROSIR_PBF" — lihat 01-business-rules.md
  periode   String // YYYYMM, e.g. "202608"
  target    Decimal  @db.Decimal(18, 2)
  nipMR     String?
  namaMR    String
  nipSM     String?
  namaSM    String
  syncedAt  DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([namaGT, divisi, periode])
  @@index([periode])
  @@index([nipMR])
  @@index([divisi])
}
```

### Catatan desain

- **`kodeGT` (2026-09-14)** — dari workbook sumbernya sendiri, sheet "STRUKTUR" (per-outlet org structure dump, kolom "Kode GT"/"Nama GT"), di-lookup EXACT MATCH by Nama GT saat import (`scripts/importTargetNonHospitalValue.ts`). Dikonfirmasi 2026-09-14: SEMUA 347 distinct GT name di sheet target match 1 row STRUKTUR persis, ZERO collision (1 namaGT selalu 1 kodeGT dan sebaliknya) — beda dari hospital punya `TargetHospitalValue.kodeGT` yang MAYORITAS NULL (`Outlet.kodeGT` sendiri jarang ke-resolve di pipeline sync hospital, gap di data hulu, bukan gap di tabel/import ini). Nullable karena kalau STRUKTUR sheet gak punya baris utk GT itu (skenario belum pernah terjadi di data real, tapi secara struktur mungkin), tetap fallback null bukan gagal import.
- **`nipMR`/`nipSM` nullable, `namaMR`/`namaSM` tidak** — sama pola dgn `TargetHospitalValue`: baris tetap fully-attributable dari raw source text meski resolusi nip gagal (GT vacant/nama tidak match User manapun). `nipMR`/`nipSM` di kolom tabel ini adalah SNAPSHOT waktu import (buat audit trail/debug), BUKAN sumber kebenaran pemegang GT saat request — sumber kebenaran live tetap `User.namaWilayah` (lihat resolver `getCurrentGTsForOmegaSubtree`/`resolveCurrentOmegaGTHolder` di `01-business-rules.md`). Ini pola yang SAMA persis dgn hospital punya (komentar schema `TargetHospitalValue` baris 998-1008) — sengaja disamakan, bukan penyimpangan.
- **`divisi` sebagai `String` bukan enum Prisma baru** — cuma 2 nilai tetap dan tidak dipakai di logic bercabang kompleks (cuma filter WHERE); nambah enum Prisma untuk ini nambah 1 migration step tanpa manfaat nyata dibanding constraint di level aplikasi (skema `TargetHospitalValue` juga tidak pakai enum utk field serupa).
- **`@@unique([namaGT, divisi, periode])` — DIKOREKSI 2026-09-11 (semula `[namaGT, periode]` tanpa `divisi`)**: asumsi awal (namaGT unik lintas divisi, mirip `TargetHospitalValue`) TERBUKTI SALAH saat run import beneran — 4 GT ("PBF MEDAN 02", "LABUHAN BATU - SUMUT", "MEDAN 09", "GROSIR MALANG 09") muncul di KEDUA blok RETAIL dan GROSIR_PBF area yang sama dengan TARGET BEDA (bukan duplikat copy-paste — misal "MEDAN 09" RETAIL Rp79jt vs GROSIR_PBF Rp2.8jt, dua territory beneran yang kebetulan share nama). `ON CONFLICT` awalnya gagal (`cannot affect row a second time`) sebelum constraint dilebarkan. Konsekuensi: SUM tanpa `?kategori=` filter di API menjumlah KEDUA baris kalau namaGT-nya collide lintas divisi — ini DIINGINKAN (total across kategori), bukan bug.
- **Tidak ada tabel assignment baru** (beda dgn hospital yang punya `MrOutletAssignment`) — sengaja, karena `User.namaWilayah` sendiri SUDAH merupakan live assignment (di-upsert tiap `omegaUserSync` run), tidak butuh lapisan tambahan.
- **Company-wide/berat?** — `GET /api/target-value?divisi=non-hospital` tanpa scope (session ADMIN/Basic Auth) mengembalikan seluruh baris (all-GT × 2 periode, skala ~1000-2000 baris berdasarkan row count sheet) — sama scale dgn `/api/target-value?divisi=hospital` yang sudah production (lihat `docs/PERFORMANCE.md` §2 poin 4, pola yg sama dipakai: batched query, bukan N+1 per row). Tidak ada halaman company-wide baru yang dibangun di v1 ini (lihat Non-goals di `03-ui-and-access.md`), jadi tidak ada risiko baru di luar apa yang sudah ada di endpoint hospital-nya.

### Invariant

- `(namaGT, periode)` selalu unik.
- `namaMR`/`namaSM` selalu terisi (raw source text minimal), tidak pernah null/empty string untuk baris yang berhasil di-parse dari sumber (baris tanpa FF/SM name tidak dianggap baris data valid — sama filter dgn `importTargetHospitalValue.ts`, row butuh col A terisi & bukan header/TOTAL).
- `target` hanya diisi untuk periode yang MEMANG diajukan (kolom J/K numeric) — baris yang sudah ada dari import sebelumnya dan tidak ada nilai baru di source TIDAK di-nol-kan (upsert per periode yang ada nilainya saja, sama pola dgn hospital).
