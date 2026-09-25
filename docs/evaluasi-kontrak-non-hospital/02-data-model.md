# Evaluasi Kontrak Non-Hospital — Data Model

## 1. Sumber data per indikator / field

| Kebutuhan | Sumber | Status |
|---|---|---|
| Target sales bulanan | `TargetNonHospitalValue` (`namaGT`, `divisi`, `periode`, `target`), di-resolve ke personil lewat pemegang GT seperti Hospital (`resolveTargetForNipGroups`, `src/lib/targetHospitalValue.ts` — versi Non-Hospital perlu dibuat, lihat `src/lib/targetNonHospitalValue.ts`) | ✅ tabel ada; resolver ⬜ |
| Sales aktual | `OutletSalesValueMonthlyOmega` (sync dari MSSQL `mkt_insight.dbo.DIR10001B`, `DIVISI = 'OMG1'`) untuk outlet dengan `Outlet.namaGT` = GT personil; migration `20260925160000_add_outlet_sales_value_monthly_omega` | ✅ dibangun & terverifikasi 2026-09-25 (sync manual, 180 ribu baris / 53 dtk; belum ada scheduler) |
| Jumlah visit per bulan, hari kerja | MSSQL `exodus_sfe.dbo.visit_realizations` (visit, per hari aktif WIB) sudah dipakai KPI Hospital (`kpiCallActivitySync.ts`); **hari kerja** ≠ hari aktif — perlu kalender/`Kry_HariKerja` HR | 🟡 visit ✅, hari kerja ❓ |
| Jumlah SC Menang | ❓ tidak ada sumber yang dikenali | ❓ OQ-2 (blocking) |
| Absensi (hari telat) | SIPP `get=absensi` (`AbsTelatYN="Y"`), sudah dipakai KPI Hospital tetapi menghitung **jam** telat; Non-Hospital butuh **jumlah hari** telat | 🟡 API ✅, agregasi baru ⬜ |
| Tanggal masuk / awal kontrak | `SippEmployee.tglMasuk` (import file HR, sudah ada) | ✅ |
| Akhir kontrak, lama kontrak (bulan), cabang | ❓ tidak ada di file HR | ❓ OQ-5 (blocking) |
| Identitas lintas NIP | `SippEmployee` + `src/lib/kpiIdentity.ts` (nama sama = orang sama) | ✅ dipakai ulang |

Semua query yang menyentuh banyak personil sekaligus wajib mengikuti `docs/PERFORMANCE.md` §2 (batched, jumlah query tidak tumbuh per personil) — sama seperti `getKpiMonitoringData`.

Catatan: tabel `OutletSalesValueMonthlyOmega` (kembaran `OutletSalesValueMonthly` untuk `OMG1`) dibuat karena query langsung ke `DIR10001B` per render butuh ±36 detik; dari tabel ini halaman terisi dalam ±1,8 detik.

## 2. Model baru (dibangun 2026-09-25, migration `20260925150000_add_non_hospital_contract_evaluation`, belum dijalankan ke DB)

Perbedaan dari usulan awal: ada tabel ketiga `NonHospitalMonthlyEntry` (input bulanan SC Menang / hari telat, karena belum ada sumber otomatis), `systemRecommendationMonths` dan `totalScore` **nullable** (skor belum bisa dihitung selama band SC/Absensi belum ada — keputusan tetap boleh dicatat sebagai `DIUBAH` dengan alasan), dan target/sales memakai **GT dari `User.namaWilayah`** (bukan `MrOutletAssignment` seperti Hospital). Skema Prisma final ada di `prisma/schema.prisma` (blok "Evaluasi Kontrak Non-Hospital"); blok di bawah adalah usulan awal.

`KpiContractEvaluation` (sudah ada, `prisma/schema.prisma`) berbentuk Hospital: empat kolom `avg*Score` khusus 4 pilar Hospital. Non-Hospital punya indikator berbeda, jadi **tidak dipakai ulang**; dibuat model baru dengan indikator dalam JSON supaya skema indikator boleh berubah tanpa migration.

