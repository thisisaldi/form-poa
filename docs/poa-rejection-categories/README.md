# Kategori Rejection POA — Spec Index

*(Ditulis 2026-08-10, mengikuti proses di `docs/sdd/`. Sumber requirement: daftar 13 task baru dari pengguna, item #1 — "Penambahan Label/Kategori Komponen Rejection POA (Produk, Outlet, User, Periode, Kalkulasi PSSP, Alasan Lain)". Disampaikan sebagai judul task singkat, belum ada detail lanjutan — spec ini menstrukturkan requirement itu dan menandai setiap titik ambigu di §"Open questions", bukan menebak.)*

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — cakupan form yang kena kategori, daftar kategori, aturan wajib/opsional, dan open questions.
2. [`02-data-model.md`](./02-data-model.md) — perubahan skema `PoaAuditLog` yang diusulkan (kolom kategori baru vs key JSON baru), invariant.
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — form mana yang berubah, tampilan pilihan kategori, tampilan di Riwayat Aktivitas, role/akses, non-goals.

## Status

⬜ **Belum dimulai — draft spec, menunggu konfirmasi pengguna.** Belum ada kode yang ditulis.

## Ringkasan

Saat ini alasan reject POA (dan 2 alur serupa — tolak permintaan edit, batalkan approval) berupa **free-text 100%**, tidak ada kategori. Task ini minta ditambahkan kategori/label sebelum atau bersama alasan bebas: **Produk, Outlet, User, Periode, Kalkulasi PSSP, Alasan Lain**. Riset kode (2026-08-10) menemukan bahwa alasan reject saat ini disimpan sebagai string bebas di kolom JSON `PoaAuditLog.snapshot` (bukan kolom typed) lewat 3 form berbeda (`src/app/(app)/poa/[id]/page.tsx`) yang semuanya bermuara ke fungsi generik `applyTransition()` (`src/lib/poaWorkflow.ts:118-160`) — fungsi ini **sudah punya** parameter `snapshotExtra` yang belum dipakai oleh `rejectPoa()`, sehingga menambah field kategori tidak butuh mengubah signature fungsi inti, hanya memanfaatkan yang sudah ada. Spec ini punya beberapa open question BLOCKING (scope ke-3 form, single vs multi-select, wajib teks tambahan untuk "Alasan Lain") yang perlu dijawab pengguna sebelum implementasi mulai — lihat `01-business-rules.md` §"Open questions".

Cross-reference: `docs/TODO.md` #22 ("Notes alasan reject dari atasan") sudah menandai ada kemungkinan scope tambahan yang diminta stakeholder — task ini kemungkinan besar adalah scope tambahan tersebut. Setelah spec ini disetujui dan diimplementasikan, tautkan balik ke situ.
