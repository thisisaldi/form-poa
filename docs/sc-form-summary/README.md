# Ringkasan Form SC: Fix OOM & Timeout Halaman Approvals

Status: **sedang dikerjakan** (plan dibuat 2026-10-12, branch `optimize-form-poa-sc`).
Selesai sebelumnya: lazy-load + pencarian outlet di Riwayat Aktivitas SC (commit `c14502e`); drop kolom `PoaScForm` yang tidak dipakai (commit `56457fa`).

## Progres

Dikerjakan satu per satu; centang setelah selesai dan terverifikasi.

**Fase 1: Schema**
- [x] Kolom baru di `PoaScProductItem` (`salesCounterValue`, `salesCounterMinimum`, `hnaSnapshot`)
- [x] Kolom ringkasan + index di `PoaScForm` (index `[currentHolderId]` diganti `[currentHolderId, period]`)
- [x] File migrasi `prisma/migrations/20261012170000_sc_form_summary_columns` (dibuat dengan `prisma migrate diff`; **belum dijalankan**)
- [x] `prisma generate` + type-check
- [x] Kolom tambahan untuk kartu outlet (2026-10-13, Keputusan no. 5): `PoaScProductItem.historySalesB3`, `cashbackSnapshot`; `PoaScForm.totalScProducts`, `historyPeriodEnd`, `scProductCodes`, `countIntensifikasi`, `countEkstensifikasi`, `countPenurunan`, `countTetap`. Ditambahkan ke file migrasi yang sama (masih **belum dijalankan**).

- [x] Daftar `pro_code` produk SC dipindah dari kolom `PoaScForm.scProductCodes` ke tabel `PoaScProductList` + `PoaScForm.scProductListId` (2026-10-13, Keputusan no. 9). Migrasi baru `20261013120000_sc_product_list` (**belum dijalankan**); kolom `scProductCodes` dihapus di migrasi yang sama, sebelum pernah dirilis ke produksi.

**Fase 2: Modul perhitungan**
- [x] Pindahkan `calculateCashbackDetails` ke `src/lib/scCashback.ts` (`git mv`, isi identik; hook lama me-re-export)
- [x] Rumus metrics panel diekstrak verbatim ke `src/lib/scFormMetrics.ts` (`computeScMetrics`); `useSalesCounterDetail` memanggilnya
- [x] `computeScFormSummary` (murni) di `src/lib/scFormSummary.ts`
- [x] `loadScSummaryInputs` di `src/lib/scFormSummaryLoader.ts` + varian strict `postHistorySalesStrict` / `getScCashbackPoaStrict` (gagal API → throw)
- [x] Varian batch history untuk backfill (`loadHistoryBatch`)
- [x] Input cashback multi-bulan: **ikut editor** (diputuskan 2026-10-12, lihat Keputusan no. 4). `computeScSummaryCashback` di `src/lib/scFormSummary.ts`; `computeScMetrics` dan panel lama tidak diubah.
- [x] Cek rumus dengan form contoh dari editor (2 produk, qty 25/35/55 dan 35/45/55): total dan angka per bulan sama dengan editor (Rp 69.363). Matrix-nya sintetis, jadi ini menguji rumus, bukan data Canvasser.
- [ ] Verifikasi dengan data asli: bandingkan `sumCashback` dengan angka editor untuk beberapa form staging (bisa lewat backfill `--dry-run`, Fase 4)
  - 2026-10-13: F9000763 2026-Q4 (staging), `sumCashback` 74.272,42 = Rp 74.272 di editor (dicek developer). Baru satu form; sisanya lewat dry-run backfill.
- [x] `computeScFormSummary` juga mengeluarkan nilai per baris produk (`historySalesB3`, `cashbackSnapshot`) dan per form (`totalScProducts`, `scProductCodes`, `historyPeriodEnd`, empat `count*`); `ScSummaryInputs` membawa history B-3 per produk, bukan hanya totalnya. `SUMMARY_VERSION` tetap 1 (belum ada form yang terisi).
- [x] `computeScGrowth` (murni) terpisah, supaya Fase 3 bisa menghitung ulang history saat mengajukan hanya dari baris tersimpan + response history. Kategori memakai `scGrowthCategory` yang sama dengan kartu outlet (`outletCalculationUtils.ts`).
- [x] Cek dengan 47 form di DB lokal (2026-10-13, hanya membaca): 46 lolos, 1 gagal dimuat karena `post-history-sales` sempat 500 (dicoba ulang: 200). Yang dicek per form: Σ `cashbackSnapshot` = `sumCashback`; jumlah empat `count*` = jumlah produk SC di form; `historySalesB3` per produk = rata-rata yang dihitung jalur kartu (`agg: false` + `parseOutletHistorySales`); `historySalesQuarter` = total kartu × 3. Ini belum membandingkan cashback dengan angka editor (butir di atas).

### Temuan Fase 2 (2026-10-12)

