# Redesain Ringkasan Summary — Business Rules

*(Sumber: instruksi langsung pengguna, 2026-08-05, ditulis apa adanya sebagai draft mentah tanpa formula. Dokumen ini menstrukturkan draft tersebut ke format spec (lihat `docs/sdd/02-spec-template.md`) dan menambahkan setiap titik yang ambigu ke §"Open questions" — TIDAK ada formula yang ditambahkan/ditebak sendiri di luar yang eksplisit disebutkan pengguna.)*

## 1. Definisi istilah

| Istilah | Definisi (dari requirement) | Catatan |
|---|---|---|
| **Q-Berjalan** | Quarter sesuai filter periode yang dipilih pengguna | Filter tab Ringkasan **hanya boleh memilih satu quarter** — ini adalah perubahan perilaku dari filter Summary yang berjalan sekarang, yang mendukung rentang/multi-periode dan "semua periode" (lihat `docs/form-poa/03-ui-and-access.md` §3 "Window periode default"). Kalau proposal ini diimplementasikan, `SummaryFilterModal` (atau varian khusus tab Ringkasan) perlu membatasi pemilihan ke 1 quarter untuk tab ini secara spesifik — belum jelas apakah pembatasan ini berlaku cuma di tab Ringkasan atau ke seluruh halaman Summary (lihat Open Questions). |
| **Q-Sebelumnya** | (tersirat) quarter sebelum Q-Berjalan | ❓ Tidak didefinisikan eksplisit oleh requirement. Kandidat interpretasi: (a) kuartal kalender tepat sebelum Q-Berjalan (mis. Q-Berjalan=2026-Q3 → Q-Sebelumnya=2026-Q2), sama seperti pola "kuartal ini + 1 kuartal sebelumnya" yang sudah ada di window default Summary saat ini. Belum dikonfirmasi. |
| **PSSP Rencana** | Rebrand dari istilah **"Pengajuan"** yang dipakai saat ini | Bukan konsep baru — datanya sama dengan yang selama ini disebut "Pengajuan" di seluruh sistem (estimasi rencana dari `PoaLineItem`, lihat `docs/form-poa/01-business-rules.md` §3 "Nilai PSSP"). Ini murni perubahan LABEL tampilan, bukan perubahan formula. |
| **PSSP Aktif** | "PSSP yang sudah aktif" | Definisi sama dengan konsep "PSSP Aktif" yang sudah dipakai konsisten di tempat lain di sistem — kontrak `PsspKontrak` dengan `prdAkhir >= periode berjalan` (lihat `docs/form-poa/01-business-rules.md` §6, `docs/kpi-monitoring/01-business-rules.md` §2c). Reuse definisi yang sudah ada, bukan definisi baru. |

### Dampak penamaan "Pengajuan" → "PSSP Rencana"

Istilah "Pengajuan" saat ini dipakai di banyak tempat di luar tab Ringkasan — contoh: kolom "Estimasi Aktif+Pengajuan" di tab Per Outlet/Per Produk (`docs/form-poa/03-ui-and-access.md` §3), sheet export "Semua Pengajuan" (`docs/form-poa/03-ui-and-access.md` §5). Requirement ini HANYA menyebut perubahan istilah di section Ringkasan — **belum jelas apakah rename ini dimaksudkan berlaku global (semua tempat yang menyebut "Pengajuan") atau lokal ke tab Ringkasan saja**. Lihat Open Questions.

### Metrik di dokumen ini TIDAK lagi eksklusif tab Ringkasan (2026-08-07)

Dikonfirmasi pengguna: *"tab agregat itu versi detailnya"* — seluruh metrik di §2/§4/§5 sekarang juga ditampilkan **per baris** di lima tab lain (`Per Personil`/`Per Outlet`/`Per Customer`/`Per Spesialisasi`/`Per Produk`), menggantikan kolom lama `TerritoryTable` (Estimasi/Growth/Budget/Cost Ratio/Realisasi — dibuang seluruhnya, bukan dipertahankan berdampingan). Komponen: `src/components/poa/RingkasanMetricsTables.tsx` (3 tabel bertumpuk per tab: PSSP Rencana/Aktif · Value+Unit · Breakdown Historis), data-nya dihitung di `summary/page.tsx` sebagai `metricRows`.

**Formula-nya identik**, bukan versi turunan/aproksimasi: tiap baris memanggil fungsi yang SAMA (`tercacahAktifForQuarter`, `computeMonthlyBreakdown`, `contractLengthMonths`, `elapsedFraction`, `variasiFor`, lookup `custContractsSorted`), cuma di-parameterisasi ke `items`/`kesesuaianRows`/`groupActivePssp` milik grup itu sendiri, bukan array global. Konsekuensinya: setiap koreksi formula di dokumen ini otomatis berlaku ke enam tab sekaligus — jangan mengubah satu sisi saja.

