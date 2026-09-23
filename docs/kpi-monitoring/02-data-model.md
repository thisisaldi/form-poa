# KPI Monitoring — Data Model

*(Model diimplementasikan 2026-07-30 — migration `20260730115119_add_kpi_monitoring_models`, `prisma/schema.prisma:912-997`. Field/tipe di bawah ini mengikuti skema yang benar-benar berjalan di production; perbedaan terhadap proposal awal dicatat eksplisit di masing-masing bagian. Open questions yang masih terbuka dari `01-business-rules.md` §7 tetap berlaku dan dapat memicu perubahan skema di masa depan.)*

## 1. Sumber data existing yang digunakan ulang (tidak ada perubahan skema)

| Indikator | Sumber | Fungsi/model existing |
|---|---|---|
| Sales Achievement | `PoaForm.target` (Rupiah, per periode) dibandingkan `OutletSalesValueMonthly` (real sales, hasil sync DIR10001B) | Logika sama dengan tab "Per MR" di `src/app/(app)/monitoring/page.tsx` — menggunakan ulang `buildOrgMaps()` (`src/lib/targetCalculation.ts`) untuk rollup per role. |
| Customer Expansion (terkonfirmasi 2026-07-30) | `PsspKontrak` aktif (`prdAkhir >= periode berjalan`) per outlet yang dicakup MR — PSSP yang sudah habis TIDAK dihitung | `getActivePsspByOutlets()` (`src/app/actions/customer.ts`), sudah dipakai halaman Summary untuk `activeCustKeys`. |

⚠️ **Koreksi 2026-09-08**: baris Sales Achievement di atas sudah usang — kode v1 sebenarnya mencocokkan `period` bulanan ("YYYY-MM") langsung ke `PoaForm.period` yang kuartalan ("YYYY-QN"), jadi `salesTargetRp` selalu 0 sejak awal (bug, bukan by-design). Diganti ke `TargetHospitalValue.target` (bulanan asli, tanpa konversi kuartal) — lihat `README.md` update 2026-09-08 dan `01-business-rules.md` §1 untuk detail.

