# MCL — UI & Access

## Titik integrasi (tidak ada halaman baru)

| Lokasi | Perubahan | Komponen / fungsi yang dipakai ulang |
|---|---|---|
| Planning POA Standarisasi, sidebar kanan (`RekomendasiSidebar`, tab "Data Survey" / "Produk Rekomendasi" / "Standarisasi & Historis Sales") | **Tidak ada tab baru.** (1) Badge "✓ Sudah Standarisasi" / "Belum Standarisasi" (`RekomendasiSidebar.tsx:202-213`) dan isi tab "Standarisasi & Historis Sales" membaca `OutletProdukListing` (+ overlay pengajuan final-submit, `01-business-rules.md` §2), bukan sales+DPL. (2) Di tab "Produk Rekomendasi" (`KriteriaOutletPanel`, `:305`) ditambah blok "Dokter Rekomendasi" per outlet: dokter → produk + `KETERANGAN`. Predikat "sudah standarisasi" yang dipakai untuk menyembunyikan produk dari daftar gap (`:296-304`) ikut diganti ke status Excel; info sales/DPL per kartu produk tetap tampil sebagai informasi | `src/components/poaStandarisasi/RekomendasiSidebar.tsx` |
| **POA Estimasi**, sidebar kanan tab "Produk Rekomendasi" (per dokter) | Section baru **"Produk Rekomendasi Dokter"** (label kerja — gaya penamaan "Produk Survey"/"Produk Kontes PM" yang sudah ada) di samping "Pernah PSSP", "Produk Kontes PM", "Produk Survey": produk Excel untuk dokter ini di outlet ini + badge status listing (outlet, produk), klik = tambah ke POA (`onSelectProduct`). Dokter tanpa tautan dicari lewat nama ternormalisasi dalam outlet. Item mengikuti bentuk `Section.items` yang sudah ada (`key/label/added/badge/badgeColor`) | `KriteriaProdukPanel` (`src/components/poa/LineItemEditor.tsx:2202`, daftar `allSections` `:2306`), tab container `:2530-2600`; pola data: `getSurveyRekomendasiByOutlet` (server action per dokter+outlet) |
| Status Baru/Perpanjangan per produk | Sinyal "Perpanjangan" = status Excel `SUDAH_LISTING` untuk (kodePI, produk) | `computeStatusPengajuanMap` (`src/app/actions/poaStandarisasi.ts`) |
| Info RS segrup | Sumber status dialihkan ke tabel yang sama | `getStandarisasiGroupOutletsAction` |
| Pilih dokter | Dokter rekomendasi yang match langsung bisa dipilih; yang "Belum terdaftar" membuka alur "Daftar User Baru" | `getCustomersByOutlet()` (`customer.ts:764`), `createCustomerAction` |

Blok "Dokter Rekomendasi" (Standarisasi) menampilkan per dokter: nama, spesialis, daftar produk (nama + `KETERANGAN`), badge `Terdaftar` / `Mungkin dokter yang sama` / `Belum terdaftar`. Urutan: dokter terdaftar dulu, lalu menurut jumlah produk direkomendasikan.

**Penamaan:** istilah "MCL" hanya dipakai di dokumen ini dan di nama tabel/script, **tidak** muncul di UI — label UI mengikuti tab/section rekomendasi yang sudah ada (keputusan pengguna 2026-10-15).

## Role / akses

Tidak ada role atau access matrix baru. Rekomendasi hidup di dalam wizard POA Standarisasi dan di sidebar editor POA Estimasi, sehingga visibilitasnya mengikuti masing-masing yang sudah ada (POA Estimasi: scope POA lewat `getVisiblePoaFilter`/`authz.ts`). Untuk Standarisasi: `POA_STANDARISASI_VIEW_ROLES` (`src/lib/role.ts`) dan scope outlet pengajuan (`canViewPoaStandarisasi`, `src/lib/authz.ts`). MR hanya melihat rekomendasi untuk outlet pengajuannya sendiri; atasan melihat lewat detail pengajuan bawahannya seperti biasa.

Import Excel dijalankan developer/ADMIN lewat script — tidak ada UI upload di v1.

## Non-goals v1

- Note atasan → bawahan per dokter, list prioritas yang diarahkan atasan, dan "geser dokter ke database lain" (memo awal) — ditunda, lihat `01-business-rules.md` §6 Q5.
- Bridging spesialis → produk + warning di POA Estimasi — sudah ada terpisah (`docs/poa-bank-spesialis/`), tidak diubah.
- Upload Excel dari UI dan jadwal refresh otomatis — file tunggal, import sekali via script.
- Saran dokter per outlet saat memilih dokter di POA Estimasi (AddPanel) — lihat Q8.
- Tab atau halaman baru khusus MCL, dan daftar company-wide/lintas outlet (PERFORMANCE.md).
- Menautkan otomatis dokter subset/fuzzy ke `Customer`.
- Mengubah Monitoring Standarisasi (`/poa-standarisasi/dashboard`) — tetap dari pengajuan final submit.
- Menulis balik atau membuat `Customer` otomatis saat import (dokter "Belum terdaftar" hanya dibuat saat MR memilihnya).
