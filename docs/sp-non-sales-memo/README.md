# SP Non Sales Memo — Spec Index

*(Ditulis 2026-09-23, mengikuti pendekatan spec-driven development — lihat `docs/sdd/01-when-and-workflow.md`. Sumber requirement: diskusi chat langsung dengan user 2026-09-23, bukan memo tertulis. Trigger SDD wajib di sini: role/access matrix baru (Sales Support) yang belum ada polanya di `src/lib/authz.ts`.)*

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — flow memo, definisi role Sales Support, dan open questions (termasuk yang masih murni "nanti diskusi dulu").
2. [`02-data-model.md`](./02-data-model.md) — perubahan Role enum, field baru di `PoaStandarisasi`/produk, dependency generation dokumen.
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — halaman Sales Support, role/access matrix, non-goals v1.

## Status

🟢 **v1 diimplementasikan 2026-09-23**:
- Role `SALES_SUPPORT` (`prisma/schema.prisma`, migration `20260923140000_add_sales_support_role`) + akun pertama `P240003` (Christiana Meyta).
- Field memo di `PoaStandarisasi` + model `SpNonSalesMemoCounter` + config signer di `GoogleDriveConfig` (migration `20260923150000_add_sp_non_sales_memo`).
- Generator docx (`src/lib/spNonSalesMemo.ts`, pakai library `docx` — bukan docxtemplater, lihat `02-data-model.md` catatan desain) — layout dari foto fisik §4.
- Server actions: `generateSpNonSalesMemoAction`, `updateSpNonSalesMemoNoSpAction`, `toggleSpNonSalesMemoSignedAction`, `listSalesSupportMemosAction` (`src/app/actions/poaStandarisasi.ts`).
- Authz: `canAccessSalesSupportMemo` (`src/lib/authz.ts`) — dipakai gate halaman `/sales-support` DAN download proxy file memo (`authorizeAndLogPoaStandarisasiFileAccess` di-extend, bukan `canViewPoaStandarisasi` — sesuai desain scope-dibatasi-ke-memo).
- UI: tab "Permintaan SP Non Sales" (`PoaStandarisasiWizard.tsx`) — **SATU tombol** "Ajukan Permintaan SP Non Sales" (2026-09-23 koreksi: awalnya ada 2 tombol terpisah "Generate Memo" + "Ajukan", user minta digabung — sekarang satu klik: simpan jumlah → generate memo kalau belum ada → kunci tab). Field "Kepada" TETAP ada di form (bukan dihapus jadi fixed murni seperti asumsi awal 2026-09-23 pertama — dikoreksi lagi: prefilled dari config `GoogleDriveConfig.spNonSalesMemoKepada` via `getSpNonSalesMemoKepadaDefaultAction`, tapi tetap editable per pengajuan "jaga-jaga kalau berubah orangnya"). Halaman baru `/sales-support` (`src/app/(app)/sales-support/page.tsx` + `SalesSupportMemoTable.tsx`) — listing company-wide, nampilin memo DAN dokumen bukti standarisasi (2026-09-23 clarification: dua dokumen beda yang SAMA-SAMA diteruskan ke GOJ/gudang, bukan redundant — lihat `01-business-rules.md` §1), No SP Memo editable, checkbox sign toggle-able. Admin panel `GoogleDriveConfigPanel.tsx` punya 3 field baru: Kepada (default) + 2 nama signer fixed (sudah diisi: Ibu Tuti Ambarwati / Christiana Meyta / M.Nugraha, dari foto memo asli).
- `ROLE_OPTIONS` di `AdminTabs.tsx` ditambah `SALES_SUPPORT` biar admin bisa bikin akun baru lewat UI, bukan cuma NIP pertama ini yang manual di-script.
- Akses file diperluas: bukan cuma memo, tapi juga dokumen bukti standarisasi (`PoaStandarisasiSpNonSalesDocument`) — ternyata sebelumnya TIDAK ke-cover sama sekali di `resolvePoaStandarisasiFileOwner` (pre-existing gap, ketemu pas nambahin akses Sales Support, sekarang sudah ditambal untuk SEMUA role, bukan cuma Sales Support).

⬜ **Belum diverifikasi end-to-end di browser** — sudah ada beberapa iterasi koreksi requirement (Kepada, gabung tombol, bukti standarisasi) sejak implementasi awal, belum sempat dites ulang penuh dari nol di browser.

Sisa item non-blocking dari §7 (#5-9 di `01-business-rules.md` — scope Sales Support, cara akun dibuat) tetap jalan dengan asumsi tertulis, belum dikonfirmasi ulang ke stakeholder.

## Ringkasan cepat

Perluasan dari Step 5 POA Standarisasi ("Permintaan SP Non Sales", `docs/poa-standarisasi/01-business-rules.md` §6a) yang sekarang cuma upload dokumen manual apa adanya (lihat riwayat percakapan yang mengoreksi ini). Flow baru yang diminta: sistem **generate memo** dari data pengajuan (bukan user upload dokumen dari luar), lalu role baru **Sales Support** — scope-nya dibatasi ke POA Standarisasi saja — akses memo itu buat diproses (kemungkinan cetak/tanda tangan di luar sistem), dan begitu selesai di-sign, Sales Support tinggal centang status di sistem — pola sama seperti checkbox `sudahTtd` pada approval dokter yang sudah ada (`poaStandarisasi.ts:1104`).
