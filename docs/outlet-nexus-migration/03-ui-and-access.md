# Outlet Sync — UI, Akses & Trigger

## Tidak ada UI baru

Migrasi ini murni perubahan sumber data pada proses sync backend (`src/lib/sync/outletSync.ts`). Tidak ada halaman, komponen, atau role/access matrix baru — semua halaman yang mengonsumsi `Outlet`/`MrOutletAssignment` (POA form, Summary, dsb.) tidak berubah perilakunya, karena bentuk data akhirnya (skema Prisma) tetap sama (lihat `02-data-model.md`).

## Role/akses

Tidak ada perubahan. `canCreatePoa()` dan seluruh logic akses yang bergantung pada `Outlet.coveredByNip`/`coveredByRole` tidak terpengaruh, karena field itu sengaja tidak disentuh sync ini (`01-business-rules.md` §3, OQ-3).

## Trigger

- Tetap dijalankan manual/via cron eksternal lewat `npx tsx scripts/syncOrg.ts` (`scripts/syncOrg.ts:1-7`), urutan: org sync dulu (`runOrgSync`, tidak berubah), baru outlet sync (`runOutletSync`, sumber datanya yang berubah).
- `runOutletSync` **tidak** dapat route HTTP baru di v1 (beda dari `runOrgSync` yang punya `POST /api/sync/org-structure`) — lihat OQ-5 di `01-business-rules.md`. Kalau nanti dibutuhkan trigger independen (mis. karena sumber baru real-time sehingga ingin sync lebih sering dari org structure), itu perubahan terpisah, bukan bagian v1 ini.
- Konektivitas ke Nexus: endpoint publik, tanpa auth (dikonfirmasi 2026-07-23 — catatan yang sama persis dengan `customer.ts:524-525`). Tidak perlu secret/API key baru di env.

## Non-goals v1

- **Tidak** membangun endpoint/route HTTP baru untuk trigger outlet sync independen (OQ-5).
- **Tidak** mengisi `statusOutlet`, `kategori`, `namaChannel`, `groupRS`, `coveredByNip`/`coveredByRole` dari Nexus — field ini tetap dari `importStrukturVerifiedKAM.ts` sampai ada endpoint Nexus terpisah (OQ-3, keputusan eksplisit pengguna).
- **Tidak** memigrasikan `orgStructureSync.ts` (`User`/`nipAtasan`) ke Nexus (`get_employees`/`get_subordinates`) — sengaja dipisah menjadi spec tersendiri (lihat `README.md` §"Terkait, tapi di luar scope").
- **Tidak** menyelesaikan gap outlet dengan rantai kepemilikan vacant total (OQ-1) — didokumentasikan sebagai keterbatasan yang diketahui, bukan diselesaikan diam-diam di v1.
- **Tidak** mengubah `OutletStrukturBaru` (staging table terpisah, `docs/form-poa/03-ui-and-access.md:170`) — migrasi ini menyentuh `Outlet`/`MrOutletAssignment` produksi saja.
- **Tidak** menghapus atau mengganti MSSQL connection (`MSSQL_CONNECTION_STRING`) — tetap dipakai `orgStructureSync.ts`, jadi env/dependency MSSQL tidak bisa dilepas hanya karena outlet sync ini pindah sumber.
