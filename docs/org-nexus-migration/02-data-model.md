# Org Structure Nexus Migration — Data Model

## Tidak ada model/migration baru

`User` (schema.prisma) sudah punya semua field yang dibutuhkan — `nip`, `name`, `role`, `nipAtasan`, `namaAtasan`, `isActive`, `syncedAt`, `jabatan`. Migrasi ini murni mengganti **sumber data** yang mengisi field-field itu (`orgStructureSync.ts`: MSSQL → Nexus `get_employees` + `get_subordinates`), sama seperti `docs/outlet-nexus-migration/` mengganti sumber `Outlet`/`MrOutletAssignment` tanpa migration baru.

## Field yang TERPENGARUH (sumber berubah, skema tidak)

| Field `User` | Sumber sekarang (MSSQL) | Sumber diusulkan (Nexus) |
|---|---|---|
| `nip`, `name` | `Struktur_Marketing_PI` kolom `*_NIP`/`*_Nama` | `get_employees` → `nip`/`nama` |
| `role` | Mapping langsung dari kolom asal (`NSM_NIP`→NSM, dst.) | Mapping dari `position` (lihat `01-business-rules.md` §3 langkah 5) |
| `nipAtasan`, `namaAtasan` | Eksplisit di baris yang sama (`*_NIP` kolom sebelah) | **Diinferensi** dari `get_subordinates` (§3) — TIDAK eksplisit dari API |
| `isActive` | `true` untuk semua NIP hasil query terbaru, `false` untuk yang hilang | Sama (pending OQ-3) |
| `jabatan` | Override display-only untuk SPV (tidak berubah role) | Sama pola, dari `position === "Supervisor"` |

## Field yang TIDAK terpengaruh / tetap dari sumber lain

- `email` — sudah `null` dari MSSQL sync saat ini, tidak berubah (di luar scope).
- `Outlet.coveredByNip`/`coveredByRole`, `kategori` — tetap dari `importStrukturVerifiedKAM.ts` (tidak ikut migrasi ini maupun migrasi outlet sebelumnya — lihat `docs/outlet-nexus-migration/README.md:8`).
- `GM`/`ADMIN`/`SFE`/`VIEWER` role users — tidak disentuh sync manapun (manual), tidak berubah.

## Invariant yang harus tetap benar setelah migrasi

- Setiap `User` dengan `role` selain `NSM` harus punya `nipAtasan` yang valid (mengarah ke `User.nip` lain yang ada) KECUALI kasus vacant-team yang sudah ditangani `authz.ts` (`canCreatePoa`, `Outlet.coveredByNip`/`coveredByRole`) — migrasi ini tidak boleh memperkenalkan `nipAtasan` yang menunjuk ke NIP yang tidak ada di `User` (constraint yang sama sudah dijaga MSSQL sync sekarang, lihat `orgStructureSync.ts:179` "manager NIP not found" error).
- Rantai `nipAtasan` dari MR manapun harus tetap sampai ke NSM dalam jumlah hop yang wajar (tidak ada cycle) — belum ada guard eksplisit untuk ini di kode manapun (baik MSSQL maupun usulan Nexus), dicatat sebagai gap yang sudah ada sebelumnya, bukan regresi baru dari migrasi ini.

## Performa

Tidak ada company-wide read pattern baru di jalur MR-facing (sync ini backend/cron-only, sama seperti sekarang) — tidak perlu cross-reference `docs/PERFORMANCE.md`. Volume panggilan Nexus per sync run: 1x `get_employees` + N `get_subordinates` (N = jumlah employee dengan posisi bukan Field Force, jauh di bawah 375 total) dengan concurrency 10 (pola sama dengan `outletSync.ts`) — jauh dari skala "company-wide per-request" yang jadi concern `PERFORMANCE.md`.
