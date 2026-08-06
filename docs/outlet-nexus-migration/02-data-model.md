# Outlet Sync — Data Model

## Model yang sudah ada (tidak ada migration baru)

Migrasi ini **tidak menambah tabel/kolom baru** — `Outlet` (`prisma/schema.prisma:378-421`) dan `MrOutletAssignment` (`:884-897`) dipakai apa adanya, hanya sumber datanya yang berubah untuk sebagian kolom. Tidak ada perubahan skema Prisma di v1.

## Sumber per field — sebelum vs sesudah

| Kolom `Outlet` | Sebelum (MSSQL `Struktur_Marketing_PI`) | Sesudah (Nexus `get_outlet_by_nip`) |
|---|---|---|
| `kodePI` (PK) | `KodePI` | `code` |
| `namaOutlet` | `NamaOutlet` | `name` |
| `outCode` | `Out_Code` | *(tidak disentuh — nilai lama dipertahankan, lihat `01-business-rules.md` §3)* |
| `statusOutlet` | `StatusOutlet` | *(tidak disentuh)* |
| `namaChannel` | `Nama_Channel` | *(tidak disentuh)* |
| `groupRS` | *(sudah dari `importStrukturVerifiedKAM.ts`, bukan `outletSync.ts`)* | *(tidak berubah — tetap dari situ)* |
| `sector` | `Sector` | `sector` |
| `subSektor` | `Sub_Sektor` | *(⚠️ tidak ada field setara eksplisit di sample response — di-skip di v1, nilai lama dipertahankan; perlu dicek ulang saat validasi sample lebih besar, OQ-2)* |
| `kota` | `Kota` | `city` |
| `propinsi` | `Propinsi` | `province` |
| `kategori` | *(sudah dari `importStrukturVerifiedKAM.ts`)* | *(tidak berubah)* |
| `kodeArea`/`namaArea` | *(sudah dari `importStrukturVerifiedKAM.ts`)* | **BARU**: `area_code`/`area_name` — sekarang ikut ter-refresh oleh sync rutin |
| `kodeReg`/`namaReg` | *(sudah dari `importStrukturVerifiedKAM.ts`)* | **BARU**: `region_code`/`region_name` |
| `kodeSub`/`namaSub` | *(sudah dari `importStrukturVerifiedKAM.ts`)* | **BARU (⚠️ asumsi OQ-2)**: `subarea_code`/`subarea_name` |
| `kodeGT`/`namaGT` | *(sudah dari `importStrukturVerifiedKAM.ts`)* | **BARU (⚠️ asumsi OQ-2)**: `territory_code`/`territory_name` |
| `coveredByNip`/`coveredByRole` | *(sudah dari `importStrukturVerifiedKAM.ts`)* | *(tidak berubah — tidak ada padanan di Nexus, OQ-3)* |
| `syncedAt` | `now` saat sync jalan | `now` saat sync jalan (tidak berubah) |

`MrOutletAssignment` (`nipMR`, `kodePI`, `periode`, `syncedAt`): sumbernya berubah total secara struktural — sebelumnya diturunkan dari kolom `SPV_NIP`/`FF_NIP` per baris outlet (arah outlet→NIP), sekarang diturunkan dari hasil agregasi seluruh panggilan `get_outlet_by_nip` per NIP aktif (arah NIP→outlet, dibalik). Bentuk akhir tabelnya (unique `[nipMR, kodePI, periode]`) tidak berubah.

## Catatan desain — invariant

- **`Outlet.kodePI` tetap PK alami**, tidak berubah jadi UUID — konsisten dengan seluruh FK yang sudah bergantung padanya (`CustomerOutlet`, `MrOutletAssignment`, `SurveyRekomendasi`, dst., lihat `docs/form-poa/02-data-model.md:62`). Nexus `code` harus di-trim dan divalidasi non-empty sebelum dipakai sebagai PK, sama seperti kode lama menangani `KodePI` (`outletSync.ts:71` fallback ke `row.KodePI` sendiri kalau nama kosong — pola serupa perlu dipertahankan untuk field wajib dari Nexus).
- **Upsert `Outlet` bersifat idempotent dan tidak pernah delete** — invariant ini tidak berubah dari kode lama. Outlet yang berhenti muncul di hasil Nexus (baik karena benar-benar tidak eksis lagi, atau karena masuk kasus OQ-1 — rantai kepemilikan vacant total) TIDAK dihapus, hanya berhenti ter-refresh (`syncedAt` tidak maju lagi). Ini best-effort, bukan garansi kelengkapan — didokumentasikan eksplisit sebagai batasan (lihat OQ-1).
- **`MrOutletAssignment` per periode bersifat replace-all, bukan merge** — invariant "1 MR hanya 1 assignment aktif per outlet per periode" (`docs/form-poa/02-data-model.md:62`) tetap dipertahankan, tapi proses rebuild-nya sekarang punya guard tambahan (threshold kegagalan, `01-business-rules.md` §5) yang tidak ada di versi MSSQL — karena sumber data baru punya failure mode yang MSSQL (1 query atomik) tidak punya.
- Field yang "tidak disentuh" (§ tabel di atas) **bukan berarti nullable baru** — skema `Outlet` sudah menjadikan semua field itu nullable sejak awal (`String?`), jadi tidak ada perubahan constraint. Yang berubah hanya: field itu sekarang **hanya** terisi/refresh lewat `importStrukturVerifiedKAM.ts` (periodik/manual), bukan lagi lewat 2 jalur (sync rutin + import manual) seperti kombinasi lama `statusOutlet`/`namaChannel` yang sebelumnya ikut ter-refresh `outletSync.ts` juga.

## Performa

Tidak cross-reference ke `docs/PERFORMANCE.md` — ini adalah proses sync batch/cron (dijalankan dari `scripts/syncOrg.ts`, bukan halaman yang diakses user), bukan query company-wide yang di-trigger dari request pengguna. Constraint performa di dokumen itu berlaku untuk halaman yang diakses langsung oleh role ADMIN/GM/NSM, bukan untuk proses sync latar belakang.

Yang perlu diperhatikan (bukan dari `PERFORMANCE.md`, tapi relevan untuk desain sync ini): jumlah panggilan HTTP ke Nexus sebanding dengan jumlah NIP aktif (ratusan, berdasarkan hasil `get_employees?project=ethical` yang sudah dicoba — daftar karyawan berjumlah signifikan). Dengan concurrency 10 dan asumsi latency wajar per call, total waktu sync akan lebih lama dari 1 query MSSQL tunggal — perlu diukur saat implementasi (bukan asumsi angka di sini) apakah durasi totalnya masih dalam batas wajar untuk dijalankan via cron.