1. **History Sales halaman detail = 2× angka sebenarnya.** Loop di `getSalesCounterDetailData.ts` menjumlahkan entri `productSalesMap` tanpa dedup, padahal map menyimpan setiap kode dua kali (`"0100683"` dan `"100683"`). Terverifikasi untuk B8001676: halaman detail 9.976.508, total sebenarnya 4.988.254 (sama dengan kartu outlet × 3). Ringkasan memakai `parseScHistorySales` (dedup) = angka kartu.
2. **Input cashback berbeda per layar** (rumus `calculateCashbackDetails` sama):
   - Editor: 1 entri per produk dengan `monthlyQty`.
   - Kartu outlet: 1 entri per baris DB (multi-bulan = 3 baris/produk), dijumlah per produk.
   - Panel statistik: 1 entri per baris DB, dijumlah **per baris** → tepat 3× kartu untuk form multi-bulan.
   Data staging (8 form, semuanya multi-bulan): panel = 3× kartu; kartu ≠ editor (bisa lebih besar/kecil, ada kasus kartu > 0 tapi editor 0).
   Hanya editor yang benar untuk form multi-bulan. Dengan 1 entri per baris DB, `calculateCashbackDetails` memakai qty baris pertama (bulan pertama) untuk semua bulan, menghitung tiap baris sebagai varian tersendiri (2 produk × 3 bulan = 6 varian), dan memakai total sales satu kuartal sebagai total sales per bulan.
   **Angka cashback kartu dan panel tidak pernah dirender**: `SalesCounterStatsPanel` menerima `totalCashback` tapi tidak menampilkannya, dan `sumCashback` kartu outlet juga tidak dipakai di JSX. Cashback hanya terlihat di editor dan di export SC (sedang dimatikan).
3. **Prisma client yang sudah di-regenerate langsung butuh kolom baru.** Query `PoaScForm` tanpa `select` eksplisit gagal ("column `sumEstimasiSales` does not exist") sampai migrasi dijalankan. Kode dan migrasi harus dirilis bersama; DB lokal/dev perlu migrasi sebelum aplikasi lokal dipakai.
4. **"Total Budget SC" di kartu grup approvals bukan budget.** Angkanya Σ `rencanaTotalBiaya` + entertain (`sc/approvals/page.tsx`), dan `rencanaTotalBiaya` diisi editor dengan `qty × HNA × lama` (`calculateRowCost` di `useSalesCounterEditor.ts`), yaitu rumus estimasi sales. Jalur edit by ID (`useSalesCounterEditById.ts`) mengisi kolom yang sama dengan rumus lain, `qty × HNA × lama × persenMatriksSc`, jadi arti `rencanaTotalBiaya` bergantung pada layar mana yang terakhir menyimpan form (dicek 2026-10-13). **Diputuskan 2026-10-13: Fase 5 menggantinya dengan `sumBudgetSc`** (Keputusan no. 8); angka di kartu turun jauh.
5. **Form multi-bulan yang hanya punya qty di satu bulan dihitung × lama periode.** `computeScMetrics` menganggap form multi-bulan hanya kalau ada > 1 `periodeMonth` berbeda; baris ber-qty 0 tidak disimpan, jadi form dengan qty hanya di satu bulan dianggap "qty per bulan × 3". Ini perilaku panel sekarang dan ikut masuk ke `sumEstimasiSales` / `sumNilaiSc`. Cashback tidak terpengaruh. **Belum diputuskan.**

**Fase 3: Isi saat form ditulis**
- [x] `src/lib/scFormSummaryStore.ts`: `refreshScFormSummaries(formIds)` (baca form dari DB → hitung → tulis; dipakai save, ubah periode, dan nanti backfill) dan `refreshScHistoryForSubmit(formIds, ownerId)`
- [x] `saveSalesCounterFormAction`: `summaryVersion = null` di dalam transaksi, ringkasan dihitung **setelah response** lewat `after()` (`next/server`)
- [x] `updateSalesCounterPeriodAction`: sama, untuk semua form periode itu
- [x] Gagal API → form tetap tersimpan, `summaryVersion = null`
- [x] `submitSalesCounterFormAction`: hitung ulang history sales kalau `historyPeriodEnd` ≠ jendela hari ini (Keputusan no. 7), sebelum transaksi
- [x] Uji langsung ke DB lokal (2026-10-13): `refreshScFormSummaries` menulis 3 form (FG003055 Q4, A1007183 Q4, B1003096 Q3), Σ `cashbackSnapshot` = `sumCashback`, `updatedAt` form tidak berubah; `refreshScHistoryForSubmit` tidak mengubah apa pun kalau jendelanya sama, dan memulihkan nilai yang sama setelah `historyPeriodEnd` dipaksa usang
- [x] Uji lewat aplikasi, save (2026-10-13, F9000763 2026-Q4, API staging): save tanpa perubahan dan save dengan baris produk diganti, ringkasan terisi ~3 dtk setelah save lewat `after()`; Σ `cashbackSnapshot` = `sumCashback`, `updatedAt` tetap waktu save
- [x] Halaman editor: kolom ringkasan (Decimal) dibuang dari data yang dikirim ke komponen client (`getSalesCounterEditData.ts`), karena menyebabkan error "Decimal objects are not supported"
- [ ] Uji lewat aplikasi, ubah periode dan mengajukan dengan jendela B-3 yang sudah bergeser: **belum**

### Catatan Fase 3 (2026-10-13)

1. **Ringkasan ditulis setelah commit, bukan di transaksi yang sama** (berbeda dari rencana awal). Alasannya: panggilan Canvasser bisa 10 dtk+ (lihat no. 3), dan transaksi save sudah panjang. Di dalam transaksi hanya `summaryVersion = null`, jadi form yang barisnya baru diganti tidak pernah membawa angka lama. Penulisan ringkasan memakai kunci `(id, version, period)`: kalau form disimpan lagi sebelum perhitungan selesai, hasil yang lama dibuang.
2. **Save tanpa perubahan** tidak menulis ulang baris, tapi tetap memicu perhitungan kalau `summaryVersion` form itu belum versi sekarang.
3. **`post-history-sales` kadang 500** setelah ~10 dtk untuk payload yang sama yang biasanya 200 dalam ~0,2 dtk (1 dari 35 percobaan, outlet FG001279; `CANVASSER_API_BASE_URL` di `.env` = API produksi). Timeout tetap 60 dtk, tanpa coba ulang (diputuskan 2026-10-13).
4. **Angka history berbeda antar-pengecekan karena `.env` berpindah dari API Canvasser produksi ke staging** di tengah sesi (2026-10-13, ~10:09), bukan karena data berubah. Contoh A1007183, jendela Jul–Sep: 8.098.255 (produk SC) pada pengecekan Fase 2, 3.664.163 pada uji Fase 3; di staging `period: [202609]` mengembalikan 404 (September belum ada). Yang pasti: error 500 (no. 3) terjadi di API produksi, dan uji tulis Fase 3 memakai staging. Pengecekan Fase 2 dijalankan tepat sebelum error 500 itu, jadi kemungkinan besar produksi; hasil ukur 300 outlet tidak mencatat API mana yang dipakai. Hitung ulang history saat mengajukan tetap hanya kalau jendela bergeser (Keputusan no. 7; usul "selalu hitung ulang" ditolak 2026-10-13).
5. **`updateSalesCounterPeriodAction` mengisi `periodeMonth` semua baris produk dengan bulan pertama periode baru** (perilaku lama, tidak diubah). Form multi-bulan jadi punya 3 baris per produk di bulan yang sama, sehingga `computeScMetrics` memperlakukannya sebagai "qty per bulan × lama" per baris. Ringkasan mengikuti apa yang tersimpan.

