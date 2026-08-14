# POA Standarisasi — Sub-form Outlet × Produk

File ini dibuat untuk di-drop ke repo `form-poa` (thisisaldi/form-poa),
mengikuti konvensi yang sudah ada di sana (Next.js App Router, Server
Actions, Prisma, komponen `ui/` yang sudah ada).

## Kenapa terpisah dari `PoaForm`/`PoaLineItem`

POA reguler di-scope ke **Dokter × Produk** (satu `PoaLineItem` = satu baris
dokter+produk). POA Standarisasi di-scope ke **Outlet × Produk** — satu
pengajuan mewakili satu outlet, isinya banyak produk. Approval dokter tetap
ada di dalamnya (sebagai syarat kelengkapan per produk), tapi bukan unit
baris utama seperti di POA reguler. Karena unit kerjanya beda, dibuat model
baru (`PoaStandarisasi*`) alih-alih memaksa masuk ke `PoaLineItem`.

**Estimasi POA sengaja disamakan polanya** dengan `PoaLineItem.periodeAwal`
+ `.lamaPeriode` yang sudah ada (bulan mulai + durasi 1/3/6/12 bulan,
nilainya dianggap merata per bulan) — bukan konsep kuartal buatan sendiri.
Ini supaya konsisten secara bisnis dengan cara POA reguler menghitung
periode, dan supaya helper `formatPeriodeRange()`/`expandPeriodeMonths()`/
`computeMonthlyBreakdown()` di `lib/poaUtils.ts` bisa langsung dipakai ulang
tanpa duplikasi logic.

## Isi paket ini

```
prisma/schema-additions.prisma      → tempel ke prisma/schema.prisma, lalu
                                       npx prisma migrate dev --name add_poa_standarisasi
src/app/actions/poaStandarisasi.ts  → server actions, pola sama seperti
                                       actions/customerPengajuan.ts
src/lib/productLabels.ts            → hargaST()/satuanLabel(), disalin dari
                                       LineItemEditor.tsx (belum di-export di sana)
src/app/(app)/poa-standarisasi/new/page.tsx
                                     → halaman wizard 4 phase, pakai
                                       Button/Input/Card/Combobox yang
                                       sudah ada di src/components/ui/,
                                       plus CreatableCombobox lokal untuk
                                       KPDM & Jabatan
```

## Yang PERLU disesuaikan sebelum jalan (lihat komentar TODO di akhir page.tsx)

1. **Server component wrapper** — halaman ini murni client (`"use client"`)
   dan menerima `outletOptions`/`productOptions` sebagai props supaya mudah
   direview. Di produksi, bungkus dengan server component yang manggil
   `getOutletsByUser(user.nip)` (pola sama seperti `/poa/new`) dan query
   `Product`, lalu pass sebagai props ke komponen client ini.

2. **`getSurveyGolonganAction`** — saat ini query `SurveyRekomendasi` by
   `(kodePI, kodeProduk)` saja (ambil yang paling baru `syncedAt`). Perlu
   dicek ke tim data: `SurveyRekomendasi` aslinya keyed per **dokter**
   (`kodePI + kodeCustomer + kodeProduk`), jadi query ini meng-agregasi
   lintas dokter di outlet itu. Kalau butuh granularitas beda, ini titik
   yang perlu diubah.

3. **File upload** (`formKftFilePath`, dokumen NIE/CPOB/KFA) — di kode ini
   masih di-stub dengan path palsu (`toggleUpload` cuma set string). Perlu
   disambungkan ke mekanisme upload yang app ini sudah pakai (cek
   `SurveyUpload`/`driveFileId` di schema — sepertinya ada integrasi Google
   Drive lewat service account, ikuti pola yang sama).

4. **`/poa-standarisasi/[id]/page.tsx`** — belum dibuat. Ini halaman detail
   tempat Phase 3 (Approval KFT) & Phase 4 (Finalisasi) benar-benar diisi
   oleh role terkait (KFT/procurement/approver), meniru pola approve di
   `/poa/[id]/page.tsx`.

5. **`authz.ts`** — flow ini kemungkinan butuh role gate sendiri
   (`canCreatePoaStandarisasi`, `canApproveKft`) karena approver KFT
   sepertinya bukan bagian dari chain MR→ASM→SM→NSM yang sudah ada.

6. **Model tambahan yang dirujuk tapi belum tentu ada**: `Distributor`
   sudah disertakan sebagai model baru di schema-additions — cek dulu
   apakah sudah ada tabel serupa di schema utama sebelum menambah yang baru
   (mengurangi duplikasi).

## Field mapping ke keputusan bisnis sebelumnya

