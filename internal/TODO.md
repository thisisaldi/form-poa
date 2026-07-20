# REVISI LAYAR POA SYSTEM — TRACKER

*(Direformat jadi tabel per 2026-07-20. Nomor asli dipertahankan biar gampang di-refer — "—" berarti item gak ada nomor asli dari daftar stakeholder. Sebut nomornya aja buat mulai kerjain satu item.)*

## ✅ DONE

| No | Item | Catatan |
|---|---|---|
| 2 | Target sifatnya fix, gak bisa naik-turun | Selesai. |
| 3 | PSSP Aktif (C urut historis, kolom "PSSP Aktif (Kontrak Berjalan)" di Detail POA) | Direstruktur 07-20 jadi per-dokter (pola sama kayak "Daftar User") + toggle Detail expand per kontrak/produk, nama disensor. Bug "tercacah" (nilai kontrak kepakai full-period, bukan diapportion ke kuartal) sudah difix. Sudah ikut ke Excel export (lihat baris terpisah di bawah). Sisa: growth pelunasan 3 bln terakhir — lihat CLARIFY. |
| 4 | Hari Praktek per-produk, default otomatis dari level dokter | Selesai. |
| 5 | Growth PSSP 3 bulan terakhir | Kartu terpisah "Growth PSSP (3 Bln Terakhir)" di LineItemEditor, bukan replacement growth berbasis kontrak lama. |
| 6 | Nama outlet dipanjangin di dropdown | Combobox bisa lebih lebar dari trigger-nya. |
| 8 | Ratio Budget/Target dihilangin dari stat bar (diganti fokus ke Estimasi) | Selesai — ada feedback minta sebagian balik, lihat entri PENDING FEEDBACK #A.2. |
| 15 | Narfoz injeksi kelipatan jadi 5 | `konversiPembagi` 1 → 5. |
| 18 | Nilai R Final per dokter di draft | Baris "Nilai R Final" (weighted avg by rencanaTotalBiaya) di Daftar User + kolom per produk di detail expand. Ambiguitas nama field "Nilai R Final" vs "Pengali Nilai R" — lihat CLARIFY. |
| 20 | Pengali Nilai R per produk, bukan totalan per dokter | Awalnya cuma fix unit `%`→`x`; 07-20 versi "default dokter" **dihapus total** — sekarang murni per-produk. |
| 21 | Notes tambahan saat "Ajukan ke Atasan" | Selesai. |
| 22 | Notes alasan reject dari atasan | Tombol Reject eksplisit, wajib isi alasan, tercatat di Riwayat Aktivitas. |
| 7 | Target Produk Fokus per area (target kuantitas, bukan cuma counter "1/22") | Card baru "Target Produk Fokus (Kuartal Ini)", pakai mesin `targetCalculation.ts` yang sebelumnya NSM/Admin-only. Posisi dipindah 07-20 ke dekat tombol Export Excel. ⚠️ +~3 detik load time, belum di-cache. ⚠️ Semua keluar 0 di data lokal (OutletSalesMonthly kosong) — perlu dicek di production. Sisa: ringkasan estimasi qty produk fokus di card ini, masih ambigu. |
| 29 | Summary produk belum diajukan tapi rekomendasi PM (kuning/oranye) | Terjawab lewat #33. |
| 30 | Sidebar "Produk Fokus PM Belum Diajukan" per spesialis | Muncul di sidebar kanan form MR begitu spesialisasi dokter ke-detect, isinya produk tier-0 yang belum ada di produkList. |
| 32 | Badge "Produk Pernah di PSSP" di product picker | "Pernah PSSP · Pelunasan 3 Bln XX%", warna hijau ≥80% / kuning 40-79% / merah <40%, discope by histori PSSP dokter+outlet 3 bulan terakhir. |
| 33 | Warna badge "Low Hanging Fruit" (Ada Sales = Oren, Tidak ada sales = Kuning) | Pakai field `OutletProductKriteria.kategori` yang ternyata sudah ada di schema tapi belum pernah di-expose ke app. |
| — | Histori PSSP panel di form MR (nama outlet, filter, running rate) | 3 dari 4 bagian selesai 07-20: nama RS/outlet tiap kontrak, filter ke outlet yang lagi dipilih, running rate pace pelunasan utk kontrak aktif. Sisa: sumber data "Pak Eko"/item NON ESTIMASI — lihat CLARIFY. |
| — | Sort dropdown produk (produk pernah-PSSP duluan) + qty & star breakdown di "Total Semua Produk" | FEEDBACK #D poin 5, 6, 7 — selesai 07-20. |
| — | Riwayat Aktivitas: audit log utk edit biasa (bukan cuma transisi status) | FEEDBACK #D poin 17 — selesai 07-20, di-extend lagi 07-20: sekarang juga nyimpen customer+produk yang diedit di snapshot, ditampilin lewat toggle "Lihat Detail" per entry (label aksi juga jadi spesifik: "menambahkan/mengedit/menghapus produk"). |
| — | Batch notes 07-20: sort outlet chain-first, border card Estimasi Sales, posisi field Pengali Nilai R, hapus Pengali Nilai R default-dokter | Selesai, 4 perubahan dalam 1 batch, diverifikasi bareng. |
| — | Jenis PSSP dropdown per produk (PSSP / Retensi / Peremajaan / Perpanjangan) | Full-stack (schema+migration+form+export) selesai, tapi di-hide sementara dari UI per permintaan 07-20 (`{false && ...}` — logic backend tetap ada, gampang di-reenable). |
| — | Bug: teks error mentah "NEXT_REDIRECT" flash saat klik Simpan | **FIXED 07-19** — re-throw `isRedirectError()` sebelum ditangkep jadi error biasa di 4 catch block LineItemEditor.tsx. |
| — | Bug: Pengali Nilai R = 0 gak dikali 0 | **FIXED 07-19** — root cause "0 itu falsy di JS", ada di 2 layer (frontend `\|\|` fallback + backend eksplisit treat 0 sama kayak isNaN). |
| — | Case-insensitive login | Selesai. |
| — | Kalkulator estimasi quantity per produk | Selesai. |
| — | ConfirmDialog custom ganti native `confirm()` | Dipasang di tombol "✎ Edit". 2 `confirm()` lain (hapus baris produk, hapus dokter) belum diganti — belum diminta. |
| — | Tombol Delete draft POA di dashboard | Cuma muncul utk POA status **DRAFT**, pakai `ConfirmDialog` (tone danger), server action `deletePoaAction`. |
| — | Tombol "+ Daftar User Baru" jadi toast "belum ready" | Gak navigasi lagi — `NotReadyButton` reusable, toast 3 detik. |
| — | Card Estimasi Sales & Nilai PSSP side-by-side | FEEDBACK #B poin 3 — selesai. |
| — | Doctor/user combobox: label spesialisasi + nama dipanjangin | FEEDBACK #B poin 1 & 2 — selesai 07-20. Name-width ternyata otomatis kejawab dari CSS global combobox yang sama dipakai outlet (#6). |
| — | Rename "% PSSP Dokter" → "% PSSP User" | FEEDBACK #D poin 3 — termasuk header kolom Excel export tim. |
| — | PSSP Aktif ikut ke Excel export | FEEDBACK #D poin 12 (dari catatan section #3) — selesai 07-20. Sheet baru "PSSP Aktif" di export per-POA (`/api/poa/[id]/export`) DAN export tim ASM/SM/NSM (`/api/export/team`, agregat lintas semua MR + atribusi balik ke MR pemiliknya). |
| — | Verifikasi: ASM/SM/NSM hanya bisa edit, gak bisa bikin draft baru | Diminta user 07-20, ternyata sudah benar dari awal (3 lapis proteksi: nav link role-gated, cek role eksplisit di `createPoaAction`, `canCreatePoa()` nolak siapapun yang punya subordinate). Diverifikasi browser pakai 2 akun ASM real. |
| — | Placeholder deskriptif (Hari Praktek/Bln, Resep/Hari → Pasien Baru/Hari, Jml Produk ST/Resep) | Bagian dari #19 & #25 — selesai 07-20. |