**Fase 4: Backfill**
- [x] `scripts/backfillScFormSummary.ts` + `npm run backfill:sc-summary` (memakai `refreshScFormSummaries`, per 50 form)
- [x] Flag `--dry-run` (CSV; `--out=<path>`, default folder temp OS), `--force`, `--period`, `--form-id`, `--concurrency`
- [x] Dry-run `--force` di DB lokal + API staging (2026-10-13): 47 form, 46 terhitung, 1 gagal (`F3001814` 2026-Q3, timeout 60 dtk dari Canvasser), total 77 dtk, di mana ~60 dtk-nya menunggu timeout itu. Hasil dry-run sama dengan ringkasan yang sudah tersimpan untuk A1007183, FG003055, B1003096.
- [ ] Bandingkan CSV dry-run dengan kartu outlet / editor untuk ~10 outlet
- [x] Flag `--outlet=<kodePI>` (ditambahkan 2026-10-13)
- [x] Backfill sungguhan di DB lokal + API staging (2026-10-13): 47 dari 47 form terisi, 21 dtk; sisa form tanpa ringkasan: 0. Kegagalan sesaat Canvasser (500 / timeout dari `get-cashback-poa`) muncul di beberapa run dan hilang saat diulang.
- [ ] Backfill di produksi: **belum** (Fase 7)

### Catatan Fase 4 (2026-10-13)

1. **History disaring dengan `pro_code` saja.** `pro_code` (7 digit, kode Canvasser) dan `kode_item` (6 digit, kode Pharos) adalah dua kode berbeda untuk produk yang sama. Response `post-history-sales` memakai `pro_code`: dari 591 kode produk di 40 response (20 outlet × 2 jendela, staging), tidak ada yang lolos saringan lewat `kode_item`. Karena `pro_code` tanpa nol di depan juga 6 digit, mencocokkan `kode_item` hanya membuka kemungkinan sales produk lain ikut terhitung. Daftar yang disimpan turun dari 367 ke 92 kode (lalu dipindah ke tabel per bulan, Keputusan no. 9); dry-run sebelum dan sesudah perubahan sama untuk 44 form yang terhitung di kedua run. Halaman detail yang sekarang masih mencocokkan keduanya (belum diubah, Fase 6).
2. **`--force` tidak menandai form yang gagal.** Form yang gagal dihitung saat `--force` tetap membawa ringkasan lamanya dan `summaryVersion` lamanya, jadi run tanpa flag tidak akan mengulangnya. Ulangi dengan `--force --outlet=<kodePI>` atau `--force --form-id=<id>` untuk yang gagal.

**Fase 5: Halaman Approvals** (kode selesai 2026-10-13, belum diuji di browser)
- [x] Query server dari kolom ringkasan: `src/app/(app)/sc/approvals/_services/getScApprovalsSummaryData.ts` (satu baris ringan per form tanpa produk, `aggregate` untuk panel, breakdown per bulan dan jumlah customer lewat raw query, relasi lengkap hanya untuk 5 kartu di halaman aktif)
- [x] `SalesCounterApprovalsChecklist.tsx` dipecah: satu view bersama + pembungkus lama (`SalesCounterApprovalsChecklist`, hitung di browser) dan pembungkus baru (`SalesCounterApprovalsSummaryChecklist`, angka jadi dari server, pager outlet lewat `?page=`)
- [x] "Total Budget SC" kartu grup = Σ `sumBudgetSc` (Keputusan no. 8)
- [x] Peringatan "N form belum terhitung"
- [x] Tombol on/off: pengaturan Admin `sc.approvalsSummary.disabled` (Pengaturan Fitur → POA Sales Counter), **bukan** env flag seperti rencana awal, karena repo sudah punya pengaturan fitur tanpa deploy. Default: mati (halaman lama, `LegacyApprovalsPage.tsx`). Aktifkan setelah backfill.
- [x] Cek data untuk 6 pemegang form di DB lokal (NSM, 2 SM, 3 ASM): total panel, breakdown per bulan, jumlah customer, dan jumlah per kartu grup sama dengan hasil `computeScMetrics` atas semua form; tidak ada Decimal di props
- [ ] Uji di browser dengan pengaturan diaktifkan: tampilan ASM (kartu + pager), SM/NSM (kartu grup, Select All, approve massal)
- [ ] Uji dengan volume besar (DB lokal maksimal 4 form per pemegang, jadi pager halaman 2 dan waktu query untuk ratusan form belum teruji)

