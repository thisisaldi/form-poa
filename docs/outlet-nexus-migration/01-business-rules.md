# Outlet Sync — Business Rules

Requirement asli: lihat `README.md` §Sumber requirement — hasil percakapan lisan + konfirmasi `AskUserQuestion`, sesi 2026-08-06.

## 1. Ruang lingkup perubahan

Yang berubah: `src/lib/sync/outletSync.ts` — sumber data untuk `Outlet` (master outlet) dan `MrOutletAssignment` (junction MR × outlet per periode), dari MSSQL `Struktur_Marketing_PI` menjadi Nexus API `GET https://api-nexus.pharos.id/api/r/poa/get_outlet_by_nip?nip={nip}`.

Yang **tidak berubah**:
- `orgStructureSync.ts` (`User` + hierarki `nipAtasan`) — tetap dari MSSQL. Daftar NIP yang di-iterasi untuk sync outlet diambil dari `User` di Postgres (hasil sync ini), bukan dari Nexus `get_employees`.
- `scripts/importStrukturVerifiedKAM.ts` — tetap satu-satunya sumber untuk `Outlet.kategori`, `Outlet.groupRS`, `Outlet.coveredByNip`/`coveredByRole`.
- Urutan eksekusi `scripts/syncOrg.ts` (org sync dulu, baru outlet sync) — tidak berubah, karena assignment tetap butuh `User` sudah ada.
- Trigger/route: masih dipanggil dari `scripts/syncOrg.ts`. (Catatan: berbeda dari org-structure yang punya route `POST /api/sync/org-structure`, `runOutletSync` saat ini TIDAK punya route sendiri — hanya dipanggil dari script. Di luar scope spec ini untuk menambah route baru, kecuali diminta terpisah.)

## 2. Alur sync yang baru

