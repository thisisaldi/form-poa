# MCL — Business Rules

Sumber: percakapan Clara 2026-10-13 ("ada untuk rekomendasi POA standarisasi di sheets 'main'", "ada bridging spesialis untuk rekomendasi pssp + kasih warning kl estimasi produknya gak sesuai dgn spesialisasi dokternya pakai sheets 'list spesialisasi'"), memo rapat Pak Brian/Pak Arthur, dan pengukuran langsung terhadap file Excel 2026-10-14/15.

## §1. Apa itu MCL

| Bagian | Isi | Dipakai untuk |
|---|---|---|
| Sheet `Main` | Per baris: hierarki (GM..FF sebagai teks nama), `KODE PI`, outlet, `SPESIALIS`, `NAMA DOKTER`, `KODE/NAMA PRODUK`, `KETERANGAN` (alasan klinis), `STATUS STANDARISASI`, `ESTIMASI AKTIF`, `SUM OF PELUNASAN` | Rekomendasi POA Standarisasi + indikator "sudah standarisasi" |
| Sheet `Bank Spesialis` | Mapping spesialis → produk + keterangan relevansi | **Sudah dibangun terpisah** — tabel `BankSpesialis`, Produk Kontes, warning spesialisasi (`docs/poa-bank-spesialis/`, 2026-10-13). Di luar scope dokumen ini (§5) |
| Sheet lain (`Struktur`, `List Dokter PSSP`, `List hospital HMA`, dst.) | Pendukung | Di luar scope v1 |

Header `Main` ada di baris 3 (baris 1-2 kosong); 321.010 baris data, 293 `KODE PI` unik, 6.297 dokter unik per (outlet, nama), 151 produk, 16 spesialis. Status ada **empat nilai** (bukan dua):

| `STATUS STANDARISASI` | Baris | Perlakuan v1 |
|---|---|---|
| `SUDAH LISTING` | 37.909 | **Sudah** |
| `BELUM LISTING` | 243.773 | Belum |
| `PRODUK TIDAK ADA DI DATA LISTING` | 28.585 | Belum ⚠️ (§6 Q3) |
| `OUTLET TIDAK ADA DI DATA LISTING` | 10.743 | Belum ⚠️ (§6 Q3) |

## §2. Aturan indikator "sudah standarisasi" (menggantikan definisi 2026-10-01)

Sebelumnya (`docs/poa-standarisasi/01-business-rules.md` §2, "Update 2026-10-01"): sales 3 bulan kalender penuh **DAN** DPL aktif. Per keputusan pengguna 2026-10-14: **dari Excel saja**.

- Granularitas = **(kodePI, kodeProduk)**, bukan per dokter. Terverifikasi: dari 41.515 pasangan (outlet, produk), 0 yang statusnya berbeda antar dokter.
- **Sumber utama = Excel.** Sudah standarisasi ⇔ status Excel = `SUDAH LISTING`. Selain itu belum.
- **Pelengkap satu arah (keputusan pengguna 2026-10-15, Q1):** karena Excel tidak akan diperbarui, (outlet, produk) yang statusnya "belum" di Excel tetap dihitung **sudah** bila ada pengajuan POA Standarisasi final submit (`PoaStandarisasiProduk` dengan `pengajuan.submittedAt` terisi, tidak `standarisasiGagal`) di outlet yang sama untuk produk itu. Tidak pernah sebaliknya: Excel "sudah" tidak dibatalkan oleh data app. Sinyal ini sudah ada di `computeStatusPengajuanMap` (sinyal ke-2 definisi lama) sehingga tidak butuh query baru.
- Sinyal sales 3 bulan dan DPL aktif **tidak lagi** menentukan indikator (tetap tampil sebagai informasi di kartu produk).
- Berlaku di tempat yang sama dengan definisi lama: status Baru/Perpanjangan per produk (`computeStatusPengajuanMap`, `poaStandarisasi.ts`), badge/tab "Sudah Standarisasi" di `RekomendasiSidebar`, dan info RS segrup (`getStandarisasiGroupOutletsAction`).
- Tidak diubah: Monitoring Standarisasi (`getStandarisasiDashboardAction`) tetap dari pengajuan yang final submit (sama seperti catatan 2026-10-01).
- Pengajuan yang sudah tersimpan tidak dihitung ulang (label `statusPengajuan` dihitung saat Planning disimpan).

## §3. Aturan rekomendasi dokter

- **POA Standarisasi** (unit = produk × outlet): rekomendasi ditampilkan **per outlet** (outlet yang sedang dipilih di Planning), dikelompokkan per dokter → daftar produk yang direkomendasikan beserta `KETERANGAN`.
- **POA Estimasi** (unit = dokter × produk, `LineItemEditor`): rekomendasi ditampilkan **per dokter** yang sedang dikerjakan — daftar produk Excel untuk dokter itu di outlet itu, dengan status listing (outlet, produk) di sebelahnya, dan bisa diklik untuk ditambahkan ke POA (mekanisme `onSelectProduct` yang sudah ada). Untuk dokter yang tidak punya tautan `customerId`, pencarian memakai nama ternormalisasi dalam outlet yang sama.
- Sumber dokter yang bisa dipilih tetap `getCustomersByOutlet()` (`src/app/actions/customer.ts:764`; Exodus outlet endpoint + `CustomerOutlet` lokal + roster MR). MCL **tidak** menambah sumber dokter baru.
- Dokter Excel yang match yakin ke dokter terdaftar → ditandai dan bisa langsung dipilih. Dokter Excel yang tidak match → tampil dari data Excel dengan badge **"Belum terdaftar"**; MR mendaftarkannya lewat alur "Daftar User Baru" yang sudah ada (`createCustomerAction`).
- Dedupe: satu dokter tidak boleh muncul dua kali (Clara: "asal ga double dokter"). Kunci dedupe = (kodePI, nama ternormalisasi); baris Excel duplikat (4.815 baris (outlet, dokter, produk) dobel) digabung saat import.