**Fase 6: Halaman Detail + kartu outlet** (kode selesai 2026-10-13, belum diuji di browser)
- [x] `src/app/(app)/sc/_services/scDraftItems.ts`: `toScDraftItem` dipakai halaman detail dan approvals. Form dengan ringkasan dibangun dari kolomnya sendiri; form tanpa ringkasan jatuh ke Canvasser (`loadScLiveOutletData`, hanya untuk outlet itu)
- [x] `getSalesCounterDetailData`: fan-out `getSalesCounterProduct` dan `postHistorySales` hilang untuk form yang punya ringkasan. Dicek untuk tampilan MR (5 outlet) dan NSM melihat grup ASM (6 outlet): 0 panggilan produk/history/cashback Canvasser; yang tersisa 2 panggilan daftar outlet (sekali per halaman, sudah ada sebelumnya, ~2 dtk)
- [x] `useSalesCounterOutletData`: growth, badge strategi, nilai SC, cashback dari data draft (`historySalesB3`, `cashbackSnapshot`). Dicek: angka kartu yang dihitung dari data itu sama dengan ringkasan tersimpan untuk 11 outlet
- [x] Panggilan live kartu hanya saat dibuka: produk SC + history (untuk daftar produk belum dipilih) dan history insentif; `get-cashback-poa` tidak dipanggil untuk form yang punya ringkasan
- [x] Label rentang history kartu dari `historyPeriodEnd`
- [x] History sales jalur fallback memakai `parseScHistorySales` (tidak lagi 2×, Temuan Fase 2 no. 1)
- [ ] Uji di browser: kartu tertutup tidak memanggil API, kartu dibuka memuat daftar produk belum dipilih
- [ ] Panel statistik detail masih menghitung di browser dari baris produk (hasilnya sama dengan ringkasan karena inputnya sudah dibekukan); `getScCashbackPoaAction()` tanpa `pi_code` di `useSalesCounterDetail` masih terpanggil sekali per halaman dan hasilnya tidak ditampilkan

**Export Excel SC** (2026-10-13, belum diuji lewat tombol di aplikasi)
- [x] `/api/sc/export` (dashboard) dan `/api/sc/[id]/export` (halaman detail): form dengan ringkasan memakai nilai SC, HNA, dan cashback dari barisnya (`src/lib/scExportSummary.ts`); Canvasser hanya untuk outlet yang masih punya form tanpa ringkasan. Sebelumnya 2 panggilan Canvasser per outlet sebelum byte pertama.
- [x] `/api/sc/[id]/export` jadi streaming (`WorkbookWriter`, helper bersama `src/lib/scExportSheet.ts`). Sebelumnya workbook dibangun penuh di memori: ukur sintetis ~20 ribu baris detail = ratusan MB.
- [x] Sheet Audit Log hanya memuat kolom yang ditulis (snapshot JSON tidak ikut)
- [x] `/api/sc/[id]/export`: kolom NIP/Nama MR per baris memakai pemilik form itu, bukan pemilik form pertama (salah untuk export grup ASM)
- [x] Handler dipanggil langsung dengan sesi tiruan (DB lokal): file terbentuk dan bisa dibaca ulang, 0 panggilan Canvasser, jumlah baris dan Σ estimasi sales / cashback sama dengan DB (bulk 2026-Q3 dan 2026-Q4, grup ASM 2026-Q3, MR 2026-Q4)
- [ ] Aktifkan pengaturan `export.sc.disabled` (sekarang default mati) dan uji tombol export di dashboard dan halaman detail
- [ ] Uji dengan volume produksi (NSM/SM, ratusan form)
- Angka export berubah untuk form yang punya ringkasan: HNA = yang dibekukan saat save (Exodus), bukan `Product.hna`; cashback = yang dibekukan.

**Fase 7 (rollout)**: lihat bagian Plan di bawah.

## 1. Masalah

Halaman `/sc/approvals` adalah penyebab utama OOM dan timeout server. Per request, untuk user yang memegang banyak form, halaman ini:

1. Memuat **semua** form pending beserta seluruh relasinya (`src/app/(app)/sc/approvals/page.tsx`, query `pendingForms`): produk, persons, entertain, `auditLogs` (dengan `snapshot`), dan rantai atasan owner 3 level (`owner → reportsTo → reportsTo`).
2. Mengirim semuanya ke browser sebagai `scDrafts`. Paginasi 5 outlet (`OUTLET_PAGE_SIZE` di `SalesCounterApprovalsChecklist.tsx`) **hanya dilakukan di browser** dengan `.slice()`, setelah semua data dimuat dan diserialisasi.
3. Memanggil `getSalesCounterProduct` (Canvasser) untuk **setiap** outlet pending lewat `mapWithConcurrency(outletCodes, 8, …)`. 660 outlet ÷ 8 × ~0,5 dtk ≈ 41 dtk → **timeout**.
4. Di browser, panel statistik (`useSalesCounterDetail`) memanggil `postHistorySalesAction` **sekali per form** (server action berjalan berurutan, ~185 ms per panggilan), karena `historySalesQuarter` tidak diisi. `pro_code` juga dikirim dengan duplikat (setiap kode × 3 bulan).
5. Setiap approve/revisi memanggil `revalidatePath("/sc/approvals")`, sehingga semua langkah di atas diulang.

### Volume data (DB produksi, 2026-10-12)

| | Jumlah |
|---|---|
| `PoaScForm` | 3.932 (3.891 berstatus SUBMITTED_*) |
| `PoaScProductItem` | 202.070 (~51 per form, maks 240) |
| `PoaScAuditLog` | 17.741 |
| Holder terbesar | NSM `L250342`: 660 form, 33.307 baris produk, 3.864 log |
| | SM `P240093`: 562 form / 29.840 produk; SM `L250264`: 503 form / 26.750 produk |
| Owner+periode terbesar | 45 form |