| Keputusan | Implementasi di sini |
|---|---|
| 4 phase (bukan 6 tahap) | `PoaStandarisasiPhase` enum, `currentPhase` di header |
| Sub-status Phase 3 & 4 | `SubStatusApprovalKft`, `SubStatusFinalisasi` |
| KPDM Standarisasi & Jabatan: combobox creatable tunggal, opsi "+ Tambah baru" otomatis | `CreatableCombobox` lokal di `page.tsx` (TIDAK mengubah shared `ui/Combobox.tsx`); `findOrCreateKpdm()`/`findOrCreateJabatan()` |
| Jabatan disimpan di master `KpdmStandarisasi`, bukan cuma snapshot pengajuan | `KpdmStandarisasi.jabatanId`, auto-fill via `getJabatanForKpdmAction()` |
| Golongan dari data survey, per Outlet+Produk | `PoaStandarisasiProduk.surveyRekomendasiId` → `SurveyRekomendasi` |
| Estimasi = potensi TOTAL (Rp & Qty terpisah), bukan pecahan bulanan | `PoaStandarisasiProduk.estimasiNilaiRp` + `.estimasiQty` — flat |
| Biaya listing / discount / entertain per produk | Kolom langsung di `PoaStandarisasiProduk` |
| **Tipe Standarisasi 3 opsi** (Periodic/Sisipan/Permanen); Periodic & Sisipan wajib isi Periode (bulan, angka bebas); Permanen tidak | `TipeStandarisasi` enum + `PoaStandarisasi.periodeBulan Int?`, validasi kondisional di server action |
| **HNA SJ & HNA ST wajib tampil sama seperti LineItemEditor.tsx** saat produk dipilih | `lib/productLabels.ts` (salinan `hargaST()`/`satuanLabel()`, belum di-export dari file asli — lihat TODO) |
| **Dokter dipilih dari dropdown DB di Phase 1** (bukan diketik manual), per produk; Phase 2 tinggal centang approval — tidak input nama lagi | `getCustomersByOutlet()` yang **sudah ada** di `app/actions/customer.ts`; `PoaStandarisasiDokterApproval.customerId` |
| **Dokumen NIE/CPOB/KFA pindah ke Phase 2** (inline, ikut tab produk aktif), bukan sidebar lagi | Dirender langsung di komponen `Phase2`, tidak ada sidebar dokumen lagi |
| Produk baru default mewarisi dokter dari produk sebelumnya | `emptyProduk(inheritDokter)`, dipanggil dari `addProduk()` |
| **Tombol "+ Tambah produk" di bawah tiap kartu produk** (bukan satu di atas), selalu menambah di akhir list | Dirender setelah tiap `produkcard` di `Phase1` |
| **Sidebar Ringkasan (checklist + total) HANYA di Phase 1** — menggantikan sidebar dokumen yang sudah dipindah | Komponen `Summary`, hanya dirender saat `step === 1` |
| **Ringkasan di-detail-kan BY PRODUK**, nama & gaya disamakan "Ringkasan POA" (StatsPanel) di POA reguler | `Summary` component: breakdown per produk (qty & nilai masing-masing) diikuti checklist, bukan cuma 1 blok total |
| **Estimasi Nilai (Rp) TIDAK diketik manual** — dihitung dari Jumlah Pasien × Kebutuhan per Pasien × HNA ST, mirror `computeEstimasi()`/`computeQtyTotal()` di `LineItemEditor.tsx` | Field baru `jumlahPasien` + `kebutuhanPerPasienSt` (input mentah); `estimasiQty`/`estimasiNilaiRp` **dihitung ulang di server** (`fetchProductMap()` + `computeEstimasiFromPasien()`), tidak dipercaya dari client — lihat catatan asumsi di bawah |

> ⚠️ **Asumsi yang perlu dikonfirmasi**: rumus yang dipakai adalah `Estimasi Nilai = Jumlah Pasien × Resep per Pasien (ST) × HNA ST`. Formula asli `computeEstimasi()` di POA reguler juga mengalikan dengan `hariKerjaBulan` dan `lamaPeriode` (karena itu per-dokter, per-hari). Di sini saya **tidak** ikut mengalikan dengan `periodeBulan` (Phase 1) karena konteksnya "potensi TOTAL kalau listing berhasil", bukan estimasi bulanan — tapi kalau ternyata harusnya dikalikan durasi periode juga, tinggal kasih tau, tinggal saya tambahkan `× periodeBulan` di `computeEstimasiFromPasien()`.

(Catatan: baris-baris keputusan lanjutan di bawah tabel di atas — revisi sidebar, ringkasan, finalisasi, phase "Approval Atasan", dst. — ada di file sumber asli yang dilampirkan pengguna pada 2026-08-13; ringkasannya sudah dituangkan ke `../01-business-rules.md`.)