## §4. Hasil pengukuran matching (2026-10-14/15, terhadap data production read-only)

Matching dibatasi per `KODE PI` lebih dulu, baru nama dokter dalam outlet itu.

| Sumber kandidat dokter | Ketemu dari 6.297 | % |
|---|---|---|
| `CustomerOutlet` lokal saja | 3.429 | 54,5% |
| Exodus outlet endpoint + lokal | 3.855 | 61,2% |
| + `customers-databases` (5 GM) | 3.855 | 61,2% (tambahan 0) |

Tidak ketemu: 2.442 (38,8%), tersebar di 258 dari 293 outlet — bukan masalah satu-dua outlet. Ini keterbatasan **data** (dokter belum terdaftar di outlet itu), bukan algoritma; fuzzy yang lebih agresif hanya menambah risiko salah orang. Tier match: exact ±50%, subset ±11% (nama Excel lebih panjang/pendek, risiko salah orang lebih tinggi), fuzzy ≈0,1%.

**Hasil dry-run `scripts/importMclRekomendasi.ts` (2026-10-15, `customerId` hanya dari `CustomerOutlet` lokal, belum termasuk dokter Exodus live):** 316.106 baris rekomendasi (dari 321.010; 991 baris placeholder nama `"0"` dilewati), 6.272 dokter unik: EXACT 3.232 (51,5%), SUBSET 221, FUZZY 3, tanpa tautan 2.816. Listing: 41.515 pasangan — SUDAH 3.875, BELUM 31.707, PRODUK_TIDAK_ADA 4.225, OUTLET_TIDAK_ADA 1.708; 0 konflik antar dokter. Dokter Exodus yang belum ada di tabel lokal terselesaikan saat runtime lewat `getCustomersByOutlet`, bukan saat import.

## §5. Bridging spesialis (sudah selesai, bukan bagian dokumen ini)

Bridging spesialis → produk + warning ketidaksesuaian di POA Estimasi sudah diimplementasikan 2026-10-13 di `docs/poa-bank-spesialis/` (tabel `BankSpesialis`, sheet "Bank Spesialis", Produk Kontes = produk Bank). MCL **tidak** menduplikasinya. Perbedaan peran: Bank Spesialis = produk yang cocok per **spesialis** (tanpa nama dokter/outlet); `Main` = produk yang direkomendasikan per **dokter bernama di outlet tertentu**, dengan keterangan dan status listing. Di POA Estimasi keduanya tampil berdampingan (section "Produk Kontes PM" dari Bank vs "Produk Rekomendasi Dokter" dari Main).

## §6. Open questions — status & assumptions dipakai untuk v1

| # | Pertanyaan | Blocking? | Asumsi kerja | Perlu konfirmasi dari |
|---|---|---|---|---|
| Q1 | ~~Murni Excel atau Excel + pengajuan final-submit?~~ **Terjawab 2026-10-15:** "excel sebagai utamanya untuk informasi sudah listing atau belum" — Excel = baseline utama; pengajuan final-submit di app sebagai overlay satu arah belum→sudah (§2). ⚠️ Tafsiran saya atas kata "utamanya"; bila yang dimaksud murni Excel, cukup hapus overlay (tanpa migrasi) | — | Excel utama + overlay satu arah | Pengguna (konfirmasi tafsiran) |
| Q2 | ~~Siapa yang menyediakan Excel versi baru dan seberapa sering?~~ **Terjawab 2026-10-15:** satu file saja, tidak ada refresh. | — | Import sekali via script; tidak perlu desain siklus refresh/UI upload | — |
| Q3 | `PRODUK TIDAK ADA DI DATA LISTING` dan `OUTLET TIDAK ADA DI DATA LISTING` = "belum"? | Tidak | Belum | Clara |
| Q4 | ~~Sheet spesialis mana yang resmi?~~ **Terjawab 2026-10-13** (`docs/poa-bank-spesialis/`): sheet `Bank Spesialis`; sheet "list spesialisasi" yang disebut Clara tidak ada di workbook. Sudah diimplementasikan. | — | — | — |
| Q5 | Fitur memo awal (note atasan→bawahan per dokter, list prioritas yang diarahkan atasan, "geser ke database lain") masih diharapkan? Perlu align dengan Bu Ummie & Pak Rudi (memo poin 3) | Tidak untuk v1 | Tidak masuk v1 | Pak Brian / Pak Arthur / Tim Sales |
| Q6 | `ESTIMASI AKTIF` / `SUM OF PELUNASAN` hanya terisi di 1.995 dari 321.010 baris — ditampilkan atau diabaikan? | Tidak | Disimpan, tidak ditampilkan di v1 | Clara |
| Q7 | Subset match (nama Excel vs DB tidak persis sama, ±11%) ditautkan otomatis atau hanya disarankan ("mungkin dokter yang sama")? | Tidak | Hanya disarankan, tidak auto-link | Pengguna |
| Q8 | Di POA Estimasi, rekomendasi cukup sebagai section di tab "Produk Rekomendasi" (per dokter yang sedang dikerjakan), atau juga perlu saran **dokter** per outlet saat memilih dokter (AddPanel)? Apakah POA Estimasi juga memakai bridging spesialis → produk (§5)? | Tidak | Hanya section per dokter di tab Produk Rekomendasi; saran dokter per outlet dan bridging menyusul | Pengguna / Clara |