## 🟡 PARTIAL (sebagian jalan, ada gap)

| No | Item | Catatan |
|---|---|---|
| 1 | Struktur baru *(top urgent!!)* | Data staging (OutletStrukturBaru) sudah diimport & di-matching, TAPI belum di-promote ke Outlet/MrOutletAssignment — belum kepakai di workflow approval/assignment MR yang sebenarnya. API Nexus dicoba buat nutup gap tapi cuma nambah 0.6% outlet baru (gak ngebantu banyak). 2190 outlet (36.8%) genuinely belum ada assignment di sistem manapun — keputusan bisnis yang perlu diselesaikan manual. |
| 17 | Data diskon | `DiskonKontrak` + `avgDiskon` udah auto-fill saat bikin line item baru, TAPI field yang KEPAKAI di kalkulasi budget (`persenDiskon`) masih hardcode 10%, belum disambungkan ke data asli. **Gap paling signifikan dari semua item PARTIAL.** |
| 26 | Rawat inap vs rawat jalan | Label sudah diganti "Pasien Baru/Hari", tapi logic pembeda formula rawat-inap-vs-jalan belum diimplementasi terpisah. |
| 24 | Satuan jual per box / Estimasi Produk Fokus | "Estimasi Produk Fokus" (card + stat bar atas) sudah DONE. Sisa: detail per-produk dengan tanda warna kategori (fokus/red ocean/low hanging fruit) di tabel detail — masih tabel polos. |