```prisma
// Data kontrak per personil Non-Hospital (diimpor ADMIN — OQ-5).
model NonHospitalContract {
  id             String   @id @default(uuid())
  nip            String
  user           User     @relation(fields: [nip], references: [nip], onDelete: Cascade)
  jabatan        String   // PSR | SUPERVISOR | AREA MANAGER | MANAGER (teks dari sumber)
  cabang         String?
  periodeBulan   Int      // lama kontrak berjalan, bulan
  awalKontrak    DateTime
  akhirKontrak   DateTime
  source         String   @default("IMPORT")
  importedAt     DateTime @default(now())

  @@unique([nip, akhirKontrak])
  @@index([akhirKontrak])
}

// Satu baris = satu keputusan evaluasi. Append-only: koreksi = baris baru.
model KpiNonHospitalEvaluation {
  id                String   @id @default(uuid())
  nip               String
  user              User     @relation("NhEvaluatee", fields: [nip], references: [nip], onDelete: Cascade)
  contractId        String
  contract          NonHospitalContract @relation(fields: [contractId], references: [id])

  windowMulai       String   // "YYYY-MM"
  windowAkhir       String   // "YYYY-MM"

  // Snapshot saat keputusan: per indikator {real, nilai, bobot, score} + data bulanan mentah.
  indicators        Json
  totalScore        Decimal  @db.Decimal(5, 2)
  dataNotes         String?  // catatan data bermasalah saat snapshot

  systemRecommendationMonths Int          // 12 | 9 | 6 | 0
  status            String               // DISETUJUI | DIUBAH
  decisionMonths    Int
  decisionReason    String?              // wajib jika status = DIUBAH
  developmentPlanNotes String

  decidedByNip      String
  decidedBy         User     @relation("NhEvaluator", fields: [decidedByNip], references: [nip])
  decidedAt         DateTime @default(now())

  @@index([nip, decidedAt])
  @@index([decidedByNip])
}
```

### Catatan desain

- **Snapshot vs live:** halaman daftar dan Detail Skor **dihitung live** dari data sumber (seperti `/kpi-perpanjangan`) selama status `BELUM_DIPUTUSKAN`. Begitu ada keputusan, angka **dibekukan** ke `indicators`/`totalScore` — supaya rincian yang dilihat saat audit sama dengan yang dilihat pemutus, walau data sumber berubah kemudian. `BELUM_DIPUTUSKAN` = personil tidak punya baris evaluasi untuk kontrak itu.
- **Append-only** (invariant): baris evaluasi tidak pernah di-`UPDATE`/`DELETE` oleh aplikasi; mengubah keputusan = `INSERT` baris baru. Status terkini = baris dengan `decidedAt` terbaru per `contractId`. Menjaga jejak "siapa memutuskan apa, kapan, karena apa".
- **Invariant server action:** `status = DIUBAH ⇔ decisionMonths ≠ systemRecommendationMonths` dan `decisionReason` tidak kosong; `developmentPlanNotes` selalu tidak kosong; `decisionMonths ∈ {0, 3, 6, 9, 12}`? ❓ set nilai valid belum dikonfirmasi (contoh prototipe hanya 0/6/9/12) — sampai jelas, terima 0/6/9/12.
- **`indicators` JSON** menyimpan skema indikator saat itu, jadi perubahan bobot di masa depan tidak mengubah evaluasi lama.
- **Tidak ada FK ke data mentah** (visit/absensi/sales): itu sumber eksternal/sync, bukan entitas milik fitur ini.
- Identitas orang mengikuti `kpiIdentity.ts`: satu orang dengan beberapa NIP mendapat satu baris kontrak dan satu evaluasi; NIP yang dipakai adalah NIP terbaru.