Kedua sumber ini bersifat **read-only, diturunkan (derive) sesuai permintaan (on demand)** — verifikasi 2026-08-05 mengonfirmasi ini masih menjadi cara kerja v1 yang sebenarnya (lihat §"Catatan desain — status implementasi snapshot" di bawah untuk detailnya), bukan hanya rencana. Tidak dibutuhkan tabel snapshot terpisah kecuali performa menjadi masalah (halaman Summary tab "Per Outlet" pernah membutuhkan 58-74 detik untuk scope ADMIN company-wide, lihat `docs/TODO.md` #47 — pola query yang sama harus diwaspadai di sini, terutama apabila KPI Monitoring dibuka company-wide untuk ADMIN/GM). Lihat juga cross-reference eksplisit ke `docs/PERFORMANCE.md` §5, yang menjadikan hal ini constraint wajib begitu akses diperluas melebihi ADMIN-only.

## 2. Data baru yang perlu dibangun (tidak ada sama sekali di sistem sebelum v1)

Call Activity dan Kepatuhan Absensi **tidak memiliki sumber data apa pun di v1** — bukan sekadar "belum di-expose", melainkan memang tidak ada model/sync yang menyimpannya saat spesifikasi ini ditulis (2026-07-30). Keputusan waktu itu: **input manual oleh atasan untuk kedua indikator ini, dirancang agar mudah diganti/disambungkan ke sync eksternal nanti** — pola yang sama seperti field manual lain di aplikasi ini yang kelak digantikan sync (contoh: `ProductTargetInput` yang manual, versus `OutletSalesMonthly` yang sudah di-sync — kedua pola ini sudah hidup berdampingan pada kode yang sama, lihat `targetCalculation.ts`).

🟢 Sejak itu keduanya sudah punya sync eksternal — Absensi via SIPP (2026-08-24), Call Activity via Exodus (2026-09-08, lihat `01-business-rules.md` §2b) — input manual tetap ada sebagai override (menang atas sync berikutnya), bukan digantikan.

### Model: `KpiMonthlyEntry`

Satu baris = satu personil (MR/SPV/ASM/SM) × satu periode bulanan (`"YYYY-MM"`, format sama dengan varian bulanan `PoaForm.period`).

```prisma
model KpiMonthlyEntry {
  id     String @id @default(uuid())
  nip    String
  user   User   @relation(fields: [nip], references: [nip], onDelete: Cascade)
  period String // "YYYY-MM"

  // Business Result: Sales Achievement (50%) — auto-derived snapshot, same
  // source as Monitoring page's "Per MR" tab (PoaForm.target vs
  // OutletSalesValueMonthly).
  salesTargetRp       Decimal? @db.Decimal(18, 2)
  salesActualRp       Decimal? @db.Decimal(18, 2)
  salesAchievementPct Decimal? @db.Decimal(7, 2)

  // Activity & Coverage: Call Activity (25%) — manual input by atasan for v1,
  // no realized-visit data source exists anywhere else in this app (overlaps
  // docs/TODO.md #38/#25, both still unresolved).
  callActivityRealisasi  Int?
  callActivityStandar    Int? // working assumption: MR/SPV=10, ASM=5, SM=3 (§2b)
  callActivitySource     String    @default("MANUAL") // "MANUAL" | future sync source key
  callActivityInputByNip String?
  callActivityInputAt    DateTime?

  // Market Development: Customer Expansion (15%) — auto-derived from active
  // PSSP contracts (getActivePsspByOutlets), working assumption per §2c.
  customerAktifCount Int?

  // Attitude: Kepatuhan Absensi (10%) — manual input by atasan for v1, no
  // attendance data source exists anywhere in this app.
  // Update 2026-08-24: implemented — src/lib/sync/kpiAbsensiSync.ts fills this
  // on-demand (ADMIN-triggered, not a cron) from the SIPP Trade Marketing API
  // (get=absensi), unless the row's absensiSource is already "MANUAL" (manual
  // always wins over sync). PTID comes from User.sippAbsPtId, seeded from the HR
  // master file (scripts/importSippPtidFromHrFile.ts) — see
  // 01-business-rules.md §2d.
  absensiValue      Decimal?  @db.Decimal(6, 2) // working assumption: avg jam keterlambatan/bulan (§2d)
  absensiSource     String    @default("MANUAL")
  absensiInputByNip String?
  absensiInputAt    DateTime?

  // Cached band scores (0/40/55/70/85/100) + weighted total, recomputed
  // whenever an input above changes — avoids re-running band logic on every
  // listing render.
  salesScore    Int?
  activityScore Int?
  customerScore Int?
  absensiScore  Int?
  totalScore    Decimal? @db.Decimal(5, 2)

  computedAt DateTime @updatedAt
  createdAt  DateTime @default(now())

  @@unique([nip, period])
  @@index([period])
}
```

Catatan desain:
- `salesTargetRp`/`salesActualRp`/`customerAktifCount` **dirancang untuk di-snapshot**, bukan dihitung on-the-fly setiap render — supaya histori bulan lalu tidak berubah apabila ada koreksi data sync belakangan (pola yang sama seperti `PoaAuditLog` menyimpan snapshot, bukan sekadar referensi live). Proses pengisian snapshot ini membutuhkan job bulanan (misalnya dijalankan pada awal bulan berikutnya, mirip `scripts/sync*.ts` yang sudah ada) — bukan dihitung realtime setiap kali halaman dibuka.
- `callActivitySource`/`absensiSource` sengaja berbentuk string enum-like (bukan boolean hardcode) supaya mudah menambah sumber baru (misalnya `"HRIS_SYNC"` atau `"EXODUS_SYNC"`) tanpa migration lagi ketika integrasi eksternal akhirnya tersedia.
- Field score (`salesScore` dan seterusnya) dirancang untuk di-cache pada row yang sama supaya query listing KPI Monitoring tidak perlu menjalankan ulang scoring logic setiap kali (band-mapping murah secara komputasi, tetapi tetap — agar konsisten dengan pola snapshot di atas).

⚠️ **Catatan desain — status implementasi snapshot (diverifikasi 2026-08-05, koreksi terhadap desain di atas)**: field snapshot (`salesTargetRp`, `salesActualRp`, `salesAchievementPct`, `customerAktifCount`) dan seluruh field skor (`salesScore`, `activityScore`, `customerScore`, `absensiScore`, `totalScore`) **tidak pernah ditulis oleh kode v1**. Satu-satunya tempat `KpiMonthlyEntry` di-upsert adalah `saveKpiManualInputAction` (`src/app/actions/kpi.ts:232-277`), dan `upsert` tersebut hanya menyentuh `callActivityRealisasi`/`callActivityStandar`/`callActivityInputByNip`/`callActivityInputAt`/`absensiValue`/`absensiInputByNip`/`absensiInputAt` — field manual saja. Listing `/kpi-perpanjangan` (`getKpiMonitoringData`, `src/app/actions/kpi.ts:74-224`) menghitung Sales Achievement, Customer Expansion, dan seluruh skor **secara live setiap render**, langsung dari `PoaForm`/`OutletSalesValueMonthly`/`getActivePsspByOutlets`, tanpa pernah membaca atau menulis kolom snapshot di atas. Konsekuensinya: di database production hari ini, kolom-kolom snapshot tersebut selalu `null` untuk setiap baris `KpiMonthlyEntry` yang ada. Job bulanan yang disebut pada poin pertama di atas **belum dibangun sama sekali**. Ini bukan berarti desain snapshot salah — cross-reference `docs/PERFORMANCE.md` §5 tetap merekomendasikan pola ini begitu akses diperluas melampaui ADMIN-only — tetapi klaim "sudah di-snapshot" pada dokumen versi sebelumnya tidak akurat untuk keadaan kode v1 saat ini. Perlakukan sebagai item implementasi yang masih terbuka, bukan sebagai constraint yang sudah terpenuhi.

### Invariant `KpiMonthlyEntry` (`docs/sdd/04-quality-checklist.md` §12)

- **Satu entry per personil per bulan**: `@@unique([nip, period])` (`prisma/schema.prisma:957`) menjamin tidak mungkin ada lebih dari satu `KpiMonthlyEntry` untuk kombinasi `nip` + `period` yang sama. `saveKpiManualInputAction` menggunakan `upsert` dengan key komposit ini (`src/app/actions/kpi.ts:244-246`), sehingga panggilan berulang untuk personil dan bulan yang sama selalu memperbarui baris yang sama, bukan membuat duplikat.
- **Bukan append-only**: berbeda dari `PoaAuditLog`, `KpiMonthlyEntry` bersifat mutable — `saveKpiManualInputAction` melakukan `update` in-place pada field manual (`src/app/actions/kpi.ts:257-273`), dan `computedAt` (`@updatedAt`) berubah setiap kali baris disentuh. Tidak ada jejak riwayat perubahan input manual (nilai lama tertimpa tanpa audit trail terpisah) — apabila audit trail dibutuhkan di masa depan, ini adalah gap yang perlu ditangani, bukan sesuatu yang sudah ada.
- `nip` selalu merujuk `User` yang valid (`onDelete: Cascade` pada relasi, `prisma/schema.prisma:915`) — entry ikut terhapus apabila `User`-nya dihapus, bukan menjadi baris yatim.

## 3. Model: `KpiContractEvaluation`

Agregasi pada titik evaluasi kontrak (lihat `01-business-rules.md` §5 — window = periode kontrak berjalan, bukan kalender tetap).

```prisma
model KpiContractEvaluation {
  id   String @id @default(uuid())
  nip  String
  user User   @relation("KpiEvaluatee", fields: [nip], references: [nip], onDelete: Cascade)

  periodeMulai String // "YYYY-MM"
  periodeAkhir String // "YYYY-MM"

  avgSalesScore    Decimal @db.Decimal(5, 2)
  avgActivityScore Decimal @db.Decimal(5, 2)
  avgCustomerScore Decimal @db.Decimal(5, 2)
  avgAbsensiScore  Decimal @db.Decimal(5, 2)
  totalScore       Decimal @db.Decimal(5, 2)

  systemRecommendationMonths Int // band result: 12/9/6/0

  // Atasan's actual decision — may differ from the system recommendation
  // ("keputusan diusulkan atasan, tidak harus mengikuti rekomendasi asal ada
  // penjelasan jelas dan logis"). decisionReason is required at the
  // server-action layer whenever decisionMonths != systemRecommendationMonths.
  decisionMonths Int
  decisionReason String?

  // Wajib per memo: "Evaluasi Rencana Pengembangan Personil" + rasionalisasi ke direksi.
  developmentPlanNotes String

  evaluatedByNip String
  evaluatedBy    User     @relation("KpiEvaluator", fields: [evaluatedByNip], references: [nip])
  evaluatedAt    DateTime @default(now())

  @@index([nip])
  @@index([evaluatedByNip])
}
```

Catatan desain:
- `decisionMonths` dipisahkan dari `systemRecommendationMonths` supaya override atasan (memo secara eksplisit menyatakan "keputusan diusulkan atasan, tidak harus mengikuti rekomendasi asal ada penjelasan jelas dan logis") tercatat sebagai keputusan resmi, bukan menimpa angka sistem.
- Belum ada relasi eksplisit ke `PoaForm`/kontrak kerja HR — repositori ini tidak memiliki model "kontrak kerja" (`User` tidak memiliki field masa kontrak/tanggal mulai). **Masih perlu diklarifikasi**: apakah tanggal mulai/akhir kontrak personil akan ditambahkan ke `User`, atau cukup diisi manual oleh atasan setiap kali mengisi evaluasi (`periodeMulai`/`periodeAkhir` diisi manual saat itu juga)? v1 disarankan memakai opsi kedua (manual) supaya tidak membutuhkan sumber data HR baru sekaligus.
- **Model ini sudah ada di schema (migration `20260730115119_add_kpi_monitoring_models`) tetapi belum ada satu pun kode yang menulis atau membacanya** — tidak ada server action, tidak ada halaman/form yang memakainya (dikonfirmasi via pencarian `KpiContractEvaluation` di `src/`, satu-satunya kemunculan di luar `schema.prisma` ada di komentar `src/app/actions/kpi.ts:6`). Lihat `03-ui-and-access.md` §2 "Form Evaluasi Kontrak" untuk desain yang diusulkan, dan `01-business-rules.md` §5 "Tahapan siklus evaluasi kontrak" untuk urutan tahapan yang perlu diimplementasikan.

### Invariant `KpiContractEvaluation`

- `nip` (personil yang dievaluasi) selalu merujuk `User` yang valid, `onDelete: Cascade` (`prisma/schema.prisma:968`).
- `evaluatedByNip` (evaluator) selalu merujuk `User` yang valid, tanpa `onDelete: Cascade` (`prisma/schema.prisma:992`) — evaluasi tetap tersimpan meski record evaluator dihapus/diubah di kemudian hari.
- ❓ **Belum ada invariant keunikan** — tidak ada `@@unique` pada kombinasi `nip` + `periodeMulai` + `periodeAkhir` (atau `nip` + `evaluatedAt`). Secara skema, dimungkinkan membuat lebih dari satu `KpiContractEvaluation` yang saling tumpang tindih untuk personil dan window yang sama. Karena belum ada kode yang menulis ke model ini (lihat di atas), belum bisa diverifikasi apakah ini disengaja (evaluasi dapat diulang/dikoreksi) atau kelalaian yang perlu ditambal saat form Evaluasi Kontrak dibangun — perlu diputuskan pada saat itu, bukan diasumsikan sekarang.

## 4. Perilaku kegagalan — input manual tidak lengkap (`docs/sdd/04-quality-checklist.md` §13)

**Pada level listing bulanan (`KpiMonthlyEntry`, sudah terverifikasi di kode)**: apabila `callActivityRealisasi` atau `absensiValue` belum diisi (`null`) untuk suatu personil pada periode terpilih, `getKpiMonitoringData` **tidak** memberi nilai default atau memperlakukannya sebagai skor terendah. Pillar score terkait tetap `null` (`src/app/actions/kpi.ts:183`, `:186`), `totalScore` ikut menjadi `null` karena guard `allScored` mensyaratkan keempat skor terisi (`src/app/actions/kpi.ts:188-191`), dan UI menampilkan "Belum diisi" pada kolom terkait serta "Data belum lengkap" pada kolom Rekomendasi, alih-alih angka yang salah (`src/components/kpi/KpiTable.tsx:160`, `:170`, `:179`). Ini pola yang sama dengan degradasi eksplisit-ke-`null` pada integrasi Exodus Activity (`docs/form-poa/03-ui-and-access.md` §6, `src/lib/exodusApi.ts`) — kegagalan/data-kosong tidak pernah disamarkan menjadi angka yang tampak valid.

**Pada level evaluasi kontrak (`KpiContractEvaluation`, agregasi rata-rata beberapa bulan)**: ❓ **belum dapat diverifikasi terhadap kode** — belum ada implementasi agregasi (lihat §3 di atas). Pertanyaan yang masih terbuka dan perlu dijawab saat form Evaluasi Kontrak dibangun: apabila satu atau lebih bulan dalam window evaluasi memiliki `KpiMonthlyEntry` yang `null`/tidak ada untuk Call Activity atau Absensi, apakah (a) bulan tersebut dikecualikan dari rata-rata (rata-rata dihitung hanya dari bulan yang lengkap), (b) evaluasi diblokir sampai seluruh bulan dalam window terisi lengkap, atau (c) bulan yang tidak lengkap dihitung sebagai skor tertentu (misalnya 0)? Jangan mengasumsikan salah satu dari ketiganya sebelum dikonfirmasi — dicatat juga sebagai bagian dari edge case §5 "Tahapan siklus evaluasi kontrak" pada `01-business-rules.md`.

## 5. Yang sengaja TIDAK dibangun di v1

- Sync otomatis untuk Call Activity — **sudah diimplementasikan 2026-09-08** (`src/lib/sync/kpiCallActivitySync.ts`, endpoint Exodus "Get Count Visit By NIP", lihat `01-business-rules.md` §2b), trigger manual saja (tombol di `/kpi-perpanjangan`), belum dijadwalkan otomatis/cron — pola sama seperti Absensi di bawah.
- Sync otomatis untuk Absensi — **sudah diimplementasikan 2026-08-24** (`src/lib/sync/kpiAbsensiSync.ts`, lihat `01-business-rules.md` §2d), kredensial staging & production aktif sejak 2026-08-24, trigger manual saja (tombol/CLI), belum dijadwalkan otomatis/cron untuk v1.
- Perhitungan otomatis tanggal kontrak — lihat catatan `KpiContractEvaluation` di atas.
- Job bulanan pengisi snapshot `KpiMonthlyEntry` — lihat catatan status implementasi snapshot di §2 di atas; ini bukan keputusan scope yang disengaja, melainkan pekerjaan yang belum sempat dikerjakan pada v1.
