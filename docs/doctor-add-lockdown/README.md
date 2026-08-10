# Matikan Fitur Tambah Dokter Baru — Spec Index

*(Ditulis 2026-08-10, mengikuti proses di `docs/sdd/`. Sumber requirement: daftar 13 task baru dari pengguna, item #2 — "Hilangkan Fitur Penambahan Dokter Baru (Cegah Conflict/Crash Database dengan Exodus)". Sempat dipertimbangkan requirement tambahan "pencarian dokter full-API, drop DB" di sesi yang sama — **DITOLAK setelah validasi data** (lihat Status), pencarian tetap gabungan DB+API seperti sekarang. Pengguna mengonfirmasi via `AskUserQuestion` 2026-08-10: (a) matikan tombol tambah manual total untuk semua role; (b) "Exodus" adalah nama bisnis/internal untuk sistem yang sama dengan API Nexus (`api-nexus.pharos.id`) yang sudah dipakai di kode — bukan sistem terpisah.)*

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — scope perubahan, istilah Exodus/Nexus, aturan bisnis, hasil validasi "full-API" (ditolak).
2. [`03-ui-and-access.md`](./03-ui-and-access.md) — komponen yang dimatikan, role/akses, non-goals.

Tidak ada `02-data-model.md` — tidak ada perubahan skema Prisma, murni menonaktifkan satu jalur UI+action yang sudah ada.

## Status

🟢 **v1 diimplementasikan 2026-08-10** — `AddDokterBaruPanel` dan tombol pemicunya dimatikan di `LineItemEditor.tsx`. Pencarian dokter (`getCustomersByOutlet()`) **tidak diubah** — tetap gabungan DB lokal + live-search API, sesuai keputusan final di bawah.

**Riwayat keputusan penting**: requirement "pencarian full-API, drop DB lokal" sempat diajukan pengguna di sesi yang sama, tapi **divalidasi dulu** (`scripts/checkCustomerFullApiGap.ts`, read-only) sebelum implementasi — hasilnya 15,7% customer lokal (3.338 dari 21.275) tidak match hasil API dan akan hilang dari pencarian, 34% outlet kena. Setelah melihat data ini, pengguna memutuskan **tetap pakai gabungan DB+API**, tidak jadi full-API. Detail lengkap di `01-business-rules.md` §5-§6.

## Ringkasan

Riset kode (2026-08-10) menemukan ada 2 surface "tambah dokter baru" di app ini, dan penting untuk tidak tertukar: (1) halaman `/customers/new` — sudah placeholder mati sejak awal, tidak perlu disentuh; (2) `AddDokterBaruPanel` di dalam `LineItemEditor.tsx` — ini fitur yang **benar-benar hidup dan dipakai MR** untuk mendaftarkan dokter baru langsung dari alur input POA. Task ini minta mematikan (2), dengan alasan mencegah conflict saat data POA dimasukkan ke sistem "Exodus" downstream — **dikonfirmasi**: "Exodus" = nama bisnis untuk API Nexus (`get_customer_by_outlet`, sudah live di `customer.ts:530-548`), bukan sistem terpisah, dan bukan juga `src/lib/exodusApi.ts` (itu sistem lain lagi, cuma soal riwayat kunjungan).

Keputusan final: tombol tambah manual mati total untuk semua role; pencarian dokter **tetap gabungan DB+API seperti sekarang** (tidak jadi full-API, lihat riwayat keputusan di atas); materialisasi `Customer` lokal (via `createCustomerAction`) tetap terjadi otomatis begitu MR memilih dokter dari hasil pencarian yang berasal dari API (bukan dihapus, cuma trigger manual "+ Daftarkan dokter baru"-nya yang mati).