## ❓ CLARIFY (perlu diperjelas dulu sebelum bisa dikerjain)

| Ref | Item | Pertanyaan/status |
|---|---|---|
| 10 | PSSP/KPDM per outlet | *"seharusnya kpdm dan dpl itu per outlet, dan sudah teridentifikasi dari pengisian awal"* — belum ada keputusan/implementasi. |
| 16 | Listing fee otomatis by outlet | `ListingFeeKontrak` data sudah diimport, tapi belum jelas apa "pembagian otomatis per outlet" ini udah kepakai di kalkulasi POA atau masih manual. |
| 13 | Ratio target 140% dihilangin | Masih ada di kode (`DraftChecklist.tsx`: `ratioEst >= 140`), belum ada rekomendasi angka pengganti. |
| 3 (poin 16) | Growth pelunasan 3 bulan terakhir di section PSSP Aktif | Belum dikerjain — konsep sama kayak badge "Pernah PSSP" (#32), tinggal scope-nya dikonfirmasi. |
| 18 | "Nilai R Final" vs "Pengali Nilai R" di baris ringkasan dokter | *"yang dimasukkin di draft itu bukan nilai R akhir, tapi pengali Nilai R"* — belum jelas ini GANTI label yang ada atau TAMBAH field baru di sebelahnya. Jangan hapus "Nilai R Final" sebelum diklarifikasi. |
| — | "Data Pak Eko" / item "NON ESTIMASI" di Histori PSSP | Gak jelas siapa/apa "Pak Eko" — belum ditindaklanjuti sampai diklarifikasi. |

## ⬜ PENDING (belum dikerjain, scope sudah jelas)

| No | Item | Catatan |
|---|---|---|
| 9 | Summary atasan perlu direview | Kemungkinan besar yang dimaksud = FEEDBACK #A (screenshot Detail POA) di bawah — cek situ dulu sebelum nanya lagi. |
| 11 | Pilihan PS / SP / peremajaan | Kemungkinan terkait dropdown "Jenis PSSP" yang udah dikerjain (lihat DONE) — belum jelas sama atau beda. |
| 12 | Konsep tabungan | Desain belum dipikirin. |
| 14 | Monitoring POA lama & sebelumnya | API yang relevan namanya "Nexus" (api-nexus.pharos.id) — sudah dieksplor 07-19, lihat catatan di #1. |
| 19 | Data dosis | Blocked, nunggu data dari PM. Placeholder terkait sudah DONE. Sisa: auto-fill produk kompetitor dari data survey, taruh field dosis/hari di bawah "Jml Produk ST". |
| 23 | Halaman approval + jumlah kunjungan MR ke user | Belum dikerjain. |
| 25 | History Visit sebelumnya | Placeholder "Hari Praktek/Bln" sudah DONE. Sisa: histori jumlah visit (angka, bukan cuma teks status) ditaruh SEBELAH field "Rencana Visit/Bulan". |
| 27 | Format data survei SFE ke sistem | Taruh sebagai tab sidebar baru, pola sama kayak tab "Histori PSSP" yang udah ada. |
| 28 | Sisa budget ditampilkan value tahunan | Belum dikerjain. |
| 31 | Keterangan Zat Aktif di product picker | Sumber data ada di sistem lain ("ABED"), belum pernah diintegrasikan — perlu dicek cara aksesnya dulu. |
| — | Input Lama Periode dibuat lebih lebar | Belum. |
| — | Input Lama Periode dibuat nullable | Belum. |
| FEEDBACK #A.1 | Pindah section PSSP Aktif ke ATAS Daftar User + stat baru "PSSP ESTIMASI AKTIF Q4" | Collapse/expand-nya udah kejawab lewat restrukturisasi #3 (DONE), tapi posisi pindah + stat baru belum dikerjain. |
| FEEDBACK #A.2 | Hapus duplikasi angka Estimasi/Target/Ratio di kartu Ringkasan (kanan) | Klarifikasi sudah RESOLVED: angka besar cuma di stat bar atas, kartu Ringkasan kanan jangan duplikasi lagi. Tinggal eksekusi — cek kartu mana di StatsPanel (`DraftChecklist.tsx`) yang masih duplikat (Estimasi POA, Target Area, Rasio Estimasi kelihatannya iya). |
| FEEDBACK #A.3 | Growth dari Sales Quarter sebelumnya, tampil kecil (bukan tabel baru) | Belum dikerjain. |
| FEEDBACK #A.4 | Pengali Nilai R + info visit/bulan di baris ringkasan dokter (sebelah Nilai R Final) | Belum dikerjain — terkait ambiguitas #18 di CLARIFY. |
| FEEDBACK #C.2 | Layout summary dashboard (Target/Estimasi/Ratio%/%Budget) disamain gaya visual kayak Detail POA | Belum dikerjain. |
