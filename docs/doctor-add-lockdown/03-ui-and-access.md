# Matikan Fitur Tambah Dokter Baru — UI & Access

## 1. Lokasi

`src/components/poa/LineItemEditor.tsx`:
- `AddPanel` (`:2266+`), tombol pemicu `onAddNewCustomer` (`:2837-2841`) — **dihapus/disembunyikan**.
- `AddDokterBaruPanel` (`:3207+`), dan pemanggilnya `mode === "addBaru"` (`:4481-4483`) — **dihapus/disembunyikan sepenuhnya**, termasuk state `mode` yang mengarah ke `"addBaru"` (`setMode("addBaru")` di `:4478`).

`src/app/actions/customer.ts`:
- `getCustomersByOutlet()` (`:573-590`) — **TIDAK diubah**, tetap gabungan query `CustomerOutlet` lokal + `fetchNexusCustomersByOutlet` (lihat `01-business-rules.md` §5 untuk riwayat keputusan ini).
- `createCustomerAction()` (`:18-60+`) — **TIDAK dihapus**, tetap dipakai untuk materialisasi `Customer` lokal saat MR memilih dokter hasil `nexus:<kode>` synthetic id — cuma trigger MANUAL-nya (dari `AddDokterBaruPanel`) yang mati, bukan fungsinya secara keseluruhan.

## 2. Cara mematikan — rekomendasi implementasi

Reuse pola yang sudah ada di app ini untuk "fitur belum siap": `NotReadyButton` (dipakai di `dashboard/page.tsx:325` untuk kasus serupa — tombol "+ Daftar User Baru"). Dua opsi:

- **Opsi A (direkomendasikan)** — hapus total prop `onAddNewCustomer` dari `AddPanel` dan komponen `AddDokterBaruPanel` beserta cabang render `mode === "addBaru"`. Lebih bersih (tidak ada dead code tersisa), tapi butuh migration path kalau nanti fitur ini diaktifkan lagi (lihat `01-business-rules.md` OQ-2).
- **Opsi B** — pertahankan komponen tapi ganti tombol pemicunya dengan `NotReadyButton`/toast "belum tersedia", sama pola dashboard yang sudah ada. Lebih cepat di-reverse kalau kebijakan berubah, tapi meninggalkan dead code (`AddDokterBaruPanel`) yang berisiko bit-rot.

Karena keputusan pengguna adalah "matikan total" (bukan "belum siap sementara"), **Opsi A lebih sesuai semangat requirement** — tapi ini keputusan implementasi teknis, bukan business rule, jadi didokumentasikan sebagai rekomendasi bukan requirement wajib.

## 3. Role & akses

Berlaku untuk **semua role** yang sebelumnya bisa mengakses `LineItemEditor` (MR sebagai pemilik POA, dan ASM/SM/NSM saat mengedit POA yang belum di-lock — lihat `docs/form-poa/03-ui-and-access.md` untuk role matrix editing yang sudah ada, tidak diubah spec ini). Tidak ada RBAC baru — ini penghapusan fitur, bukan gating baru per role (dikonfirmasi pengguna: bukan "dibatasi role tertentu").

## 4. Non-goals v1

- **Tidak menyentuh `/customers/new`** — sudah mati sejak awal, di luar scope (lihat `01-business-rules.md` §1).
- **Tidak membangun alur pengganti** (mis. "request dokter baru ke admin", form approval terpisah) — MR yang butuh dokter benar-benar baru harus lewat proses manual di luar aplikasi untuk sementara (lihat `01-business-rules.md` §6).
- **Tidak menghapus data `Customer` yang sudah pernah dibuat lewat fitur ini sebelumnya** — dokter-dokter yang sudah terlanjur didaftarkan manual sebelum spec ini tetap valid dan tidak disentuh/dihapus dari DB.
- **Tidak mengubah `getCustomersByOutlet()`/pencarian dokter** — keputusan final: tetap gabungan DB+API, lihat `01-business-rules.md` §5-§6 untuk riwayat validasi yang mendasari keputusan ini.