### Bug terkait yang ikut terselesaikan

- **Total Cashback di perhitungan panel statistik selalu 0** (di halaman Approvals **dan** Detail; angkanya tidak dirender, jadi tidak terlihat user). `useSalesCounterDetail.ts` memanggil `getScCashbackPoaAction()` **tanpa** `pi_code`. API mengembalikan 404 `{"message":"Gudang Tidak Ditemukan"}`, dan objek itu truthy, sehingga tidak ada matrix, `variantMultiplier = 0`, dan cashback = 0. Kartu per outlet sudah benar karena memanggil per Kode PI. Dengan `pi_code`, outlet apotek online mengembalikan 200 + `matrix` (40 dari 40 outlet yang diuji).
- **History Sales di panel approvals** hanya menghitung produk yang ada di form. Halaman detail dan kartu outlet menghitung semua produk SC outlet.

## 2. Keputusan (sudah disepakati)

1. **Angka dibekukan saat MR menyimpan form.** Approver melihat angka yang diajukan, bukan angka Canvasser/Exodus terbaru.
2. **HNA** = yang dipakai editor: Exodus `GET {EXODUS_API_BASE_URL}/core/v1/products` → `sell_price` (`getLiveProductPricing()` di `src/lib/exodusApi.ts`). Kalau tidak ada, jatuh ke `Product.hna` di DB. Catatan: `Product.hna` di DB terakhir disinkron dari Excel pada 2026-07-10, jadi bisa berbeda dari Exodus.
3. **History Sales** = `total_sales` B-3 (3 bulan, `getB3RollingPeriodInfo(period).targetPeriods`) untuk **produk SC outlet dari Canvasser** (`get-sales-counter-product`), sama seperti halaman detail dan kartu outlet.
4. **Cashback** mengikuti **editor** (angka yang dilihat MR saat menyimpan): `calculateCashbackDetails` dengan matrix outlet itu, 1 entri per produk dengan `monthlyQty` (baris DB dikelompokkan per produk; bulan tanpa baris = 0). Kalau outlet tidak ditemukan (404), cashback = 0. Semula "ikut kartu outlet"; diubah 2026-10-12 karena input kartu salah untuk form multi-bulan (Temuan Fase 2 no. 2).

5. **Angka kartu outlet ikut dibekukan, di tabel yang sudah ada** (diputuskan 2026-10-13). Tidak ada tabel baru. Per baris produk disimpan history B-3 dan cashback; per form disimpan jumlah produk SC outlet dan jumlah produk per kategori growth. Dengan ini badge Intensifikasi / Ekstensifikasi / Penurunan, growth, nilai SC, dan cashback di kartu tidak lagi butuh `getSalesCounterProduct`, `post-history-sales`, atau `get-cashback-poa`.
   - Kategori (sama dengan `strategyCounts` di `SalesCounterOutletCard.tsx`): tanpa history B-3 → ekstensifikasi; growth > 0 → intensifikasi; growth < 0 → penurunan; growth = 0 → tetap. Growth = (estimasi sales − history B-3 × lama) ÷ (history B-3 × lama), rumus `calculateProductDetailRows`.
   - Cashback kartu jadi mengikuti editor (Keputusan no. 4), jadi angkanya berubah dari yang sekarang dihitung kartu (Temuan Fase 2 no. 2).
   - Jendela B-3 untuk kuartal berjalan/mendatang **bergeser mengikuti tanggal hari ini** (`getB3RollingPeriodInfo` memakai `new Date()`, dibatasi ke bulan terakhir yang sudah tutup): form Q4 yang disimpan September memakai Jun–Agu, yang disimpan Oktober ke atas memakai Jul–Sep. Bulan akhir jendela yang dipakai disimpan di `historyPeriodEnd`; label rentang di kartu memakai kolom ini, bukan jendela hari ini.
6. **Yang tetap live: daftar "produk SC belum dipilih" dan sidebar Kompetitor**, dan hanya dimuat saat kartu dibuka (`isExpanded`). Keduanya butuh seluruh daftar produk SC outlet (~30 baris per form), tidak sepadan untuk dibekukan. Sekarang `useSalesCounterOutletData` menerima `isExpanded` tapi efek fetch-nya tidak memakainya, sehingga setiap kartu yang tampil langsung memanggil API.
7. **History sales dihitung ulang saat mengajukan, hanya kalau jendelanya sudah bergeser** (`submitSalesCounterFormAction`, diputuskan 2026-10-13). Yang lain (estimasi sales, nilai SC, diskon, cashback, HNA) tetap dari save.
   - Yang dihitung ulang: `historySalesB3` per produk, empat `count*`, `historySalesQuarter`, `historyPeriodEnd`.
   - Form dengan `historyPeriodEnd` = jendela hari ini dilewati (tanpa panggilan API). Biasanya ini semua form, karena pengajuan umumnya di bulan yang sama dengan save.
   - Sisanya: `post-history-sales` (`agg`, tanpa `pro_code`) per 50 outlet, paralel, **sebelum** transaksi. Penyaringan ke produk SC dilakukan lokal dengan daftar `PoaScProductList` yang dirujuk form, jadi tidak ada `getSalesCounterProduct` per outlet.
   - Tulis: satu `UPDATE … FROM` per batch dengan kunci (form, produk), bukan per baris.
   - Gagal API → form tetap diajukan dengan angka lama.
   - Tidak perlu proses background. Hasil ukur 2026-10-13 (API Canvasser dari `.env` lokal, 300 outlet dari master outlet, 6 panggilan paralel): 0,6 dtk total, 147 KB response, heap +6 MB. 18 outlet ber-form SC: 42 KB (≈2,3 KB per outlet, ≈20 produk). Perlu diukur ulang di produksi dengan akun yang mengajukan banyak outlet.
