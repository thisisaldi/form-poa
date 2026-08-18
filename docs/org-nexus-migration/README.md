# Org Structure Nexus Migration — Spec Index

## Sumber requirement

Diminta langsung oleh pengguna via chat, 2026-08-18: *"untuk list employees, outlet yang dipegang employee tersebut, dan customer yang ada di outlet tersebut harusnya fully live. pakai API nya"*. Outlet dan customer sudah live (lihat `docs/outlet-nexus-migration/` dan `src/app/actions/customer.ts:645-706`) — sisa satu bagian yang belum: **employees** (`User` + hierarki `nipAtasan`), yang sampai sekarang disync dari MSSQL (`orgStructureSync.ts`).

Ini bukan requirement baru — pengguna sendiri sudah mencatatnya di `docs/outlet-nexus-migration/README.md:12` (2026-08-06) sebagai "akan jadi spec SDD tersendiri kalau/ketika dikerjakan", dan `docs/TODO.md` #14 (2026-08-06) sudah mendaftar `get_employees`/`get_subordinates` sebagai endpoint yang tercatat tapi belum dipakai.

Trigger SDD yang terpenuhi (`docs/sdd/01-when-and-workflow.md`): migrasi ini menyentuh **role/access matrix** yang sudah punya pola established di `authz.ts` (jadi bukan RBAC baru), tapi mengganti **sumber data** yang dipakai `resolveNextHolder`/rantai approval ASM→SM→NSM — kesalahan di sini salah, mahal diperbaiki (approval macet/salah orang). Juga ada **ambiguitas nyata**: `get_subordinates` ternyata TIDAK berperilaku seperti dicatat sebelumnya (lihat "Temuan penting" di bawah).

## Status

⬜ **Belum dimulai — spesifikasi masih draft, ada open question BLOCKING yang belum terjawab.** Tidak ada kode implementasi yang ditulis untuk migrasi ini. Investigasi live terhadap API Nexus sudah dilakukan (2026-08-18, lihat bukti di `01-business-rules.md`), tapi migrasi `orgStructureSync.ts` itu sendiri belum disentuh — `User`/`nipAtasan` masih 100% dari MSSQL sampai spec ini convergen dan v1 diimplementasikan.

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
