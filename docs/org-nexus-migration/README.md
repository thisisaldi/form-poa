# Org Structure Nexus Migration — Spec Index

## Sumber requirement

Diminta langsung oleh pengguna via chat, 2026-08-18: *"untuk list employees, outlet yang dipegang employee tersebut, dan customer yang ada di outlet tersebut harusnya fully live. pakai API nya"*. Outlet dan customer sudah live (lihat `docs/outlet-nexus-migration/` dan `src/app/actions/customer.ts:645-706`) — sisa satu bagian yang belum: **employees** (`User` + hierarki `nipAtasan`), yang sampai sekarang disync dari MSSQL (`orgStructureSync.ts`).

Ini bukan requirement baru — pengguna sendiri sudah mencatatnya di `docs/outlet-nexus-migration/README.md:12` (2026-08-06) sebagai "akan jadi spec SDD tersendiri kalau/ketika dikerjakan", dan `docs/TODO.md` #14 (2026-08-06) sudah mendaftar `get_employees`/`get_subordinates` sebagai endpoint yang tercatat tapi belum dipakai.

Trigger SDD yang terpenuhi (`docs/sdd/01-when-and-workflow.md`): migrasi ini menyentuh **role/access matrix** yang sudah punya pola established di `authz.ts` (jadi bukan RBAC baru), tapi mengganti **sumber data** yang dipakai `resolveNextHolder`/rantai approval ASM→SM→NSM — kesalahan di sini salah, mahal diperbaiki (approval macet/salah orang). Juga ada **ambiguitas nyata**: `get_subordinates` ternyata TIDAK berperilaku seperti dicatat sebelumnya (lihat "Temuan penting" di bawah).

## Status

🟢 **v2 (cutover penuh) diimplementasikan 2026-08-20**, sama hari dengan v1 dry-run — pengguna memutuskan skip sisa siklus dry-run yang direncanakan di OQ-5 dan cutover langsung setelah melihat hasil run pertama di bawah. OQ-1/OQ-2 RESOLVED lewat dry-run 2026-08-18 (lihat `01-business-rules.md` §5). OQ-3/4 dikonfirmasi pengguna 2026-08-20:
- **OQ-3**: ikuti pola MSSQL yang sudah ada (deactivate-by-absence) — hilang dari `get_employees` = `isActive=false`.
- **OQ-4**: GM tetap di luar scope migrasi ini (tetap manual via `importStrukturVerifiedKAM.ts`).
- **OQ-5 (SUPERSEDED)**: rencana semula "jalan paralel/dry-run dulu" — pengguna memutuskan cutover langsung ke Nexus tanpa menunggu siklus tambahan, menerima 96.5% match rate dari run pertama sebagai cukup.

**Yang dibangun**:
- `src/lib/sync/orgNexusInference.ts` (algoritma §3 — fetch `get_employees` + `get_subordinates` per manager, infer `nipAtasan` lewat closest-enclosing-ancestor, terapkan skip-Supervisor rule, map `position`→`Role`) — dipakai LANGSUNG oleh `orgStructureSync.ts` sekarang, bukan cuma dry-run compare lagi.
- `src/lib/sync/orgStructureSync.ts` ditulis ulang: `runOrgSync()` tidak lagi menerima `connectionString` MSSQL, sekarang memanggil `inferOrgHierarchyFromNexus()` dan upsert hasilnya ke `User` (upsert → wire `nipAtasan` → deactivate-by-absence, struktur pass sama seperti versi MSSQL). Caller `scripts/syncOrg.ts` dan `src/app/api/sync/org-structure/route.ts` diupdate mengikuti signature baru (route ini tidak lagi butuh `MSSQL_CONNECTION_STRING`).
- `scripts/compareOrgNexusVsMssql.ts` (dibangun untuk v1) sekarang **historis** — baseline pembandingnya (`User` = MSSQL) sudah tidak berlaku lagi setelah cutover ini, karena `User` sendiri sekarang sumbernya Nexus.
- `npx tsc --noEmit` bersih.