Metrik yang tidak berlaku untuk sebuah tab bernilai `null` (kolomnya tidak dirender), dan metrik yang datanya genuinely tidak ada (DPL/DPF, DP, Entertain dimensi Aktif — lihat §5e) tetap ditampilkan "Tidak tersedia", bukan 0, sama seperti di tab Ringkasan.

**Dampak ke filter**: karena kelima tab itu sekarang menampilkan angka yang tercacah ke satu kuartal, filter rentang periode (`SummaryFilterModal`, from/to) **dihapus** dan `RingkasanQuarterFilter` (satu kuartal) berlaku untuk SELURUH halaman `/summary` — menjawab non-blocking open question #2 di bawah. Window default jadi lebih ketat (1 kuartal, sebelumnya kuartal berjalan + 1 sebelumnya).

## 2. Kesesuaian POA — DIHAPUS sebagai section terpisah (2026-08-06)

*(Riwayat: awalnya tabel 3 kelompok kolom × 2 sub-kolom — PSSP Rencana / PSSP Aktif Q-berjalan / PSSP Aktif Q-sebelumnya — implementasi 2026-08-05.)*

Dihapus sebagai kartu terpisah setelah pengguna menilai isinya redundan dengan §4 ("kayaknya redundan deh"): PSSP Rencana dan PSSP Aktif Q-Berjalan sudah muncul sebagai tile di §4's "Target / Estimasi / Sales / Pelunasan". Satu-satunya angka yang TIDAK ada tile-nya di §4 — Jumlah/Value PSSP Aktif Q-Sebelumnya — dipindah jadi tile baru di §4 (lihat §4 di bawah). Sisa isi §2 (baris "N MR · N POA · N pengajuan · Q-Berjalan ... gunakan Filter Kuartal untuk ganti") dipindah kembali jadi counts-line generik di atas seluruh tab (sama seperti tab lain), bukan lagi di kartu tersendiri.

**Formula PSSP Aktif per kuartal** (dikoreksi 2026-08-05, formula-nya BERTAHAN meski kartunya dihapus — dipakai §4/§5 sekarang) — definisi awal ("kolom Q-sebelumnya pakai angka yang sama dengan Q-berjalan, karena PSSP Aktif gak punya dimensi historis") **salah dan sudah diperbaiki**. Dikoreksi eksplisit oleh pengguna: kolom Aktif Q-manapun berarti "PSSP tercacah (apportioned) yang BENAR-BENAR BERJALAN pada kuartal itu sendiri", bukan "aktif sekarang, dipakai berulang untuk kedua kolom". Ini genuinely computable dari data yang sudah ada — `PsspKontrak.prdAwal`/`prdAkhir` menyimpan rentang tanggal kontrak yang tetap (bukan status "aktif hari ini" yang berubah-ubah), jadi bisa dihitung retrospektif untuk kuartal mana pun:

1. Query `kesesuaianAktifRows` (bukan reuse `activePssp`/`getActivePsspByOutlets`, yang cuma mengembalikan kontrak yang masih berjalan HARI INI — kontrak yang sudah berakhir sebelum hari ini tapi sempat berjalan di Q-sebelumnya akan salah ke-exclude kalau reuse itu) — `prisma.psspKontrak.findMany` scoped ke `kdOutlet` (sama scope `outletKodesForMR` dipakai di seluruh halaman ini) dan `prdAwal`/`prdAkhir` yang overlap jendela gabungan [awal Q-sebelumnya, akhir Q-berjalan]. Sejak 2026-08-06 juga men-select `kdProduk`/`nmProduk` supaya bisa difilter ke Produk Kontes (dipakai §4's Varian Produk Kontes).
2. **Value** = `estBaris` tiap kontrak diapportion rata ke bulan-bulan durasi kontraknya sendiri (`monthsInRange`), lalu dijumlah untuk bulan-bulan yang termasuk kuartal itu — fungsi generik `tercacahAktifForQuarter(rows, months)` (2026-08-06, menggantikan cache Map + closure terpisah sebelumnya) menerima SUBSET rows apa pun (dipakai untuk full outlet-scope dan untuk subset Produk Kontes).
3. **Jumlah** = hitungan kontrak distinct (`kdCust`+`cUrut`) yang rentang bulannya beririsan dengan bulan-bulan kuartal itu (bukan diapportion, cuma dihitung "pernah menyentuh kuartal ini atau tidak").

Query ini genuinely baru (tidak ada di `docs/PERFORMANCE.md` sebelumnya) tapi scope-nya sama dengan pola yang sudah ada (`kdOutlet` in `outletKodesForMR`, jendela waktu terbatas ~2 kuartal) — bukan company-wide-unbounded.

### Semua "Estimasi" di tab Ringkasan sekarang genuinely TERCACAH (2026-08-06)

Dikonfirmasi pengguna: *"semua estimasi, mau itu PSSP aktif atau PSSP Rencana di ringkasan summary, itu dibuat tercacah sesuai filter quarter nya."* Sebelum perbaikan ini, cuma sebagian figur yang genuinely tercacah (§2's kolom Aktif via `kesesuaianAktifRows` di atas) — figur lain (`estimasiTotal`/`estimasiAktifTotal`, dipakai company-wide oleh tab LAIN juga) masih raw: Rencana = jumlah penuh `rencanaTotalBiaya` tiap line item (bisa mencakup bulan di luar kuartal yang dipilih kalau `periodeAwal`/`lamaPeriode` line item itu lebih panjang dari 1 kuartal), Aktif = kontrak yang aktif HARI INI (bukan yang aktif pada kuartal yang difilter).

**Prinsip**: `estimasiTotal`/`estimasiAktifTotal` (dan `groups`-nya) TETAP dipakai apa adanya oleh tab lain (Per Personil/Outlet/Customer/dll — itu tabs lain punya semantik sendiri, tidak disentuh). Untuk tab Ringkasan spesifik, setiap figur "Estimasi"/"PSSP Rencana"/"PSSP Aktif" sekarang membaca variabel tercacah-nya sendiri:

| Figur | Sumber tercacah | Dipakai di |
|---|---|---|
| PSSP Rencana Q-Berjalan | `rencanaMonthlyBreakdownQ` (`computeMonthlyBreakdown(lineItems)`, dijumlah untuk bulan-bulan Q-Berjalan) | §4 tile, §3 stacked bar, §5 "Breakdown Nilai Estimasi", §5d Produktifitas |
| PSSP Rencana Q-Sebelumnya | Query BARU `lineItemsSebelumnya` (line item penuh, bukan cuma `_sum` agregat) → `computeMonthlyBreakdown` → dijumlah untuk bulan-bulan Q-Sebelumnya | §3 stacked bar panel Q-Sebelumnya |
| PSSP Aktif Q-Berjalan/Q-Sebelumnya | `kesesuaianAktifQBerjalan`/`kesesuaianAktifQSebelumnya` (lihat formula di atas) | §4 tile ×2, §3 stacked bar, §5 (semua baris yang tadinya pakai `estimasiAktifTotal`) |
| PSSP Rencana/Aktif Produk Kontes | `kontesEstimasiRencanaTercacah` (`computeMonthlyBreakdown(kontesLineItems)`), `kontesAktifQBerjalan` (`tercacahAktifForQuarter` di-filter produk Kontes via `getAllPakets`) | §4 Varian Produk Kontes tile |

**Sengaja TIDAK diubah** (di luar scope "Estimasi"): Nilai PSSP (`ringkasanPsspTotal`, beda formula — `base × persenPsspDokter × pengaliNilaiR`, bukan `base` saja) dan komponen Biaya persentase (DPL/DPF, DP, Listing Fee Rencana, Entertain) di §5e — masih raw, kandidat perluasan lanjutan kalau diminta eksplisit.

Per-produk-kontes breakdown TABLE (§4, kolom "Estimasi PSSP Rencana"/"Estimasi PSSP Aktif") **sengaja tetap raw/Full Periode**, TIDAK diubah — kolom "Estimasi Tercacah" di tabel yang sama sudah jadi angka tercacahnya; membuat kedua kolom itu sama-sama tercacah akan bikin mereka duplikat satu sama lain. Sama pola "Full Periode vs Tercacah" yang sudah dipakai di panel "Ringkasan POA" draft POA (`DraftChecklist.tsx`).

### Estimasi PSSP per Bulan — BARU (2026-08-06)

Dikonfirmasi pengguna: *"aku mau ada yang breakdown by bulan di ringkasan summary juga kayak yang ada di ringkasan draft POA."* Awalnya dibuat sebagai kartu terpisah, lalu diklarifikasi ulang di hari yang sama: *"perintah ini belum terpenuhi... maksudnya itu adalah di atas varian produk kontes"* — jadi **BUKAN kartu terpisah**, melainkan SUBSECTION di dalam kartu §4 ("Target / Estimasi / Sales / Pelunasan"), diletakkan tepat di bawah grid tile utama dan di atas "Varian Produk Kontes" (sama visual language demotion — label uppercase muted + border-top — yang sudah dipakai "Varian Produk Kontes" sendiri, bukan `<Card>` bersarang). Tabel dengan kolom Bulan / PSSP Rencana / PSSP Aktif — sama bentuk dan sama komponen sumber (`computeMonthlyBreakdown`) dengan panel "Estimasi & Nilai PSSP per Bulan" di `DraftChecklist.tsx` ("Ringkasan POA" per-draft), cuma di level agregat Ringkasan (company/subtree-wide, bukan satu POA).

- **Cakupan bulan**: `kesesuaianWindowMonths` — union bulan-bulan Q-Sebelumnya + Q-Berjalan (6 bulan), sama window yang §2's formula Aktif sudah pakai. Bukan seluruh histori — tetap dibatasi ke kuartal yang sedang difilter + pembandingnya, konsisten dengan filter kuartal yang aktif di tab ini.
- **PSSP Rencana per bulan**: gabungan `ringkasanMonthlyBreakdown` (dari `lineItems`, Q-Berjalan) + `sebelumnyaMonthlyBreakdown` (dari `lineItemsSebelumnya`, Q-Sebelumnya) — genuinely tercacah per bulan, bukan dibagi rata dari total kuartal.
- **PSSP Aktif per bulan**: `kesesuaianAktifMonthlyMap` (dari `kesesuaianAktifRows`, sama query §2) — Map per-bulan terpisah dari `tercacahAktifForQuarter` (yang cuma butuh SUM per kuartal + hitungan kontrak distinct, bukan breakdown per bulan).

## 3. Pencapaian Target

*(Rename dari "Proyeksi Pencapaian Target" — dikonfirmasi pengguna 2026-08-05, kata "Proyeksi" dihapus karena tidak ada proyeksi/ekstrapolasi yang dilakukan.)*

**Bentuk final (direvisi 2026-08-06): horizontal STACKED bar chart**, bukan meter/gauge tunggal. Target = baseline 100%; PSSP Rencana dan PSSP Aktif masing-masing dihitung sebagai % dari Target lalu ditumpuk (stacked) dalam satu bar, dengan garis referensi di posisi 100% (`RingkasanTargetStackedBar`, `src/components/poa/RingkasanCharts.tsx`). Dua panel — Q-Sebelumnya dan Q-Berjalan — masing-masing dengan bar-nya sendiri:

- `rencanaPct = PSSP Rencana kuartal itu ÷ Target kuartal itu × 100`
- `aktifPct = PSSP Aktif kuartal itu ÷ Target kuartal itu × 100`

**Perbaikan sekaligus dari revisi ini**: sebelumnya kedua panel salah memakai `estimasiAktifTotal` ("aktif sekarang") yang SAMA untuk kedua kuartal, dan tidak ada dimensi Rencana sama sekali (cuma Aktif vs Target). Sekarang Aktif memakai figur genuinely per-kuartal yang sama dengan §2 (`kesesuaianAktifQBerjalan`/`kesesuaianAktifQSebelumnya`, tercacah per-kuartal), dan Rencana memakai figur genuinely per-kuartal juga: `kesesuaianValueRencana` untuk Q-Berjalan (sudah scoped ke kuartal itu lewat `effPeriodFrom`/`effPeriodTo`), dan `rencanaSebelumnyaTotal` untuk Q-Sebelumnya — agregat BARU (`prisma.poaLineItem.aggregate`, scoped ke POA-POA yang sudah difetch untuk `targetSebelumnyaTotal`), bukan reuse Q-Berjalan.

**Target dummy khusus ADMIN** (2026-08-06, "di admin tolong pakai target dummy dulu") — sama pola scaffolding dengan §4: kalau Target asli (`poa.target`) genuinely 0/belum diisi untuk kuartal itu, role ADMIN melihat Target dummy deterministik (`(PSSP Rencana + PSSP Aktif kuartal itu) × multiplier 0.7-1.4`, hash dari string kuartal, stabil antar-refresh — bukan `Math.random()`) supaya bar-nya bisa dicek visualnya sebelum data Target asli lengkap. Ditandai suffix `"(dummy)"` + banner peringatan di atas chart. Role lain tetap "-" kalau Target genuinely 0 — bukan perilaku baru, cuma tambahan untuk ADMIN. Target asli (berapa pun nilainya) selalu menang atas dummy.

## 4. Kelompok metrik Value + Unit

**Sekarang section PERTAMA di tab Ringkasan** (2026-08-06 follow-up: "section 'Target / Estimasi / Sales / Pelunasan' taro paling atas jadinya" — dipindah dari urutan ke-3 setelah §2 dihapus, lihat §2 di atas).

Enam tile (bertambah 1 dari lima semula), masing-masing ditampilkan dengan **Value** (nominal) dan **Unit** (satuan — kemungkinan Rupiah untuk sebagian besar, tetapi belum eksplisit disebutkan per metrik):

| Metrik | Catatan |
|---|---|
| Target | Kemungkinan reuse `docs/form-poa/01-business-rules.md` §3 "Resolusi Target" (poa.target manual, fallback ke `SUM(TargetHospitalValue.target)`) — belum dikonfirmasi apakah requirement ini memaksudkan sumber yang sama persis. |
| Estimasi PSSP Rencana | Estimasi dari rencana POA (nilai "Pengajuan" lama, lihat §1). Tercacah Q-Berjalan (lihat §2). |
| Estimasi PSSP Aktif | Estimasi dari kontrak PSSP yang aktif Q-Berjalan (`estBaris` via `PsspKontrak`, tercacah — lihat §2), pola sama seperti kolom "Estimasi Aktif+Pengajuan" yang sudah ada — lihat `docs/form-poa/03-ui-and-access.md` §3. |
| **Estimasi PSSP Aktif (Q-Sebelumnya)** | **BARU (2026-08-06)** — dipindah dari tabel §2 Kesesuaian POA yang dihapus ("yang jumlah dan value PSSP Aktif Q-2 itu taro aja di yang section bawah"). Sama formula tercacah dengan tile di atas, di-scope ke bulan-bulan Q-Sebelumnya. |
| Sales | Kemungkinan `OutletSalesValueMonthly` (real sales dari sync `DIR10001B`) — sama sumber yang sudah dipakai di chart "Estimasi vs Realisasi" Ringkasan saat ini. Belum dikonfirmasi. |
| Pelunasan | Kemungkinan persentase pelunasan kontrak PSSP aktif (`totalLunas / totalEst` atau serupa, konsep yang sudah ada di panel Histori PSSP — `docs/form-poa/01-business-rules.md` §5). Belum dikonfirmasi apakah ini level agregat (semua kontrak) atau rata-rata per kontrak. |

Header kartu ini juga sekarang menampilkan ikon info (`HeaderInfo`, metodologi tercacah — sama teks yang dulu ada di §2) dan counts-line "N MR · N POA · N pengajuan · Q-Berjalan ... (gunakan Filter Kuartal untuk ganti)" — keduanya dipindah dari §2 yang dihapus.

### Varian Produk Kontes

Empat dari lima metrik di atas (**tanpa Pelunasan**), dihitung khusus untuk baris/data yang termasuk kategori "Produk Kontes" (`OutletProductKriteria.kategori`, konsep yang sudah ada — lihat `docs/form-poa/02-data-model.md` §"Outlet master data"):
- Target
- Estimasi PSSP Rencana
- Estimasi PSSP Aktif
- Sales

❓ Requirement tidak menjelaskan kenapa Pelunasan dikecualikan dari varian ini — mungkin karena "Pelunasan" secara konsep tidak dipecah per kategori produk di data yang ada, mungkin juga cuma belum kepikiran. Perlu dikonfirmasi apakah ini keputusan sengaja atau celah yang perlu diisi.

*(2026-08-06: "Rata-Rata Variasi per Estimasi PSSP" sempat ditambahkan sebagai chart duplikat di card ini, lalu direvert hari yang sama — pengguna mengklarifikasi metrik ini secara konsep MEMANG tentang variasi Produk Kontes, jadi cukup satu tempat: §5 "Produk", dengan datanya sendiri dikoreksi supaya scoped ke Kontes — lihat §5 di bawah, bukan duplikat di §4.)*

### Breakdown per produk kontes individual (2026-08-05, putaran klarifikasi ketiga)

Varian Produk Kontes di atas cuma AGREGAT (semua produk kontes digabung jadi 1 angka). Dikonfirmasi pengguna: butuh breakdown per PRODUK individual, ditampilkan sebagai **tabel** (bukan chart/card — draft sempat berupa grid kartu progress-bar bergaya "target vs tercapai", direvisi jadi tabel biasa karena lebih cepat di-scan untuk puluhan baris).

**Kolom tabel** (satu baris per produk kontes):

| Kolom | Formula/sumber | Catatan |
|---|---|---|
| Produk | Nama produk (`namaProduk`) | — |
| Target | Per-produk, **belum ada di data model manapun** | Genuinely tidak tersedia untuk role selain ADMIN (lihat di bawah), bukan sekadar belum dihitung. |
| Estimasi Tercacah | `computeMonthlyBreakdown()` (`src/lib/poaUtils.ts`, apportionment bulanan yang sama dipakai di `docs/form-poa/01-business-rules.md` §3 "Tercacah"), dijalankan ulang per produk (di-scope ke line item produk itu saja), dijumlah untuk bulan-bulan dalam Q-Berjalan | Dikonfirmasi pengguna: dihitung ULANG per produk individual, bukan pakai angka agregat yang dibagi rata. |
| Estimasi PSSP Rencana | Sum `rencanaTotalBiaya` line item produk itu (Q-Berjalan) | Sama seperti tile agregat, di-scope per produk. |
| Estimasi PSSP Aktif | Sum `estBaris` kontrak `PsspKontrak` aktif produk itu | Sama seperti tile agregat, di-scope per produk. |
| Sales {Q-Berjalan} | `salesValueByProduk` (qty × HNA, sama sumber tile agregat) | Di-scope per produk (`kodeProduk`/`itemKode`). |
| % Estimasi Tercacah dari Target | `Estimasi Tercacah ÷ Target × 100` | **Ganti dari formula lama** ("% Aktif tercapai dari Rencana") — dikoreksi eksplisit oleh pengguna 2026-08-05: "harusnya bukan % Aktif tercapai dari Rencana, tapi ada % estimasi tercacah dari target". |
| % Sales {Q-Berjalan} dari Target | `Sales ÷ Target × 100` | Formula kedua yang diminta pengguna di koreksi yang sama. |

**Target per produk kontes — dummy khusus ADMIN untuk testing** (2026-08-05, putaran klarifikasi keempat): karena Target per produk belum ada di data model ("nanti akan ada target per produk kontes" — dikonfirmasi pengguna akan dibangun di masa depan), kedua kolom rasio di atas gak bisa dihitung untuk sebagian besar role. **Khusus role ADMIN**, ditampilkan angka dummy deterministik (hash dari `kodeProduk` × 0.7-1.4 dari `rencanaTotalBiaya` produk itu, stabil antar-refresh — bukan `Math.random()`) supaya tampilan tabel + kedua kolom rasio bisa dicek secara visual sebelum data Target asli ada. Ditandai eksplisit dengan suffix `"(dummy)"` di tiap angka + banner peringatan di atas tabel. Role lain tetap menampilkan "Tidak tersedia" untuk Target dan kedua kolom rasio — perilaku sebelum dummy ini ditambahkan.

## 5. Breakdown historis (5 kelompok, 13 metrik turunan)

Draft requirement awal menyebut **4 dimensi historis**: `Q-Sebelumnya (Aktif)`, `Rencana`, `Aktif`, `Realisasi`.

**Dipersempit oleh pengguna 2026-08-05**: untuk versi ini, dimensi `Q-Sebelumnya` dan `Realisasi` **TIDAK dipakai dulu** ("untuk sementara jangan pakai Q-Sebelumnya dan Realisasi dulu deh"). Jadi tiap metrik di §5a-§5e cukup ditampilkan dengan **2 dimensi**: `Rencana` (= PSSP Rencana) dan `Aktif` (= PSSP Aktif), definisi §1, konsisten di semua 13 metrik. Dimensi `Q-Sebelumnya`/`Realisasi` dicatat sebagai kandidat perluasan di masa depan (lihat §"Non-goals" di `03-ui-and-access.md`), bukan dihapus dari requirement — kalau nanti dibutuhkan lagi, definisinya masih perlu diklarifikasi ulang ke pengguna (lihat riwayat pertanyaan yang belum terjawab soal ini di git history dokumen ini).

### 5a. Manajemen Risiko

| Metrik | Catatan |
|---|---|
| Rata-rata Lama Periode | Kemungkinan rata-rata `lamaPeriode`/durasi kontrak PSSP (field sudah ada di `PoaLineItem`/`PsspKontrak`, lihat `docs/form-poa/01-business-rules.md` §4). Belum jelas skop rata-ratanya — per customer, per line item, atau company-wide. |
| Breakdown Nilai Estimasi by Bulan | Kemungkinan reuse `computeMonthlyBreakdown` (apportionment bulanan yang sudah ada, `docs/form-poa/01-business-rules.md` §3 "Tercacah") — belum dikonfirmasi. |

### 5b. Customer

| Metrik | Catatan |
|---|---|
| Jumlah Customer | Hitungan customer distinct — skop (per POA/per periode/company-wide) belum jelas. |
| Breakdown User dan KPDM | Kemungkinan berdasarkan `PihakPssp` enum (USER/KPDM, `docs/form-poa/01-business-rules.md` §3 "Pihak PSSP") — reuse konsep yang sudah ada, catatan penting: field ini di sistem saat ini "cuma switch label tampilan", jadi perlu dikonfirmasi apakah breakdown ini valid secara data atau perlu sumber lain. |
| Rata-rata Pemberian per Customer | **Dikonfirmasi pengguna 2026-08-05**: "Pemberian" = **Nilai PSSP** (`rencanaTotalBiaya × persenPsspDokter × pengaliNilaiR`, formula yang sudah ada — `docs/form-poa/01-business-rules.md` §3). Jadi metrik ini = rata-rata Nilai PSSP per customer. |
| Rata-rata Estimasi Bulanan per Customer | Kemungkinan rata-rata dari breakdown bulanan (§5a) dibagi jumlah customer — belum dikonfirmasi. |
| Jumlah Customer Baru vs Retention | Kemungkinan reuse klasifikasi `labelCustomer` yang sudah ada ("Dokter Baru" vs "Retensi", `docs/form-poa/01-business-rules.md` §5) — kandidat kuat karena istilahnya persis sama, tetapi belum dikonfirmasi eksplisit oleh pengguna. |
| Rata-Rata Estimasi PSSP ke Berapa | **Dikonfirmasi pengguna 2026-08-05**: metrik ini punya dua varian mengikuti dimensi Rencana/Aktif (§5) — untuk dimensi **Aktif**, nilainya = rata-rata urutan ke berapa dari kontrak PSSP customer yang **sedang aktif** sekarang (mis. ini PSSP ke-3 customer tersebut); untuk dimensi **Rencana**, nilainya = rata-rata urutan ke berapa dari PSSP yang **direncanakan** di POA (mis. rencana ini akan jadi PSSP ke-4 customer tersebut). Sumber data: histori `PsspKontrak` per customer (`kdCust`), diurutkan berdasarkan periode kontrak. |

### 5c. Produk

| Metrik | Catatan |
|---|---|
| Rata-Rata Variasi **Produk** per Estimasi PSSP | **Dikonfirmasi pengguna 2026-08-05**: rata-rata jumlah **produk unik** (distinct) per estimasi PSSP — bukan dibagi nilai estimasi seperti dugaan sebelumnya. Scoped ke seluruh katalog produk (`lineItems`/`activePssp`, tidak dibatasi Kontes). |
| Rata-Rata Variasi **Produk Kontes** per Estimasi PSSP | **BARIS TERPISAH** (2026-08-06, final: "jadi ada rata-rata variasi produk kontes dan all produk, itu dipisah") — sama formula dengan baris di atas, tapi scoped ke `kontesLineItems`/`kontesActivePssp` (Produk Kontes saja, sama filter yang §4 pakai). *(Riwayat: sempat ditambahkan sebagai chart duplikat di §4, direvert; lalu sempat MENGGANTIKAN baris "All Produk" di atas alih-alih jadi baris terpisah — juga dikoreksi setelah pengguna menegaskan keduanya harus ada, dipisah jadi 2 baris.)* |
| Jumlah Produk x Estimasi PSSP | **Dikonfirmasi pengguna 2026-08-05**: "x" BUKAN perkalian — metrik ini = jumlah **baris** (line item `PoaLineItem`/`PsspKontrak`) untuk tiap dimensi Rencana/Aktif/dll (§5). Nama metrik sebaiknya diubah jadi lebih jelas saat implementasi (mis. "Jumlah Baris per Estimasi PSSP") supaya tidak disalahartikan sebagai perkalian oleh pembaca berikutnya — dicatat di sini, bukan diubah sepihak di draft asli pengguna. |

### 5d. Produktifitas

| Metrik | Catatan |
|---|---|
| Estimasi PSSP per MR | Kemungkinan total estimasi dibagi jumlah MR yang submit di periode itu — pola serupa "Estimasi Per User" yang sudah ada di kolom Summary Per Outlet (`docs/form-poa/03-ui-and-access.md` §3), tapi "per User" di situ = per customer, bukan per MR. Perlu dikonfirmasi ini bukan hal yang sama. |

### 5e. Biaya

| Metrik | Catatan |
|---|---|
| **Ratio Biaya** | **BARU (2026-08-06, "tetap tambahkan ratio biaya")** — `(PSSP + DPL/DPF + DP + Listing Fee + Entertain) ÷ Estimasi (tercacah) × 100`, sama konsep dengan "Cost Ratio"/"% Budget" yang sudah ada per-baris di `TerritoryTable` (`biayaAktifPengajuan ÷ estimasiAktifPengajuan`), diterapkan di level agregat Ringkasan. Rencana = total 5 komponen di bawah ÷ `kesesuaianValueRencana`. Aktif = SEBAGIAN saja (cuma PSSP + Listing Fee, dua komponen Aktif yang genuinely computable — lihat baris di bawah) ÷ `kesesuaianAktifQBerjalan.value`, bukan total biaya Aktif yang lengkap, karena DPL/DPF, DP, Entertain Aktif genuinely tidak tersedia. Ditampilkan sebagai baris pertama grup Biaya. |
| PSSP | Nilai PSSP (`persenPsspDokter × pengaliNilaiR × rencanaTotalBiaya`, sudah ada — `docs/form-poa/01-business-rules.md` §3). |
| DPL/DPF | Kemungkinan dari `persenDiskon` (sumber `DiskonKontrak`/`DiskonHistory`, sudah ada — `docs/form-poa/02-data-model.md` §"Discount"). Belum jelas apakah DPL dan DPF dipisah jadi 2 angka atau digabung jadi satu label "DPL/DPF". |
| DP | Kemungkinan `persenDp` (sudah ada sebagai field, `docs/form-poa/01-business-rules.md` §2). |
| Listing Fee | Kemungkinan `persenListingFee`/`ListingFeeKontrak` (sudah ada, `docs/form-poa/02-data-model.md` §"Listing Fee"). |
| Entertain | Kemungkinan `persenEntertain` (sudah ada sebagai field). |

Kelima baris ini kemungkinan besar sama persis dengan breakdown budget yang SUDAH ADA di Ringkasan saat ini (`docs/form-poa/03-ui-and-access.md` §3: "breakdown budget (PSSP/Discount/Entertain + Total Budget)") — kemungkinan proposal ini hanya meminta breakdown yang lebih rinci (DPL/DPF/DP dipisah, bukan digabung jadi "Discount") ditambah dimensi historis 4-kolom di §5. Perlu dikonfirmasi ini betul reorganisasi dari yang sudah ada, bukan sumber data baru.

## Open questions — status & assumptions

*(Konvensi ⚠️/❓/✅ mengikuti `docs/sdd/03-conventions.md`. Diperbarui 2026-08-05 setelah beberapa putaran klarifikasi lanjutan dengan pengguna — lihat status per item.)*

**✅ Terjawab penuh (2026-08-05, seluruh putaran):**
1. Formula "Kesesuaian POA" — **direvisi total di putaran lanjutan**: awalnya "4 angka berdampingan tanpa kalkulasi" (chart), sekarang **tabel** 3 kelompok kolom (Rencana/Aktif Q-berjalan/Aktif Q-sebelumnya) × 2 sub-kolom (Jumlah/Value). Lihat §2.
2. Formula "Pencapaian Target" (rename dari "Proyeksi Pencapaian Target") — tidak ada mekanisme proyeksi, dua perbandingan langsung ke Target (Q-Sebelumnya vs Target, Q-Berjalan vs Target), By Value/Unit saja, chart Meter. Lihat §3.
3. Dimensi breakdown historis §5 — `Q-Sebelumnya`/`Realisasi` untuk sementara TIDAK dipakai, cukup 2 dimensi (`Rencana`, `Aktif`). Lihat §5.
4. "Rata-rata Pemberian per Customer" — "Pemberian" = Nilai PSSP. Lihat §5b.
5. "Rata-Rata Estimasi PSSP ke Berapa" — dua varian (Aktif = urutan PSSP yang sedang aktif, Rencana = urutan PSSP yang direncanakan). Lihat §5b.
6. "Rata-Rata Variasi per Estimasi PSSP" / "Jumlah Produk x Estimasi PSSP" — variasi = jumlah produk unik per estimasi; "x" bukan perkalian, metrik kedua = jumlah baris per dimensi. Lihat §5c.
7. Bentuk tampilan §2 dan §4-breakdown — **dikonfirmasi TABEL, bukan chart** (koreksi dari implementasi chart sebelumnya). Lihat §2 dan §4 "Breakdown per produk kontes individual".
8. Formula rasio §4-breakdown per produk — **dikoreksi dari "% Aktif tercapai dari Rencana" menjadi "% Estimasi Tercacah dari Target" dan "% Sales dari Target"**. Lihat §4.
9. Target per produk kontes — **dikonfirmasi belum ada di data model, akan dibangun di masa depan** ("nanti akan ada target per produk kontes"). Dummy khusus ADMIN untuk testing tampilan sementara ini dibangun sebagai jembatan, bukan data asli. Lihat §4.
10. Estimasi Tercacah per produk — **dikonfirmasi dihitung ulang per produk individual** (bukan pembagian rata dari angka agregat). Lihat §4.

**Tidak ada lagi open question berstatus BLOCKING.** Sebelum implementasi lanjutan (mis. saat Target per produk kontes asli tersedia dan dummy-nya perlu dicopot), tetap disarankan satu putaran konfirmasi terakhir ke pengguna, sebagai langkah "convergence check" standar (`docs/sdd/01-when-and-workflow.md` §2).

**Non-blocking — bisa diasumsikan sementara, tapi wajib dicatat di kode kalau nanti diimplementasikan:**
1. Scope rename "Pengajuan" → "PSSP Rencana" (§1) — global vs lokal ke tab Ringkasan.
2. ~~Apakah pembatasan filter "hanya satu quarter" berlaku ke seluruh halaman `/summary` atau khusus tab Ringkasan.~~ — **TERJAWAB 2026-08-07: seluruh halaman.** Filter rentang periode dihapus, `RingkasanQuarterFilter` berlaku untuk keenam tab (lihat §1 "Metrik di dokumen ini TIDAK lagi eksklusif tab Ringkasan").
3. Alasan Pelunasan dikecualikan dari varian Produk Kontes (§4) — sengaja atau belum lengkap.
4. Operator persis "Pencapaian Target" (§3) — asumsi kerja: persentase (`PSSP Aktif ÷ Target × 100`), mengikuti pola "Estimasi % Target" yang sudah ada.
5. Skop "Jumlah Customer"/"Rata-rata Lama Periode" (§5a-§5b) — per POA, per periode, atau company-wide.
6. Apakah breakdown Biaya (§5e) murni reorganisasi dari breakdown budget yang sudah ada di Ringkasan saat ini, atau memang dimaksudkan sebagai section baru yang terpisah.
7. Kapan/apakah dimensi `Q-Sebelumnya`/`Realisasi` (§5) akan diaktifkan kembali di versi berikutnya — dicatat sebagai kandidat perluasan, bukan dihapus permanen dari requirement.