1. Ambil semua NIP aktif dari `User` di Postgres yang berperan sebagai pemegang outlet (role `MR`, mengikuti pola `effectiveMrNip` yang sudah ada — SPV bertindak sebagai MR bila kolom MR kosong, lihat `docs/TODO.md` #1). **Sumber pasti daftar role mana yang di-include perlu disamakan dengan definisi `effectiveMrNip` di `importStrukturVerifiedKAM.ts`, bukan didefinisikan ulang di sini** (prinsip cross-reference, `04-quality-checklist.md` §15).
2. Untuk tiap NIP di daftar itu, panggil `get_outlet_by_nip?nip={nip}` dengan concurrency terbatas (lihat §4), timeout 5 detik, 1x retry untuk error transient (timeout/5xx) sebelum dihitung gagal — pola yang sama dengan `fetchNexusCustomersByOutlet` (`customer.ts:530-556`) ditambah 1 retry karena ini sync batch (bukan live request user) sehingga baru boleh lebih toleran ke latency.
3. Kumpulkan seluruh `(nip, outlet)` pair dari respons yang berhasil.
4. Upsert `Outlet` per outlet unik yang muncul (field mapping lihat `02-data-model.md`).
5. Rebuild `MrOutletAssignment` untuk periode berjalan (`YYYYMM` saat ini, format sama seperti kode lama) — **hanya jika threshold kegagalan terpenuhi** (lihat §5), mengikuti pola delete-lalu-recreate yang sudah ada (`outletSync.ts:140-161`).

## 3. Field mapping (ringkasan — detail lengkap di `02-data-model.md`)

| Field `Outlet` | Sumber baru (Nexus) | Berubah? |
|---|---|---|
| `kodePI` | `code` | Sumber ganti, semantik sama |
| `namaOutlet` | `name` | Sumber ganti, semantik sama |
| `sector` | `sector` | Sumber ganti, semantik sama |
| `kota` | `city` | Sumber ganti, semantik sama |
| `propinsi` | `province` | Sumber ganti, semantik sama |
| `kodeArea`/`namaArea` | `area_code`/`area_name` | Sumber baru (sebelumnya dari Excel `importStrukturVerifiedKAM.ts`, sekarang dari sync rutin) |
| `kodeReg`/`namaReg` | `region_code`/`region_name` | Sumber baru (idem) |
| `kodeSub`/`namaSub` | `subarea_code`/`subarea_name` — **⚠️ asumsi, lihat OQ-2** | Sumber baru (idem) |
| `kodeGT`/`namaGT` | `territory_code`/`territory_name` — **⚠️ asumsi, lihat OQ-2** | Sumber baru (idem) |
| `outCode` | — | **Tidak ada di Nexus, tidak disentuh** (nilai lama dipertahankan) |
| `namaChannel` | — | **Tidak ada di Nexus, tidak disentuh** |
| `statusOutlet` | — | **Tidak ada di Nexus, tidak disentuh** |
| `groupRS`, `kategori` | — | **Tidak ada di Nexus, tidak disentuh** (tetap dari `importStrukturVerifiedKAM.ts`) |
| `coveredByNip`/`coveredByRole` | — | **Tidak ada di Nexus, tidak disentuh** (tetap dari `importStrukturVerifiedKAM.ts`) |

Konsekuensi penting: karena field yang "tidak disentuh" itu di-skip di `update:` clause upsert (bukan di-set `null`), sync baru ini **menambahkan** field baru (area/region/sub/GT) yang sebelumnya hanya terisi lewat import Excel manual, sekaligus **berhenti** meng-update `outCode`/`namaChannel`/`statusOutlet` yang sebelumnya rutin ter-refresh dari MSSQL setiap sync — nilainya akan makin basi (stale) seiring waktu sampai ada endpoint Nexus terpisah untuk field itu (sesuai keputusan pengguna).

## 4. Concurrency & resiliency

- Concurrency panggilan `get_outlet_by_nip`: **10 paralel** (meniru `scripts/compareNexusVsStrukturBaru.ts:22`, sudah terbukti bekerja untuk ratusan NIP tanpa masalah rate-limit).
- Timeout per panggilan: **5 detik**, 1x retry untuk timeout/HTTP 5xx (bukan untuk 4xx — dianggap gagal permanen untuk NIP itu, tidak di-retry).
- NIP yang gagal (setelah retry) dicatat di `errors[]` pada return value `OutletSyncResult`, sama seperti pola error collection yang sudah ada (`outletSync.ts:114-116`).

## 5. Perilaku kegagalan (WAJIB — lihat `04-quality-checklist.md` §13)

Berbeda dari MSSQL (1 query atomik, gagal = seluruh sync gagal jelas), pendekatan per-NIP punya kegagalan parsial yang mungkin sering terjadi (network flaky, NIP tertentu tidak dikenal Nexus, dst). Aturan, dikonfirmasi pengguna 2026-08-06 (resolusi OQ-1, lihat §6):

- **Upsert `Outlet`**: idempotent per-outlet, aman dilakukan untuk outlet mana pun yang berhasil didapat walau NIP lain gagal — tidak ada delete-first untuk `Outlet`, jadi partial success tidak merusak data lama.
- **Rebuild `MrOutletAssignment` — delete SELEKTIF per NIP, bukan delete-semua-periode**: kode lama (`outletSync.ts:140-142`) men-delete SEMUA `MrOutletAssignment` periode berjalan sebelum insert ulang — aman untuk MSSQL (1 query atomik, pasti lengkap), tapi **tidak boleh dipakai apa adanya** untuk sumber per-NIP karena assignment milik NIP yang gagal/tidak ter-iterasi akan hilang tanpa pernah digantikan.
  - **Aturan final**: hanya delete `MrOutletAssignment` untuk periode berjalan **WHERE `nipMR` termasuk dalam daftar NIP yang BERHASIL di-fetch pada run ini** (bukan seluruh NIP yang di-iterasi — NIP yang gagal fetch TIDAK ikut di-delete). Baru setelah itu, insert assignment baru dari hasil Nexus untuk NIP-NIP tersebut.
  - Konsekuensi: assignment milik NIP yang gagal di-fetch (setelah retry) tetap seperti apa adanya dari run sebelumnya — tidak dihapus, tidak "menghilang", akan tertangkap ulang di run berikutnya kalau NIP itu berhasil di-fetch. Ini juga otomatis menjawab kekhawatiran outlet dengan status vacant (§6 OQ-1): outlet yang memang genuinely tidak punya NIP aktif untuk di-iterasi (sudah tidak ter-cover MrOutletAssignment sejak sebelum migrasi — kode lama pun skip bikin assignment kalau `nipMR` null, `outletSync.ts:124-125`) sama sekali tidak tersentuh proses delete ini, statusnya identik dengan sebelum migrasi.
  - Tidak perlu threshold failure-rate global (dihapus dari desain) — karena delete-nya sudah scoped per-NIP, kegagalan sebagian NIP tidak lagi berisiko merusak assignment NIP lain yang berhasil, jadi tidak perlu mekanisme abort-semua.

## 6. Open questions — status & assumptions dipakai untuk v1

| # | Pertanyaan | Asumsi yang dipakai untuk v1 | Perlu konfirmasi dari |
|---|---|---|---|
| OQ-1 (**RESOLVED 2026-08-06**) | Outlet yang seluruh rantai kepemilikannya (semua level MR/SPV/ASM/SM/NSM) vacant tidak akan pernah muncul di hasil `get_outlet_by_nip` mana pun (karena endpoint ini diindeks per-NIP, bukan per-outlet). Pengguna: *"caranya agar yang assignment vacant tidak berubah dari yang sekarang gimana"* — kekhawatirannya bukan soal outlet baru yang perlu ditemukan, tapi memastikan assignment/data yang SUDAH ada untuk outlet vacant tidak ikut terhapus/rusak oleh proses migrasi. | **Resolusi**: `MrOutletAssignment` diubah jadi delete SELEKTIF per NIP yang berhasil di-fetch pada run ini (§5), bukan delete-semua-periode. Outlet/NIP yang tidak ter-iterasi (termasuk kasus vacant total) sama sekali tidak tersentuh — persis seperti kondisi sebelum migrasi, karena kode lama pun sudah skip assignment untuk `nipMR` null (`outletSync.ts:124-125`). `Outlet.coveredByNip`/`coveredByRole` (mekanisme fallback vacant yang sesungguhnya) juga tidak disentuh migrasi ini sama sekali (OQ-3) — jadi vacant-coverage tetap identik dengan sebelum migrasi. | Selesai — tidak ada aksi lanjutan. |
| OQ-2 | Mapping field hierarki teritori Nexus (`area_code/name`, `subarea_code/name`, `territory_code/name`, `region_code/name`) ke kolom `Outlet` (`kodeArea/namaArea`, `kodeSub/namaSub`, `kodeGT/namaGT`, `kodeReg/namaReg`) — sample yang dicek langsung (NIP `L260135`, 2026-08-06) menunjukkan beberapa baris punya `subarea_name` dan `territory_name` yang **identik** ("MUARA BARU TZU CHI" di keduanya), sehingga tidak 100% jelas apakah `territory_code` selalu setara `kodeGT` (finest level di skema kita) atau kadang tumpang tindih dengan level subarea. | Mapping `territory→GT`, `subarea→Sub`, `area→Area`, `region→Reg` dipakai sebagai asumsi kerja awal (urutan granularitas paling masuk akal: region terluas → area → subarea → territory terkecil, sejalan urutan kolom Excel `importStrukturVerifiedKAM.ts:125-131` yang juga region→area→subarea→GT). | **Tim/implementer** — validasi dengan sample lebih besar (puluhan NIP lintas region) sebelum kode mapping final ditulis, bukan cuma 1 sample. |
| OQ-3 | Field yang tidak tersedia di `get_outlet_by_nip` (`statusOutlet`, `kategori`, `namaChannel`, `groupRS`, `coveredByNip`/`coveredByRole`) — pengguna menyebut "lebih baik jadi API sendiri" tapi endpoint itu belum ada. | v1 berjalan TANPA field-field ini di-refresh oleh sync rutin — tetap dari `importStrukturVerifiedKAM.ts` (proses manual/periodik yang sudah ada). Tidak diblok menunggu endpoint baru. | **Pengguna/tim Nexus** — kapan endpoint tersebut akan tersedia, agar bisa direncanakan sebagai fase v2 terpisah (spec baru, bukan bagian dari migrasi ini). |
| OQ-4 (**RESOLVED 2026-08-06**, ditiadakan) | Sebelumnya: threshold kegagalan global untuk skip rebuild assignment. | Tidak relevan lagi — digantikan desain delete selektif per NIP (§5, resolusi OQ-1), yang membuat threshold global tidak diperlukan sama sekali. | — |
| OQ-5 | Apakah `runOutletSync` tetap hanya dipanggil dari `scripts/syncOrg.ts` (manual/cron eksternal via script), atau perlu route `POST /api/sync/outlet` seperti `org-structure` supaya bisa di-trigger independen (mis. lebih sering, karena sumbernya sekarang live API bukan snapshot MSSQL periodik)? | Tidak berubah — tetap lewat `scripts/syncOrg.ts`, tidak menambah route baru di v1. | **Pengguna** — kalau frekuensi sync perlu berubah karena sumber baru real-time, ini keputusan terpisah. |
