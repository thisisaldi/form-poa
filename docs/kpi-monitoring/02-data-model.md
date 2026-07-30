# KPI Monitoring — Data Model

*(Proposal, belum diimplementasi. Field/tipe di sini adalah usulan awal — final setelah open questions di `01-business-rules.md` §7 terjawab.)*

## 1. Sumber data existing yang di-reuse (tidak ada perubahan skema)

| Indikator | Sumber | Fungsi/model existing |
|---|---|---|
| Sales Achievement | `PoaForm.target` (Rupiah, per periode) vs `OutletSalesValueMonthly` (real sales, hasil sync DIR10001B) | Logika sama seperti tab "Per MR" di `src/app/(app)/monitoring/page.tsx` — reuse `buildOrgMaps()` (`src/lib/targetCalculation.ts`) untuk rollup per role. |
| Customer Expansion (terkonfirmasi 2026-07-30) | `PsspKontrak` aktif (`prdAkhir >= periode berjalan`) per outlet yang di-cover MR — PSSP yang sudah habis TIDAK terhitung | `getActivePsspByOutlets()` (`src/app/actions/customer.ts`), sudah dipakai Summary page untuk `activeCustKeys`. |

Kedua sumber ini **read-only derive on demand** — tidak perlu tabel snapshot terpisah kecuali performa jadi masalah (Summary page tab "Per Outlet" sempat 58-74 detik untuk scope ADMIN company-wide, lihat `internal/TODO.md` #47 — pola query yang sama harus diwaspadai di sini, terutama kalau KPI Monitoring dibuka company-wide oleh ADMIN/GM).

## 2. Data baru yang perlu dibangun (tidak ada sama sekali di sistem hari ini)

Call Activity dan Kepatuhan Absensi **tidak punya data source apapun** — bukan cuma "belum di-expose", tapi genuinely tidak ada model/sync yang menyimpannya. Keputusan (dari klarifikasi user 2026-07-30): **input manual oleh atasan untuk kedua indikator ini, dirancang agar gampang diganti/disambungkan ke sync eksternal nanti** — pola yang sama seperti field manual lain di app ini yang kelak digantikan sync (contoh: `ProductTargetInput` yang manual, vs `OutletSalesMonthly` yang di-sync — dua pola ini sudah hidup berdampingan di kode yang sama, lihat `targetCalculation.ts`).

### Model baru: `KpiMonthlyEntry`

Satu baris = satu personil (MR/SPV/ASM/SM) × satu periode bulanan (`"YYYY-MM"`, sama format dengan `PoaForm.period` varian bulanan).

```prisma
model KpiMonthlyEntry {
  id        String   @id @default(cuid())
  nip       String
  user      User     @relation(fields: [nip], references: [nip])
  period    String   // "YYYY-MM"

  // --- Business Result: Sales Achievement (auto-derive, snapshot di sini biar
  //     histori gak berubah kalau target/actual di-edit belakangan) ---
  salesTargetRp   Decimal?
  salesActualRp   Decimal?
  salesAchievementPct Decimal? // salesActualRp / salesTargetRp * 100

  // --- Activity & Coverage: Call Activity (manual input, placeholder utk sync) ---
  callActivityRealisasi Int?     // realisasi kunjungan bulan ini
  callActivityStandar   Int?     // standar kunjungan personil ini (dari role, lihat 01-business-rules §2b)
  callActivitySource     String  @default("MANUAL") // "MANUAL" | "SYNC" -- ganti begitu integrasi eksternal ada
  callActivityInputByNip String?
  callActivityInputAt    DateTime?

  // --- Market Development: Customer Expansion (auto-derive dari PsspKontrak aktif) ---
  customerAktifCount Int?

  // --- Attitude: Kepatuhan Absensi (manual input, placeholder utk sync) ---
  absensiValue      Decimal? // unit TBD, lihat open question 01-business-rules §2d
  absensiSource     String  @default("MANUAL")
  absensiInputByNip String?
  absensiInputAt    DateTime?

  // --- Score per pilar (hasil band-mapping, dihitung ulang tiap kali entry berubah) ---
  salesScore    Int? // 40/55/70/85/100
  activityScore Int?
  customerScore Int?
  absensiScore  Int?
  totalScore    Decimal? // weighted sum, maks 100

  computedAt DateTime @updatedAt
  createdAt  DateTime @default(now())

  @@unique([nip, period])
  @@index([period])
}
```

Catatan desain:
- `salesTargetRp`/`salesActualRp`/`customerAktifCount` **di-snapshot**, bukan dihitung on-the-fly setiap render — supaya histori bulan lalu tidak berubah kalau ada koreksi data sync belakangan (pola sama seperti `PoaAuditLog` menyimpan snapshot, bukan hanya referensi live). Proses isi snapshot ini butuh job bulanan (mis. dijalankan awal bulan berikutnya, mirip `scripts/sync*.ts` yang sudah ada) — bukan dihitung realtime tiap kali halaman dibuka.
- `callActivitySource`/`absensiSource` sengaja string enum-like (bukan hardcode boolean) supaya gampang nambah sumber baru (mis. `"HRIS_SYNC"`) tanpa migration lagi saat integrasi eksternal akhirnya ada.
- Field score (`salesScore` dst) di-cache di row yang sama supaya query listing KPI Monitoring gak perlu re-run scoring logic tiap kali (band-mapping murah, tapi tetap — biar konsisten sama pola snapshot di atas).

### Model baru: `KpiContractEvaluation`

Agregasi di titik evaluasi kontrak (lihat `01-business-rules.md` §5 — window = periode kontrak berjalan, bukan kalender tetap).

```prisma
model KpiContractEvaluation {
  id       String @id @default(cuid())
  nip      String
  user     User   @relation(fields: [nip], references: [nip])

  periodeMulai String // "YYYY-MM", awal window kontrak yang dievaluasi
  periodeAkhir String // "YYYY-MM", akhir window (biasanya bulan evaluasi ini)

  avgSalesScore    Decimal
  avgActivityScore Decimal
  avgCustomerScore Decimal
  avgAbsensiScore  Decimal
  totalScore       Decimal // rata2 weighted-total dari seluruh KpiMonthlyEntry di window ini

  systemRecommendationMonths Int // hasil band §4: 12/9/6/0

  // Keputusan atasan -- boleh beda dari rekomendasi sistem, wajib alasan kalau beda
  decisionMonths Int
  decisionReason String? // wajib diisi kalau decisionMonths != systemRecommendationMonths

  // Wajib per memo: "Evaluasi Rencana Pengembangan Personil" + rasionalisasi ke direksi
  developmentPlanNotes String

  evaluatedByNip String // SM (untuk ASM/SPV/MR) atau NSM (untuk SM)
  evaluatedBy    User   @relation("KpiEvaluator", fields: [evaluatedByNip], references: [nip])
  evaluatedAt    DateTime @default(now())

  @@index([nip])
}
```

Catatan desain:
- `decisionMonths` terpisah dari `systemRecommendationMonths` supaya override atasan (memo eksplisit bilang "keputusan diusulkan atasan, tidak harus mengikuti rekomendasi asal ada penjelasan jelas dan logis") tercatat sebagai keputusan resmi, bukan menimpa angka sistem.
- Belum ada relasi eksplisit ke `PoaForm`/kontrak kerja HR — repo ini tidak punya model "kontrak kerja" (`User` tidak punya field masa kontrak/tanggal mulai). **Perlu diklarifikasi**: apakah tanggal mulai/akhir kontrak personil akan ditambahkan ke `User`, atau cukup dihitung manual oleh atasan tiap kali mengisi evaluasi (isi `periodeMulai`/`periodeAkhir` manual saat itu juga)? v1 disarankan opsi kedua (manual) supaya tidak butuh sumber data HR baru sekaligus.

## 3. Yang sengaja TIDAK dibangun di v1

- Sync otomatis untuk Call Activity/Absensi — menunggu keputusan integrasi eksternal (HRIS atau sistem lain). `callActivitySource`/`absensiSource` disiapkan supaya migrasi ke sync nanti tidak perlu ubah struktur tabel, cukup ganti nilai source + isi field via job baru.
- Perhitungan otomatis tanggal kontrak — lihat catatan `KpiContractEvaluation` di atas.
