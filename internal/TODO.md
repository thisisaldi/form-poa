# REVISI LAYAR POA SYSTEM — TRACKER

*(Diupdate 2026-07-21 mengikuti "UPDATE PROGRESS REVISI SISTEM POA" dari stakeholder — sekarang 46 item (nambah #39-46). Sebut nomornya aja buat mulai kerjain satu item.)*

**Ringkasan**: ✅ DONE = 29 · 🟡 ON-PROSES = 4 · ❓ NEED CONFIRMATION = 9 · ⬜ BELUM DIKERJAKAN (item baru #39-43) = 4 *(#41 pindah ke DONE 07-21 — lihat catatan. #44/#45/#46 pindah ke DONE 07-21 — lihat catatan masing-masing. #19 tetap saya taruh DONE walau list stakeholder masih nulis ON-PROSES, karena udah diverifikasi langsung di kode. #22 dibiarkan ON-PROSES konsisten sama list stakeholder walau kodenya sebenarnya udah ada, karena ada ambiguitas scope yang belum diklarifikasi.)*

## ✅ Beres 07-21 begitu DB remote bisa diakses lagi

- ~~Jalankan `prisma migrate deploy`~~ — ternyata udah ke-apply duluan lewat deploy pipeline (termasuk `20260720163533_grant_admin_p260054`), tapi UPDATE-nya jadi no-op karena User P260054 emang belum pernah ada.
- **User P260054 dibuat baru** (nama: M NAUFALDI FADHLIRRAHMAN, role ADMIN, isActive true) — sebelumnya gak exist sama sekali di DB.
- **Hardcode sementara di `src/lib/auth.ts` (`HARDCODE_ADMIN_NIP`) sudah dihapus** — role ADMIN P260054 sekarang murni dari DB.
- **NIP Anggres Saputra diperbaiki**: L240075 → **L240076** (primary key User di-rename via transaksi, 50 baris `MrOutletAssignment` ikut pindah, plus field lain yang mungkin referensi — verified).

## ✅ DONE (25)

| No | Item | Catatan |
|---|---|---|
| 2 | Target sifatnya harus fix, gak bisa naik-turun | Selesai. |
| 3 | C urut historis drafting (periode aktif, gak boleh diedit) | Direstruktur 07-20 jadi per-dokter + toggle Detail expand per kontrak/produk, nama disensor. Bug "tercacah" (nilai kontrak kepakai full-period, bukan diapportion ke kuartal) sudah difix. Sudah ikut ke Excel export. ⚠️ Sisa kecil: growth pelunasan 3 bln terakhir di section ini masih belum dikerjain (lihat #5 catatan). |
| 4 | Hari Praktek per-produk, default otomatis dari level dokter | Selesai. |
| 5 | Growth PSSP berdasarkan value 3 bulan terakhir | Card "Growth PSSP (3 Bln Terakhir)" di LineItemEditor, nampilin growth dari data sales 3 bln terakhir (terpisah dari growth berbasis kontrak PSSP lama). Ditandai selesai oleh stakeholder 07-21. ⚠️ Sisa kecil: growth **pelunasan** 3 bln terakhir khusus di section PSSP Aktif (#3) — konsepnya mirip badge "Pernah PSSP" (#31), scope-nya masih belum dikerjain/dikonfirmasi. |
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
| 44 | Diskon: pakai DPL kalau ada, fallback ke history diskon kalau gak ada | **Selesai & data ter-import 07-21** — model baru `DiskonHistory` (kodePI+kodeProduk → rata-rata tertimbang "% Total Diskon"), diisi dari `internal/08062026 Data Diskon All Product Jan-Apr'26.xlsx` (sheet "Raw Data", 490.611 baris, file 196MB — dibaca pakai ExcelJS streaming reader biar gak OOM) via script baru `scripts/importDiskonHistory.ts` → **201.963 pasangan outlet+produk** ter-agregasi (periode sumber 202601-202604). "Item Kode" di file ini dikonfirmasi match langsung ke `Product.kodeProduk` (dicek manual: "000070"→NEBACETIN, "013390"→ACETRAM, sesuai). `resolveDiskonPctWithHistory()` di `LineItemEditor.tsx` coba DPL (`DiskonKontrak`) dulu, baru fallback ke history kalau DPL gak ada — DPL tetap prioritas, history cuma fallback sesuai arahan. |
| 45 | Kalau ASM/SM vacant, approval langsung ke NSM (skip level) | **Selesai 07-21** — `resolveNextHolder()` (`poaWorkflow.ts`) diubah dari fixed-hop (`.reportsTo.reportsTo.reportsTo`) jadi jalan-jalan menyusuri chain berdasarkan **role**, jadi otomatis skip level yang vacant. Data-nya juga dibenerin: `importStrukturVerifiedKAM.ts` sekarang skip-link `nipAtasan` pas import (sebelumnya dibiarkan `null` kalau ASM/SM vacant, sekarang lompat ke level di atasnya) — hierarki lama di-backfill ulang. |
| 46 | ASM bisa input POA untuk tim yang vacant | **Selesai 07-21** — tapi scope-nya diperbaiki dari implementasi pertama: bukan "subordinate ASM/SM/NSM kosong semua", tapi **per outlet** — kalau outlet tertentu MR & ASM-nya vacant, SM yang bisa input POA khusus utk outlet itu (kalau SM juga vacant, baru NSM), gak peduli tim lain di bawah SM itu penuh atau nggak. Field baru `Outlet.coveredByNip`/`coveredByRole` (dihitung pas import, siapa yang efektif cover outlet itu). `canCreatePoa()` (`authz.ts`), `getOutletsByUser()` (`masterData.ts`, scope outlet picker ke outlet yg di-cover doang), `canView`/`canEdit`/`getVisiblePoaFilter` (generalisasi "pemilik POA selalu bisa akses", gak lagi hardcode role MR), tombol submit di dashboard & Detail POA (gak lagi hardcode `isMR`) — semua disesuaikan. |

## 🟡 ON-PROSES (4)

| No | Item | Catatan |
|---|---|---|
| 1 | Struktur baru *(top urgent!!)* | **Progress besar 07-20/07-21**: import `internal/Struktur Verified Part KAM.xlsx` (sheet "ALL", 7334 outlet, NIP langsung per level GM/NSM/SM/ASM/SPV/MR) via `scripts/importStrukturVerifiedKAM.ts` — sekarang **365 User** di-upsert + **350 hierarki** (nipAtasan) ke-wire, **3799 outlet dapat assignment MR baru/ter-override**, plus `Outlet.coveredByNip`/`coveredByRole` per outlet (3799 MR normal · 808 vacant→ASM · 383 vacant→SM · 2344 vacant→NSM · **0 gak ada siapa-siapa**). **07-21 fix "SPV is MR"**: kolom SPV & MR di file itu ternyata dua nama utk level yang sama (cuma salah satu keisi per baris) — `resolveCoverage()` dan `MrOutletAssignment` sebelumnya cuma cek kolom MR doang, jadi ~1824 outlet yang cuma keisi kolom SPV (MR-nya kosong) kesalah-anggap "MR vacant" dan ke-escalate ke ASM/SM/NSM. Dibenerin pakai `effectiveMrNip(r) = r.mrNip ?? r.spvNip` di kedua tempat itu — coverage "MR" naik dari 1975→3799, dan 197 outlet yang tadinya genuinely gak ke-resolve sekarang semua ke-cover. Dua bug data kolom "NIP NSM" ditemukan & dibenerin via hardcode override di script: **"EKA"** (07-20, isinya rangkaian kode acak per baris — NIP asli `P260205`) dan **"DODY ALWARDY"** (07-21, kosong di semua 580 barisnya — NIP asli `P250442`, tanpa ini 197 outlet di bawahnya gak punya fallback sama sekali). Sisa: 2685 outlet msh gak ada MR yang resolve (assignment lama dipakai) + 850 outlet NIP MR terisi tapi nama placeholder (sisa data lama) — ini genuinely keputusan bisnis manual, bukan masalah data lagi. Kasus spesifik "AP.K24 Matraman Jakarta Timur → harusnya kategori B" masih perlu di-crosscheck manual — field `Outlet.kategori` udah ada & populated (lihat juga #36). ⚠️ Stakeholder nambahin ✅ di sebelah item ini tapi labelnya masih "(ON-PROSES)" — saya tetap taruh di sini karena progress-nya emang belum 100%, tapi kalau maksudnya udah dianggap cukup, tinggal bilang aja. |
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
| 38 | Historis Kunjungan By MR by Customer (akumulasi 3 bulan terakhir) | Item baru dari stakeholder, konfirmasi ke Pak Fakhri (via Anthony SFE Pharos). Belum ada implementasi/desain. |

## ⬜ BELUM DIKERJAKAN — item baru 07-21 (#39-43)

*(Gak ada tag status dari stakeholder di 5 item ini, jadi ditaruh di sini apa adanya. Beberapa udah saya cross-check cepat ke kode, ada catatan; sisanya belum sempat digali.)*

| No | Item | Catatan |
|---|---|---|
| 39 | Check COUNT OF PRODUCT di master Produk, check HNA (harus ikutin kenaikan harga per Juli) | Audit data — belum dicek. Perlu tau sumber "harga baru per Juli"-nya dari mana buat dibandingin ke `Product.hna` yang ada sekarang. |
| 40 | Check Struktur Hospinet / KAM | Import `Struktur Verified Part KAM.xlsx` (lihat #1) cuma cover divisi **KAM** — Hospinet masih belum ke-cover di struktur org (org hierarchy/outlet coverage tetap gak ada data Hospinet). **07-21 progress parsial**: `internal/customer_pssp_hospinet.xlsx` di-import via `scripts/importPsspHospinet.ts` — ini ngasih customer roster + snapshot PSSP level-customer utk Hospinet (lihat #42), tapi BUKAN struktur org/outlet-ownership Hospinet, jadi #40 masih belum full selesai. |
| 41 | Fitur Log-out di Mobile | ✅ **Selesai 07-21** — koreksi catatan sebelumnya: tombol "Sign out" ternyata SUDAH ADA di `Sidebar.tsx` (footer sidebar, form POST ke `/api/auth/logout`), bukan "belum ada sama sekali". Bug asli: di mobile, drawer sidebar-nya pakai `h-screen` (`100vh`) sekaligus `position: fixed` + `inset-y-0` — kalau `top`/`bottom`/`height` ketiganya keisi di elemen fixed, `height` menang atas `bottom` (CSS2.1 §10.6.4), jadi begitu address bar browser mobile muncul (visible viewport < 100vh), bagian bawah drawer (termasuk tombol Sign out) ke-dorong ke bawah layar yang gak keliatan/gak bisa diklik. Fix: `h-screen` → `h-dvh` (dynamic viewport height, ngikutin viewport asli yang keliatan). |
| 42 | Check Database Customer terbaru | **07-21 progress**: import `internal/customer_pssp_hospinet.xlsx` (2376 baris) via `scripts/importPsspHospinet.ts` — data ini flat (nama+spesialisasi+outlet+status+value PSSP/pelunasan/RR agregat, TANPA nomor kontrak/produk/breakdown bulanan), jadi sengaja dibikin model baru `PsspHospinetSnapshot` (mirip `DiskonHistory` vs `DiskonKontrak`, gak dipaksa masuk `PsspKontrak`). Hasil: **1887 Customer baru** + **1919 CustomerOutlet** + **1919 PsspHospinetSnapshot** (32 nama match ke Customer existing, 357 baris skip krn spesialisasi kosong, 64 skip krn outlet gak ada di tabel `Outlet`). Ditampilin di sidebar "Histori PSSP" sbg fallback card pas gak ada histori `PsspKontrak`. ⚠️ Vocab spesialisasi Hospinet ("Dokter Umum" dst) beda dari 16 kategori kurasi PM (`SPESIALISASI_PM_LABEL`) — cuma ~14% (295 baris: Anak/Kandungan/Penyakit Dalam/Saraf/Paru/Psikiatri/Ortopedi/Bedah Umum/Anestesi) yang ternormalisasi ke kategori kurasi, sisanya (termasuk "Dokter Umum" 79%) tetap raw value krn gak ada bucket GP di list kurasi — customer2 ini gak muncul di dropdown spesialisasi form Tambah POA. Audit Customer database yang lebih luas (bukan cuma Hospinet) masih belum dikerjain. |
| 43 | Optimalisasi Versi Mobile | Belum dikerjain — scope-nya luas (responsive layout dll), belum di-breakdown jadi task konkret. |

---

## 🔧 Item tambahan (tracked internal, di luar 46-list stakeholder di atas)

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