**Hasil run pertama (2026-08-20, live terhadap Nexus + Postgres staging, dipakai sebagai dasar keputusan cutover)**: 374 employee dari Nexus, 0 gagal fetch. Role match 366/367 (1 selisih: `P240138` MSSQL=MR vs Nexus=ASM — kemungkinan promosi yang belum ke-sync MSSQL). `nipAtasan` match 354/367 (96.5%) — lebih rendah dari 99.5% dry-run 08-18, kemungkinan drift organisasi wajar dalam 2 hari (13 mismatch, tidak diinvestigasi lebih lanjut sebelum cutover). ⚠️ **Temuan penting**: 364 user aktif Postgres tidak muncul di Nexus `project=ethical` — TAPI 331 dari itu ternyata `User.project='omega'` (Sales Counter/apotek, lihat branch `POA_SC_CREATE`, kolom `project` belum ada di schema branch ini) — bukan gap struktural, cuma project Nexus yang berbeda. Sisa gap sesungguhnya jauh lebih kecil (~33), dan user-user ini akan ter-deactivate pada run production pertama kecuali gap-nya ditutup dulu.

⚠️ **Belum diverifikasi jalan sebagai cutover di lingkungan nyata** — implementasi lolos type-check, belum pernah dijalankan sebagai sumber `User` yang sungguhan (`npx tsx scripts/syncOrg.ts` atau `POST /api/sync/org-structure`) di staging/production sejak perubahan ini. Sebelum sync production berikutnya jalan: periksa ~33 gap struktural di atas (kalau tidak ditutup, user itu ter-deactivate), dan pantau approval routing (`resolveNextHolder`, `src/lib/poaWorkflow.ts`) tidak macet akibat 13 mismatch `nipAtasan` yang belum diinvestigasi.

## Temuan penting (mengoreksi catatan lama)

`docs/outlet-nexus-migration/README.md:12` mencatat `get_subordinates?nip=` sebagai "balikan: daftar bawahan langsung". **Ini salah** — hasil tes live 2026-08-18 (lihat `01-business-rules.md` §2) menunjukkan endpoint ini balikin **seluruh subtree transitif** di bawah NIP itu (lintas semua level), bukan cuma direct report selevel di bawahnya. Konsekuensinya: rekonstruksi `nipAtasan` tidak sesederhana "panggil sekali per orang, ambil field manager" — perlu algoritma inferensi (lihat §2).

## Ringkasan

`get_employees?project=ethical` (live, terverifikasi 2026-08-18, 375 employee) balikin `{nip, nama, zones, position}` per orang — **tidak ada field manager/atasan langsung**. `get_subordinates?nip=` balikin seluruh subtree di bawah satu NIP, juga tanpa membedakan level. Karena itu, `nipAtasan` per orang harus diinferensi dari pola containment subtree ("atasan langsung = ancestor dengan subtree TERKECIL yang masih memuat orang itu") — didukung terverifikasi (lihat §2), tapi ini adalah pendekatan INFERENSI, bukan field eksplisit dari API, sehingga perlu dikonfirmasi sebagai pendekatan yang bisa diterima sebelum dipakai untuk menentukan rantai approval sungguhan.

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — bukti eksplorasi API, algoritma rekonstruksi hierarki, dan open questions BLOCKING.
2. [`02-data-model.md`](./02-data-model.md) — perubahan pada `User`/`orgStructureSync.ts`, tidak ada migration/model baru.
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — tidak ada perubahan UI/role baru; hanya sumber data sync yang berubah.

## Cross-reference

- `docs/TODO.md` #14 — mencatat 4 endpoint Nexus, termasuk 2 yang jadi subjek spec ini.
- `docs/TODO.md` #1 — asal-usul mapping SPV→MR ("SPV dirubah jabatannya menjadi SPV dari MR", `User.jabatan` sebagai display-only override) yang jadi dasar mapping `position` Nexus di spec ini.
- `docs/outlet-nexus-migration/` — migrasi Nexus sebelumnya (outlet), pola sync yang di-reuse (concurrency, timeout, retry) untuk spec ini.