8. **"Total Budget SC" di kartu grup approvals = Σ `sumBudgetSc`** (nilai SC + diskon + cashback + entertain; diputuskan 2026-10-13, Temuan Fase 2 no. 4). Kolom `rencanaTotalBiaya` tidak diubah dan tidak lagi dibaca kartu grup. Approver diberi tahu sebelum Fase 5 dirilis, karena angkanya turun jauh.

9. **Daftar produk SC disimpan sekali per bulan, bukan per form** (diputuskan 2026-10-13). Canvasser memberi daftar yang sama ke semua outlet untuk satu bulan (dicek 20 outlet di staging: 44 produk untuk 202605–202608, 92 produk untuk 202609–202611), dan daftarnya tidak berubah di tengah bulan. Tabel `PoaScProductList` berisi `period` (YYYYMM yang dijawab Canvasser), `proCodes`, dan `hash`; form merujuknya lewat `scProductListId`. Kuncinya `(period, hash)`: normalnya satu baris per bulan, dan kalau Canvasser ternyata memberi daftar berbeda di bulan yang sama, jadinya baris kedua, bukan angka salah. Satu-satunya pembaca: hitung ulang history saat mengajukan (Keputusan no. 7).
   - `getSalesCounterProduct` sekarang mengembalikan `resolvedPeriod`, yaitu bulan kandidat yang dijawab Canvasser (response API-nya sendiri tidak menyebut periode).

Badge kartu outlet dulu tidak punya kategori "tetap" (growth tepat 0%), sehingga Intensifikasi + Ekstensifikasi bisa ≠ total produk. Contoh B8001676: 28 + 7 ≠ 36, dengan BRION OINT 20GR di growth 0%. `countTetap` menutup selisih ini di data; badge "tetap" **tidak ditampilkan dulu** (diputuskan 2026-10-13).

## 3. Plan

### Fase 1: Schema (migrasi, semua kolom nullable)

`PoaScProductItem`, input yang dibekukan:

| Kolom | Tipe | Isi |
|---|---|---|
| `salesCounterValue` | `Decimal(18,2)?` | `sales_counter_value` Canvasser |
| `salesCounterMinimum` | `Int?` | `sales_counter_minimum` |
| `hnaSnapshot` | `Decimal(18,2)?` | HNA yang dipakai |
| `historySalesB3` | `Decimal(18,2)?` | Rata-rata sales B-3 **per bulan** produk itu (`sales_value ÷ 3`); nilainya sama di semua baris bulan produk yang sama, jadi jangan di-`SUM` antar baris |
| `cashbackSnapshot` | `Decimal(18,2)?` | Cashback produk itu untuk **bulan baris itu** (`monthlyBreakdownMap` dari `calculateCashbackDetails`); Σ semua baris form = `sumCashback` |

`PoaScForm`, ringkasan:

| Kolom | Tipe |
|---|---|
| `sumEstimasiSales`, `sumNilaiSc`, `sumDiskon`, `sumCashback`, `sumEntertain`, `sumBudgetSc` | `Decimal(18,2)?` |
| `tercacahEstimasiSales`, `tercacahNilaiSc` | `Decimal(18,2)?` |
| `historySalesQuarter` | `Decimal(18,2)?` (total 3 bulan) |
| `monthlyBreakdown` | `Json?`, berbentuk `{ "YYYYMM": { estimasiSales, nilaiSc, cashback } }` |
| `historyPeriodEnd` | `Int?`, bulan akhir jendela B-3 yang dipakai (YYYYMM) |
| `scProductListId` | `String?`, rujukan ke `PoaScProductList` (daftar `pro_code` produk SC Canvasser yang berlaku saat disimpan); null = belum dihitung |
| `totalScProducts` | `Int?`, jumlah produk SC outlet di Canvasser saat disimpan |
| `countIntensifikasi`, `countEkstensifikasi`, `countPenurunan`, `countTetap` | `Int?`, jumlah produk form per kategori growth (Keputusan no. 5); totalnya = jumlah produk SC di form |
| `summaryVersion` | `Int?` (`null` = belum dihitung) |
| `summaryComputedAt` | `DateTime?` |
| index | `@@index([currentHolderId, period])` |

Buat file migrasi saja. Migrasi ke DB produksi dijalankan oleh developer (`npm run db:migrate`). Jangan pakai `prisma migrate dev` ke DB bersama.

### Fase 2: Modul perhitungan `src/lib/scFormSummary.ts`

1. `computeScFormSummary(input)`: fungsi **murni**, tanpa I/O. Rumusnya dipindahkan dari:
   - metrics di `src/components/sc/hooks/useSalesCounterDetail.ts`: estimasi sales, nilai SC (multi-bulan vs `× lamaPeriode`, aturan `qty >= salesCounterMinimum ? qty × salesCounterValue : 0`, kalau tidak ada nilai SC pakai `estSales × persenMatriksSc`), diskon, entertain, tercacah (overlap bulan dengan kuartal), breakdown per bulan;
   - `calculateCashbackDetails`, dipindahkan dari `src/components/sc/edit/hooks/useSalesCounterCashback.ts` ke `src/lib/`. Hook lama me-re-export supaya client dan server memakai kode yang sama.
   - Rujukan per produk: `calculateProductDetailRows` di `src/components/sc/detail/utils/outletCalculationUtils.ts`.
2. `loadScSummaryInputs(kodePI, period, productCodes)` mengambil:
   - `getSalesCounterProduct(kodePI, period)` → nilai SC per produk dan daftar kode produk SC (`pro_code` dan `kode_item`, juga versi tanpa nol di depan)
   - `getLiveProductPricing()` → HNA, jatuh ke `Product.hna`
   - `getScCashbackPoa(kodePI)` → matrix cashback
   - `postHistorySales({ piCodes, period: b3.targetPeriods, agg: true })` → filter ke kode produk SC → Σ `sales_value`
