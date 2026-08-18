# Org Structure Nexus Migration — UI & Access

## Tidak ada role/access matrix baru

Migrasi ini mengganti sumber data backend saja (`orgStructureSync.ts`) — tidak ada halaman baru, tidak ada perubahan ke `authz.ts`. Semua predicate yang sudah ada (`canCreatePoa`, `canApprove`, `canView`, `getSubordinateMRNips`, dll.) tetap membaca `User.role`/`User.nipAtasan` dari Postgres seperti sekarang; mereka tidak peduli field itu diisi dari MSSQL atau Nexus.

## Halaman yang terpengaruh (tidak langsung, lewat data)

Tidak ada halaman yang di-reuse/dimodifikasi. Efeknya murni pada KEBENARAN DATA yang halaman-halaman berikut baca dari `User`:
- Approval chain (`resolveNextHolder`, `poaWorkflow.ts`) — siapa `currentHolderId` berikutnya saat submit/approve.
- Login/session (`getCurrentUser`) — `role` menentukan menu Sidebar dan halaman yang bisa diakses.
- Dropdown assign/hierarki di halaman admin (jika ada) yang menampilkan `nipAtasan`/`namaAtasan`.

Kesalahan pada rekonstruksi `nipAtasan` (lihat `01-business-rules.md` OQ-1) akan bermanifestasi sebagai bug approval — SALAH SATU alasan kuat kenapa ini butuh SDD (dampaknya user-facing walau sumbernya backend murni).

## Trigger endpoint

Sama seperti sekarang: `POST /api/sync/org-structure` (header `X-Sync-Secret`) atau `npm run sync:org` manual — TIDAK ada UI trigger baru diusulkan di v1 ini. `scripts/syncOrg.ts` perlu diupdate urutannya kalau org sync tidak lagi butuh `MSSQL_CONNECTION_STRING` (env var itu sendiri kemungkinan masih dipakai fitur lain — cek sebelum dihapus dari `.env.example`).

## Non-goals v1

- **Tidak** mengganti mekanisme trigger sync (masih manual/cron-external, bukan real-time per-request seperti customer).
- **Tidak** menyentuh `GM`/`ADMIN`/`SFE`/`VIEWER` — role-role ini tetap dikelola manual, di luar scope migrasi ini (lihat OQ-4).
- **Tidak** mengubah `Outlet.coveredByNip`/`coveredByRole`/`kategori` — tetap dari `importStrukturVerifiedKAM.ts`.
- **Tidak** menambah UI baru untuk menampilkan/mengedit hierarki org secara manual (kalau dibutuhkan sebagai mitigasi risiko OQ-1, itu keputusan terpisah, dicatat sebagai follow-up potensial, bukan bagian v1).
