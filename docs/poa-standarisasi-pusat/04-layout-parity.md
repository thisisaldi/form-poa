# POA Standarisasi Pusat — Kesamaan Layout dengan Hospital (cabang)

**Sumber requirement:** permintaan atasan via pengguna, 2026-10-09: "HKA layoutnya dibuat sama seperti hospital untuk standarisasi (konfirmasi dari Pak Brian)". Keputusan pengguna 2026-10-09: samakan **semua** bagian di bawah.

**Status:** 🟢 Fase A–D diimplementasikan 2026-10-09 (migrasi `20261009100000_pusat_layout_parity`, belum dijalankan di DB bersama; diuji end-to-end di DB lokal: buat pengajuan, tampilan detail, export Excel, panel samping). Bagian ini **membalik** keputusan v1 `01-business-rules.md` §6 ("tanpa KPDM/estimasi per dokter"). Keputusan pengguna 2026-10-09: **Jumlah Bed RS dihilangkan** di pusat; **Langkah 5 (SP Non Sales & DPL/DPF) di-skip dulu**; asumsi Q6/Q7 disetujui. Susulan 2026-10-09: **Finalisasi pusat** juga disamakan (tabel "Dokter yang Akan Menjadi User" dengan estimasi per dokter, tambah/hapus dokter dari outlet mana pun di grup, biaya final, entertain KPDM final, Simpan + Submit; model `PoaStandarisasiPusatDokterUser`, migrasi `20261009110000`). Belum ada: badge Golongan per dokter, panel samping versi gabungan (saat ini pemilih outlet), edit Planning setelah dibuat.

## 1. Perbandingan layar (screenshot 2026-10-09, `/poa-standarisasi/[id]` vs `/poa-standarisasi/pusat/[id]`)
| Bagian | Hospital (cabang) | Pusat (HKA) sekarang | Gap |
|---|---|---|---|
| Header | Judul + "Export Excel" | Judul saja | Tambah Export Excel |
| Stepper | 5 langkah (… + "SP Non Sales & DPL / DPF") | 4 langkah | Tambah langkah 5 |
| Planning | Nama Outlet, KPDM, Tipe, Jumlah Bed, Target Finalisasi (bulan/tahun) | Grup RS, Tipe, Periode (read-only) | Tambah Target Finalisasi; KPDM & Jumlah Bed perlu keputusan (Q1, Q2) |
| Baris produk | Status Pengajuan, Skema, Diskon PI/Dist, Estimasi Biaya Listing | Skema, Diskon PI/Dist | Tambah Status Pengajuan, Estimasi Biaya Listing |
| Dokter User per produk | Tabel: hari praktek/bulan, pasien/hari, resep/pasien, est qty/bln, est sales/bln, entertain, total | Checklist TTD saja | Tabel estimasi per dokter |
| Ringkasan | "Total Semua Produk" (jumlah produk, est sales/bln, biaya listing, entertain, % budget) + tabel per produk | Tidak ada | Tambah |
| Panel samping | Tab Data Survey / Produk Rekomendasi / Standarisasi & Historis Sales | Tidak ada | Tambah (Q3) |

## 2. Fase usulan
| Fase | Isi | Migrasi |
|---|---|---|
| A | Header Export Excel, stepper 5 langkah, Target Finalisasi | tidak/ringan |
| B | Planning penuh: Status Pengajuan, Estimasi Biaya Listing, ringkasan "Total Semua Produk" | ya (kolom di `PoaStandarisasiPusatProduk`) |
| C | Tabel Dokter User + estimasi per produk (hari praktek, pasien, resep, est sales, entertain) | ya (kolom di `PoaStandarisasiPusatDokter`) |
| D | Panel samping Data Survey / Rekomendasi / Historis Sales | tidak (read-only dari data outlet) |

Pemakaian ulang: `PoaStandarisasiWizard.tsx` (2.800 baris) mengasumsikan `kodePI` non-null per pengajuan; `02-data-model.md` §3 sengaja memisah model. Rencana: **ekstrak potongan presentasi bersama** (baris produk, tabel dokter, ringkasan total) dari wizard, bukan menjalankan wizard utuh dalam mode pusat — risiko regresi flow cabang yang sudah di produksi lebih kecil.

## 3. Keputusan (pengguna, 2026-10-09) dan open questions
| # | Pertanyaan | Status |
|---|---|---|
| Q1 | KPDM di pusat? | ✅ **Tetap ada** (membalik v1 §6). Dipilih dari customer outlet mana pun di grup. |
| Q2 | Jumlah Bed RS di pusat? | ✅ **Dihilangkan dulu** (keputusan pengguna 2026-10-09, membalik jawaban awal). |
| Q3 | Panel samping untuk grup? | ✅ Semua outlet dalam grup tersedia. Implementasi v1: pemilih outlet di atas form, panel kanan = `RekomendasiSidebar` cabang untuk outlet terpilih (belum gabungan lintas outlet). |
| Q4 | Langkah 5 "SP Non Sales & DPL/DPF" | ✅ **Di-skip dulu** (keputusan pengguna 2026-10-09). |
| Q5 | Rumus estimasi per dokter dan Total Budget % | ✅ **Sama** dengan cabang; modul rumus cabang dipakai ulang. |

## 4. Kendala teknis yang ditemukan (2026-10-09)
- `PlanningPhase` (cabang) mengikat banyak hal ke satu `kodePI`: Status Pengajuan (riwayat sales 12 bulan outlet), DPL mau habis, estimasi diskon live, baseline margin, dan sidebar rekomendasi. Untuk grup, tiap hal itu perlu aturan agregasi lintas outlet (Q6).
- Pusat sekarang langsung masuk `APPROVAL_ATASAN` saat dibuat (tanpa fase PLANNING). Form Planning penuh berarti fase PLANNING dihidupkan kembali di pusat.
- Butuh migrasi: `PoaStandarisasiPusat` (jumlahBedRs, estimasiTimelineSelesai), `PoaStandarisasiPusatProduk` (statusPengajuan, estimasiBiayaListingRp), `PoaStandarisasiPusatDokter` (jumlahPasien, jumlahHariPraktekPerBulan, resepPerPasienSt, estimasi qty/nilai, entertainRp), tabel baru `PoaStandarisasiPusatKpdm`.

| # | Pertanyaan baru | Asumsi |
|---|---|---|
| Q6 | Status Pengajuan (Baru/Perpanjangan) per produk untuk grup | Perpanjangan jika produk punya sales 12 bulan di salah satu outlet grup; selain itu Baru. |
| Q7 | Estimasi diskon live dan baseline margin untuk grup | Pakai outlet anggota grup dengan sales produk terbesar. |