3. Varian batch untuk backfill: `postHistorySales` untuk banyak outlet dalam satu panggilan (45 outlet ≈ 0,6 dtk, sudah diuji).
4. `SUMMARY_VERSION = 1`. Kalau rumus berubah, naikkan versi lalu jalankan backfill `--force`.

### Fase 3: Isi saat form ditulis

Jalur yang menulis produk/periode (sudah dipetakan; tidak ada jalur lain):

| Jalur | Tindakan |
|---|---|
| `saveSalesCounterFormAction` (`src/app/actions/scActions.ts`) | Ambil data eksternal **sebelum** `$transaction` (`getSalesCounterProduct` sudah dipanggil di awal action), hitung, lalu tulis kolom produk dan ringkasan di transaksi yang sama. |
| `updateSalesCounterPeriodAction` (`scActions.ts`) | Hitung ulang (B-3 dan tercacah berubah). Hanya diizinkan saat DRAFT/REVISI. |
| `submitSalesCounterFormAction` (`scApprovalActions.ts`) | Hitung ulang history sales kalau jendela B-3 sudah bergeser (Keputusan no. 7). |
| Action approval lain (`scApprovalActions.ts`), handover (`src/lib/sync/ownerHandoverSync.ts`) | Tidak perlu diubah (hanya status/owner). |

Kalau API eksternal gagal: form **tetap tersimpan** dengan `summaryVersion = null`, lalu diproses oleh backfill. Save tidak boleh gagal karena Canvasser.

### Fase 4: Skrip backfill `scripts/backfillScFormSummary.ts`

Ikuti pola `scripts/*.ts` yang dijalankan dengan `tsx`. Tambahkan ke `package.json`: `"backfill:sc-summary": "tsx scripts/backfillScFormSummary.ts"`.

- Bisa dilanjutkan kalau terhenti: hanya memproses form dengan `summaryVersion` null atau lebih lama dari versi sekarang.
- Flag: `--dry-run` (tanpa menulis; hasil ke CSV untuk dibandingkan), `--force`, `--period=2026-Q4`, `--form-id=…`, `--concurrency=5`.
- Per batch 50 form: 1× `postHistorySales` untuk semua outlet batch; Canvasser dan cashback per outlet (maks 5 sekaligus); tulis dalam 1 transaksi per batch; catat progres di log.
- Estimasi untuk ~3.900 form: ~10 menit, memori kecil.
- Untuk form lama, nilai HNA/SC/cashback/history yang dipakai adalah nilai **saat skrip dijalankan**, karena nilai saat MR menyimpan dulu tidak diketahui.

### Fase 5: Tulis ulang halaman Approvals

Server (`src/app/(app)/sc/approvals/page.tsx`):

| Bagian | Query |
|---|---|
| Panel statistik | `aggregate({ _sum })` kolom ringkasan, ditambah `select` `monthlyBreakdown` |
| Produk/person unik | `COUNT(DISTINCT)` lewat raw query |
| Kartu grup (SM/NSM) | `groupBy(['ownerId','period'])` + `_sum`, data owner ringkas; "Total Budget SC" = `_sum.sumBudgetSc` |
| Kartu outlet (ASM) | `findMany({ take: 5, skip })` lengkap, dengan `?page=` di URL |
| Select All / approve massal | hanya `id` (+ `ownerId`, `period`) |
| `summaryVersion` null | Total dari form yang sudah punya ringkasan + peringatan "N form belum terhitung". **Jangan** jatuh ke perhitungan langsung. |

Hapus dari halaman ini: fan-out `getSalesCounterProduct`, include `auditLogs` dan rantai atasan 3 level, serta prop `scDrafts` berisi semua form.

Client (`src/components/sc/SalesCounterApprovalsChecklist.tsx`): `SalesCounterStatsPanel` menerima `metrics` yang sudah jadi dari server, dan `useSalesCounterDetail` tidak dipakai lagi di halaman ini. Pager outlet berpindah halaman lewat URL.

Hasil yang diharapkan: 0 panggilan API eksternal dari server, 0 panggilan per form dari browser; yang tersisa hanya panggilan dari 5 kartu yang tampil (~5 action per kartu).

### Fase 6: Halaman Detail + kartu outlet

Sekarang `getSalesCounterProduct` dipanggil dua kali per outlet: di server untuk semua outlet (`getSalesCounterDetailData.ts`, `mapWithConcurrency`), lalu sekali lagi di browser per kartu yang tampil (`useSalesCounterOutletData.ts`).

- Server (`getSalesCounterDetailData.ts`): hapus fan-out `getSalesCounterProduct` dan panggilan `postHistorySales`. `salesCounterValue` / `salesCounterMinimum` / `hnaSJ` dari kolom baris produk; produk SC = baris dengan `salesCounterValue` tidak null; `totalScProducts` dan `historySalesQuarter` dari kolom form. Sekaligus menghilangkan bug History Sales 2× (Temuan Fase 2 no. 1).
- Kartu (`SalesCounterOutletCard` + `useSalesCounterOutletData`): `calculateProductDetailRows` memakai `historySalesB3` dan `cashbackSnapshot` dari baris produk, bukan `b3SalesMap` / `cbDetails`. Badge strategi dari empat kolom `count*`.
- Panggilan live kartu hanya saat `isExpanded` (Keputusan no. 6): `getSalesCounterProductsAction` + `postHistorySalesAction` untuk daftar produk belum dipilih. Sidebar Kompetitor sudah dimuat saat dibuka (`isKompetitorOpen`). `getScCashbackPoaAction` tidak dipanggil lagi untuk form yang sudah punya ringkasan. History insentif (`getScHistoryIncentiveCounterAction`, `getScInsentifHistoryAction`) tidak dibekukan, tapi ikut ditunda sampai `isExpanded`: hasilnya hanya dirender di dalam blok `detailOpen` (growth insentif, rata-rata insentif B-3, kolom insentif di tabel produk), tidak di header kartu yang tertutup.
- Form dengan `summaryVersion` null: kartu jatuh ke jalur live seperti sekarang, sampai backfill selesai.
- Panel statistik halaman detail (`SalesCounterDraftChecklist`) membaca kolom ringkasan: bug cashback 0 hilang.
- Kartu outlet di halaman approvals (5 per halaman) memakai komponen yang sama, jadi ikut berhenti memanggil API saat tertutup.
- Export SC (`SC_EXPORT_DISABLED = true` di `src/lib/exportFlags.ts`) membaca kolom ringkasan sebelum diaktifkan kembali.

