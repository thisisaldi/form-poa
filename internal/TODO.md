# REVISI LAYAR POA SYSTEM — TRACKER

*(Diupdate 2026-07-20 mengikuti "UPDATE PROGRESS REVISI SISTEM POA" dari stakeholder — 38 item, menggantikan penomoran lama. Sebut nomornya aja buat mulai kerjain satu item.)*

**Ringkasan**: ✅ DONE = 24 · 🟡 ON-PROSES = 5 · ❓ NEED CONFIRMATION = 9 *(#19 & #30 pindah ke DONE 07-20 — lihat catatan; awalnya dihitung ulang dari daftar stakeholder jadi 22/7/9, bukan 22/7/8 seperti tertulis awal karena totalnya harus pas 38)*

## ✅ Beres 07-21 begitu DB remote bisa diakses lagi

- ~~Jalankan `prisma migrate deploy`~~ — ternyata udah ke-apply duluan lewat deploy pipeline (termasuk `20260720163533_grant_admin_p260054`), tapi UPDATE-nya jadi no-op karena User P260054 emang belum pernah ada.
- **User P260054 dibuat baru** (nama: M NAUFALDI FADHLIRRAHMAN, role ADMIN, isActive true) — sebelumnya gak exist sama sekali di DB.
- **Hardcode sementara di `src/lib/auth.ts` (`HARDCODE_ADMIN_NIP`) sudah dihapus** — role ADMIN P260054 sekarang murni dari DB.
- **NIP Anggres Saputra diperbaiki**: L240075 → **L240076** (primary key User di-rename via transaksi, 50 baris `MrOutletAssignment` ikut pindah, plus field lain yang mungkin referensi — verified).

## ✅ DONE (24)

| No | Item | Catatan |
|---|---|---|
| 2 | Target sifatnya harus fix, gak bisa naik-turun | Selesai. |
| 3 | C urut historis drafting (periode aktif, gak boleh diedit) | Direstruktur 07-20 jadi per-dokter + toggle Detail expand per kontrak/produk, nama disensor. Bug "tercacah" (nilai kontrak kepakai full-period, bukan diapportion ke kuartal) sudah difix. Sudah ikut ke Excel export. ⚠️ Sisa kecil: growth pelunasan 3 bln terakhir di section ini masih belum dikerjain (lihat #5 catatan). |
| 4 | Hari Praktek per-produk, default otomatis dari level dokter | Selesai. |
| 6 | Nama outlet dipanjangin di dropdown | Combobox bisa lebih lebar dari trigger-nya. Sort outlet chain-first (grup di atas, NON CHAIN di bawah) juga sudah jalan — sempat ada bug 07-20: kolom `groupRS` di DB isinya literal string `"NON CHAIN"` (bukan `null`) utk outlet non-chain, jadi kena anggap truthy dan gak ke-sort; sudah difix pakai helper `isChainGroup()` di `LineItemEditor.tsx`. |
| 7 | Target Produk Fokus per area (target kuantitas, bukan cuma counter "1/22") | Card baru "Target Produk Fokus (Kuartal Ini)", pakai mesin `targetCalculation.ts`. Posisi di dekat tombol Export Excel. ⚠️ +~3 detik load time, belum di-cache. ⚠️ Semua keluar 0 di data lokal (OutletSalesMonthly kosong) — perlu dicek di production kalau masih "belum muncul". |
| 8 | Ratio Budget/Target dihilangin dari stat bar | Selesai — tapi ada feedback minta sebagian balik (duplikasi angka di kartu Ringkasan kanan), lihat item #9 (FEEDBACK #A.2). |
| 9 | Summary atasan perlu direview | Kemungkinan besar = FEEDBACK #A (screenshot Detail POA): (A.1) pindah section PSSP Aktif ke atas + stat "PSSP ESTIMASI AKTIF Q4", (A.2) hapus duplikasi Estimasi/Target/Ratio di kartu Ringkasan kanan, (A.3) growth dari Sales Quarter sebelumnya tampil kecil, (A.4) Pengali Nilai R + info visit/bulan di baris ringkasan dokter. ⚠️ Per cross-check 07-20: A.1/A.3/A.4 masih belum dieksekusi, cuma A.2 yang arahnya udah jelas (resolved) tapi belum jalan — kalau ditandai selesai di sini, perlu diverifikasi lagi item mana yang dimaksud "sudah direview". |
| 15 | Narfoz injeksi kelipatan jadi 5 | `konversiPembagi` 1 → 5. |
| 17 | Data diskon sinkron database | "% Diskon (DPL/DPF)" default ke `DiskonKontrak.newOnPi` asli begitu outlet+produk+Periode Awal ke-pilih, tetap bisa diedit manual. Kalau >1 kontrak match (double), dipilih `newOnPi` TERBESAR. Diverifikasi end-to-end (outlet FN000441 + ACETRAM, 2 kontrak overlap 30 vs 33.5 → auto-fill 33.50). 07-20: fallback dummy "10"/"2.5" (diskon/listing fee/entertain) diganti jadi 0 kalau memang gak ada data kontrak sama sekali. |
| 18 | Nilai R Final per dokter di draft | Baris "Nilai R Final" (weighted avg by rencanaTotalBiaya) di Daftar User + kolom per produk di detail expand. ⚠️ Ambiguitas nama field "Nilai R Final" vs "Pengali Nilai R" masih belum diklarifikasi — *"yang dimasukkin di draft itu bukan nilai R akhir, tapi pengali Nilai R"*. Jangan diubah/dihapus sebelum ada keputusan ganti-label vs tambah-field-baru. 07-20: posisi field "Pengali Nilai R" dipindah biar nempel langsung di bawah card "Nilai PSSP" (satu kolom grid yang sama), bukan lagi full-width di bawah seluruh grid. |
| 19 | Data dosis per Produk | **Selesai 07-20** — sumber data ternyata udah ada (`internal/List Product pharos.xlsx`, sheet "Oral Product"/"Injeksi Product"), gak perlu nunggu ABED. Kolom "PROCOD" di file itu ternyata sama persis dgn `Product.kodeProduk` (dikonfirmasi user, diverifikasi 191/192 kode match langsung ke DB). Prisma schema nambah 7 kolom baru (`dosisKekuatanSediaan`, `qtyPerRxPasien`, `lamaPemberianHari`, `jumlahPemberianPerHari`, `bentukSediaan`, `packing`, `indikasi`) via migration `20260720085421_add_product_dosis_zat_aktif_fields`, di-sync pakai script baru `scripts/syncProductZatAktifDosis.ts` (194 produk ke-update). Ditampilin sebagai teks abu-abu "Referensi: ..." di bawah field "Jml Produk ST / Resep" di `LineItemEditor.tsx`. Sisa: auto-fill produk kompetitor dari data survey — belum dikerjain. |
| 20 | Pengali Nilai R per produk, bukan totalan per dokter | Awalnya cuma fix unit `%`→`x`; versi "default dokter" dihapus total — sekarang murni per-produk. |
| 21 | Notes tambahan "untuk perkuat argumen pengajuan" saat Ajukan ke Atasan | Selesai. |
| 23 | Halaman approval + jumlah kunjungan MR ke user | ⚠️ **Perlu diverifikasi ulang** — per cross-check kode 07-20 gak ketemu implementasinya (halaman approval yang ada belum nampilin jumlah kunjungan MR). Ditandai selesai sesuai info terbaru dari stakeholder; tolong cross-check langsung ke halaman approval di app kalau perlu dipastikan lagi. |
| 24 | Satuan jual per box / Estimasi Produk Fokus | Card "Estimasi Produk Fokus" (+ stat bar atas) selesai. ⚠️ Per cross-check 07-20: detail per-produk dgn tanda warna kategori (fokus/red ocean/low hanging fruit) di tabel detail masih tabel polos, belum ada pewarnaan di situ — kalau ini dianggap "final", berarti requirement warna kategorinya cuma dianggap perlu di product picker (sudah ada, lihat #32), bukan di tabel detail. |
| 28 | Summary produk belum diajukan tapi rekomendasi PM (kuning/oranye) | Terjawab lewat item #31. |
| 29 | Sidebar "Produk Fokus PM Belum Diajukan" per spesialis | Muncul di sidebar kanan form MR begitu spesialisasi dokter ke-detect, isinya produk tier-0 yang belum ada di produkList. |
| 30 | Informasi Zat Aktif di product picker | **Selesai 07-20** — bareng #19, dari `internal/List Product pharos.xlsx`. `Product.zatAktif` (udah ada di schema tapi sebelumnya selalu `null` dari `syncProducts.ts`) sekarang keisi via `scripts/syncProductZatAktifDosis.ts`. Ditampilin di sublabel product picker (`buildProductOptions` di `LineItemEditor.tsx`, ikut ke-filter pas search) + di info bar setelah produk dipilih. |
| 31 | Kriteria Produk "Produk Pernah Di PSSP" | Badge "Pernah PSSP · Pelunasan 3 Bln XX%" di product picker, warna hijau ≥80% / kuning 40-79% / merah <40%, discope by histori PSSP dokter+outlet 3 bulan terakhir. |
| 32 | Warna Low Hanging Fruit (Ada Sales = Oren, Tidak Ada Sales = Kuning) | Pakai field `OutletProductKriteria.kategori`. 07-20: badge ini diubah jadi dot warna polos (gak nampilin teks "Low Hanging Fruit" lagi) di product picker — badge kriteria lain (standarisasi/kompetisi) tetap pakai teks seperti biasa. |
| 33 | Sinkron dgn kunjungan & PSSP aktif (kelihatan mana yg dikunjungi/tidak) | ⚠️ **Perlu diverifikasi** — gak ketemu fitur cross-reference kunjungan↔PSSP-aktif di kode per pengecekan 07-20. Kalau maksudnya beda dari yang saya cek, tolong dijelaskan lokasinya di app biar bisa di-follow up. |
| 34 | Detail periode untuk pelunasan yang buruk | Bagian dari panel Histori PSSP di form MR (nama RS/outlet tiap kontrak + filter ke outlet yang lagi dipilih) — selesai 07-20. |
| 35 | Detail running rate 3 bulan terakhir | Bagian dari panel Histori PSSP di form MR (running rate pace pelunasan utk kontrak aktif) — selesai 07-20. Sisa dari panel ini: sumber data "Pak Eko"/item NON ESTIMASI, masih CLARIFY (lihat #38-area / bagian bawah). |
| 37 | Tim NSM Ex-Hospinet gak bisa login ke sistem | Kemungkinan besar = fix "Case-insensitive login" (selesai). ⚠️ Gak ada jejak eksplisit "Hospinet" di kode/commit — kalau masih ada laporan gagal login dari tim ini, perlu dicek kasus spesifiknya (kemungkinan nip/username beda kapitalisasi atau isu lain). |

## 🟡 ON-PROSES (5)

| No | Item | Catatan |
|---|---|---|
| 1 | Struktur baru *(top urgent!!)* | **Progress besar 07-20**: import `internal/Struktur Verified Part KAM.xlsx` (sheet "ALL", 7334 outlet, NIP langsung per level GM/NSM/SM/ASM/SPV/MR — jauh lebih lengkap dari file draft lama). Dieksekusi via `scripts/importStrukturVerifiedKAM.ts`: OutletStrukturBaru refresh, Outlet ter-update (kota/provinsi/kategori/territory), 361 User di-upsert + 327 hierarki (nipAtasan) ke-wire otomatis, **1975 outlet dapat assignment MR baru/ter-override**. Bug data ditemukan & dikonfirmasi user: kolom "NIP NSM" di sheet "Eka" korup (rangkaian kode acak per baris) — NIP asli Eka `P260205`, di-hardcode sebagai override di script. Sisa: 4509 outlet masih gak ada MR yang resolve (dibiarkan pakai assignment lama) + 850 outlet punya NIP MR terisi tapi nama placeholder "DUMMY/VACANT" (kemungkinan sisa data karyawan lama, sengaja di-skip bukan ditebak) — sisanya genuinely keputusan bisnis manual (rekrutmen/reassignment), bukan lagi masalah data. Kasus spesifik "AP.K24 Matraman Jakarta Timur → harusnya kategori B" masih perlu di-crosscheck manual — field `Outlet.kategori` sekarang ada & populated dari file ini, tinggal dicek nilainya utk outlet itu (lihat juga #36). |
| 5 | Growth PSSP berdasarkan value 3 bulan terakhir | Card "Growth PSSP (3 Bln Terakhir)" di LineItemEditor sudah ada (nampilin growth dari data sales 3 bln terakhir, terpisah dari growth berbasis kontrak PSSP lama). Yang masih on-proses: growth **pelunasan** 3 bln terakhir khusus di section PSSP Aktif (#3) — konsepnya mirip badge "Pernah PSSP" (#31), scope-nya masih perlu dikonfirmasi. |
| 22 | Notes alasan reject dari atasan | Tombol Reject eksplisit sudah ada, wajib isi alasan, tercatat di Riwayat Aktivitas — kalau masih dianggap on-proses, kemungkinan ada scope tambahan yang diminta (mis. notifikasi ke MR, atau tempat tampil lain) yang perlu diperjelas. |
| 25 | History Visit sebelumnya (warna abu-abu, gak perlu tabel) | Placeholder "Hari Praktek/Bln" sudah selesai. Sisa: histori jumlah visit (angka, bukan cuma teks status) ditaruh sebelah field "Rencana Visit/Bulan", styling teks abu-abu aja sesuai arahan. |
| 26 | Format data survei SFE ke sistem | Rencana: taruh sebagai tab sidebar baru, pola sama kayak tab "Histori PSSP" yang udah ada. Tampilan format masih harus dipikirkan. |

## ❓ NEED CONFIRMATION (9)

| No | Item | Pertanyaan/status |
|---|---|---|
| 10 | PSSP/KPDM per outlet | *"seharusnya kpdm dan dpl itu per outlet, dan sudah teridentifikasi dari pengisian awal"* — belum ada keputusan/implementasi. |
| 11 | Pilihan PS / SP / peremajaan | Kemungkinan terkait dropdown "Jenis PSSP" yang udah dikerjain (full-stack selesai tapi di-hide sementara dari UI). Belum jelas apakah cukup dropdown simpel atau perlu level otomasi. |
| 12 | Konsep tabungan | Desain belum dipikirin. |
| 13 | Ratio target 140% dihilangin | Masih ada di kode (`DraftChecklist.tsx`: `ratioEst >= 140`). Perlu dipikirin rekomendasi % pengganti / formulanya. |
| 14 | Monitoring POA lama & sebelumnya | API yang relevan namanya **"Nexus"** (api-nexus.pharos.id) — bukan "Exodus". Sudah dieksplor, lihat catatan di #1. |
| 16 | Listing fee otomatis by outlet | `ListingFeeKontrak` data sudah diimport, tapi belum jelas apa "pembagian otomatis per outlet" ini udah kepakai di kalkulasi POA atau masih manual — perlu konfirmasi formula. |
| 27 | Sisa budget ditampilkan value tahunan | Belum dikerjain — perlu konfirmasi formula (budget historis?). |
| 36 | Struktur AP.K24 Matraman (Jakarta Timur) → harusnya kategori B | 07-20: field `Outlet.kategori` sekarang ada di schema & sudah di-populate dari `Struktur Verified Part KAM.xlsx` (lihat #1) — tapi kasus spesifik outlet ini belum di-crosscheck manual, perlu verifikasi nilainya sekarang apa. |
| 38 | Historis Kunjungan By MR by Customer (akumulasi 3 bulan terakhir) | Item baru dari stakeholder, konfirmasi ke Pak Fakhri (via Anthony Pharos). Belum ada implementasi/desain. |

---

## 🔧 Item tambahan (tracked internal, di luar 38-list stakeholder di atas)

*(Ini item yang sebelumnya cuma ditrack internal — gak ada nomor asli dari daftar stakeholder — tapi tetap relevan buat histori kerjaan.)*

### ✅ Selesai

| Item | Catatan |
|---|---|
| Sort dropdown produk (produk pernah-PSSP duluan) + qty & star breakdown di "Total Semua Produk" | Selesai. |
| Riwayat Aktivitas: audit log utk edit biasa (bukan cuma transisi status) | Selesai, di-extend lagi: nyimpen customer+produk yang diedit di snapshot, ditampilin lewat toggle "Lihat Detail" per entry. |
| Jenis PSSP dropdown per produk (PSSP/Retensi/Peremajaan/Perpanjangan) | Full-stack selesai, di-hide sementara dari UI (`{false && ...}` — logic backend tetap ada, gampang di-reenable). Kemungkinan terkait item #11 di atas. |
| Bug: teks error mentah "NEXT_REDIRECT" flash saat klik Simpan | **FIXED** — re-throw `isRedirectError()` sebelum ditangkep jadi error biasa. |
| Bug: Pengali Nilai R = 0 gak dikali 0 | **FIXED** — root cause "0 itu falsy di JS". |
| Case-insensitive login | Selesai — kemungkinan ini yang menjawab item #37. |
| Kalkulator estimasi quantity per produk | Selesai. |
| Tombol Delete draft POA di dashboard | Cuma muncul utk POA status DRAFT. |
| Tombol "+ Daftar User Baru" jadi toast "belum ready" | Gak navigasi lagi. |
| Card Estimasi Sales & Nilai PSSP side-by-side | Selesai. |
| Doctor/user combobox: label spesialisasi + nama dipanjangin | Selesai. |
| Rename "% PSSP Dokter" → "% PSSP User" | Termasuk header kolom Excel export tim. |
| PSSP Aktif ikut ke Excel export | Sheet baru "PSSP Aktif" di export per-POA dan export tim ASM/SM/NSM. |
| Verifikasi: ASM/SM/NSM hanya bisa edit, gak bisa bikin draft baru | Sudah benar dari awal, diverifikasi browser pakai 2 akun ASM real. |
| Placeholder deskriptif (Hari Praktek/Bln, Resep/Hari → Pasien Baru/Hari, Jml Produk ST/Resep) | Selesai. |
| Input Lama Periode dibuat lebih lebar | `LineItemEditor.tsx:434` — lebar 220px, sekarang lebih lebar dari field "Periode Awal" di sampingnya (200px). |

### ⬜ Belum

| Item | Catatan |
|---|---|
| Input Lama Periode dibuat nullable | ⚠️ Per cross-check kode 07-20: **belum** — kolom `lamaPeriode` di schema masih `Int` (`NOT NULL`, lihat migration `20260710020148_add_line_items_outlets`), dan UI di `LineItemEditor.tsx:435` masih pakai `<Req/>` + validasi wajib isi di submit handler (3 panel: Add/AddProduct/EditDoctor). Kalau memang mau dibuat nullable, ini perlu migration schema + hapus validasi required — bilang aja kalau mau saya kerjain. |
| Rawat inap vs rawat jalan | Label sudah diganti "Pasien Baru/Hari", logic pembeda formula rawat-inap-vs-jalan belum diimplementasi terpisah. |
| ConfirmDialog custom ganti native `confirm()` | Dipasang di tombol "✎ Edit". 2 `confirm()` lain (hapus baris produk, hapus dokter) belum diganti. |