### Fase 7: Rollout

1. Deploy Fase 1–3 (halaman approvals belum berubah).
2. Backfill `--dry-run`, lalu bandingkan dengan angka kartu outlet untuk ~10 outlet (cashback, history, nilai SC).
3. Backfill sungguhan; cek jumlah form dengan `summaryVersion` null (target 0).
4. Deploy Fase 5 di belakang env flag `SC_APPROVALS_USE_SUMMARY=true` (supaya bisa rollback tanpa deploy ulang).
5. Pantau memori dan waktu respons `/sc/approvals` dengan akun NSM `L250342`.

Estimasi: ~4,5–5,5 hari (Fase 1–5 + 7).

Catatan deploy migrasi: `scripts/migrate.sh` (dipanggil di Kubernetes) menjalankan `prisma migrate deploy` saat deploy. Migrasi yang hanya **menambah** kolom nullable aman dirilis bersama kodenya. Migrasi yang **menghapus** kolom harus dirilis setelah kode yang tidak lagi memakainya sudah live.

### Perubahan angka yang akan terlihat user (beri tahu approver sebelum Fase 5)

| Angka | Sebelum | Sesudah |
|---|---|---|
| Total Budget SC di kartu grup | Σ `rencanaTotalBiaya` + entertain (estimasi sales atau nilai SC matriks, tergantung layar yang menyimpan) | Σ `sumBudgetSc` = nilai SC + diskon + cashback + entertain. **Turun jauh**; approver harus diberi tahu dulu (Keputusan no. 8) |
| History Sales di panel approvals | hanya produk di form | semua produk SC outlet |
| HNA di panel | DB `Product.hna` | yang dipakai MR saat save (Exodus) |
| Setelah Canvasser/Exodus berubah | ikut berubah | tetap (dibekukan) |

## 4. Referensi API (hasil uji 2026-10-12)

### `POST {CANVASSER_API_BASE_URL}/api/post-history-sales`

Body: `{ "pi_code": [...], "agg": "True"|"False", "period": [202609, 202608, 202607], "pro_code"?: [...] }`

`agg: "True"`:
```json
{
  "data": {
    "A1000007": {
      "0100683": { "sales_value": 115500, "sales_qty": 3, "sales_value_avg": 38500, "history_sales_avg": 1 },
      "0102055": { "sales_value": 115000, "sales_qty": 5, "sales_value_avg": 38333.33, "history_sales_avg": 1.67 },
      "total_sales": 343900,
      "average_sales": 114633.33
    }
  },
  "period": ["202609", "202608", "202607"],
  "aggregated": true
}
```
`sales_value` = total 3 bulan; `sales_value_avg` = `sales_value ÷ 3` (selalu dibagi 3).

`agg: "False"`: dipecah per bulan, `data["202608"]["A1000007"][proCode] = { sales_value, sales_qty }`. Bulan tanpa penjualan tidak muncul.

Perilaku penting:
- `period` yang bukan angka YYYYMM (`"NaN"`, `"2026-Q3"`) → **500** (error Django, ~2,4 dtk). Selalu kirim angka.
- Tidak ada data / outlet atau produk tidak dikenal → **404** `"No History Found"` (normal, diperlakukan sebagai null).
- 45 outlet dalam satu panggilan: 200, ~0,6 dtk. 40 panggilan paralel: semua 200.

### `GET {CANVASSER_API_BASE_URL}/api/get-cashback-poa?pi_code=X`

200 → `{ "matrix": [{ "code": "0100186", "cashback_percentage": 0.1 }, …], "variant": [...], "pi": [...], "limit": [...] }`. Tanpa `pi_code` → selalu 404 `{"message":"Gudang Tidak Ditemukan"}`.

### `GET {CANVASSER_API_BASE_URL}/product/get-sales-counter-product?pi_code=X&period=YYYYMM`

Wrapper: `getSalesCounterProduct()` di `src/app/(app)/sc/[id]/_services/getSalesCounterProduct.ts`. Mencoba beberapa kandidat periode berurutan, lalu fallback tanpa `period`. Field yang dipakai: `pro_code`, `kode_item`, `sales_counter_value`, `sales_counter_minimum`.

## 5. Masalah lain yang diketahui (di luar plan ini)

- Error log `TypeError: Cannot read properties of null (reading 'userId')` berasal dari `src/app/(app)/dashboard/page.tsx` (`(await getCurrentUser())!`). Layout dan page dirender paralel, jadi redirect di layout tidak mencegah page jalan saat user tidak login. Bukan OOM, hanya noise. Perbaikannya sempat di-revert atas permintaan.
- `getSalesCounterProduct` bisa mencoba 3–4 periode berurutan dengan timeout 60 dtk masing-masing, dan memakai `next: { revalidate: 60 }` (cache data di memori). Risikonya rendah selama API cepat.
