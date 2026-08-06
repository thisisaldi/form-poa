# Outlet Sync — Migrasi Sumber dari MSSQL ke Nexus API

## Sumber requirement

Permintaan lisan dari pengguna (percakapan sesi 2026-08-06), dipicu oleh dokumentasi EchoAPI untuk 3 endpoint Nexus (`get_employees`, `get_outlet_by_nip`, `get_customer_by_outlet`) yang di-share stakeholder ("i Kadek Juni Saputra", update terakhir 2026-07-15). Setelah investigasi menunjukkan `get_customer_by_outlet` sudah live di produksi (`src/app/actions/customer.ts:530-611`, sejak 2026-07-23) dan berjalan baik, pengguna menyatakan **rencana memindahkan sumber data outlet** dari sync MSSQL yang ada sekarang ke Nexus API. Konfirmasi strategi (AskUserQuestion, sesi yang sama):
- Strategi: **cutover penuh** — `outletSync.ts` diganti sumbernya dari MSSQL `Struktur_Marketing_PI` ke Nexus `get_outlet_by_nip`, bukan live-merge/fallback seperti pola customer.
- Daftar NIP yang di-iterasi **tetap dari MSSQL `User`** (org structure/`orgStructureSync.ts` tidak berubah) — hanya outlet-per-NIP yang pindah sumber.
- Field yang tidak ada di response Nexus (`statusOutlet`, `kategori`, `namaChannel`, `coveredByNip`/`coveredByRole`) — pengguna: *"itu lebih baik buat jadi api sendiri sih"*, artinya field-field ini **di luar scope v1**, menunggu endpoint Nexus terpisah yang belum ada, dan **tidak disentuh** oleh sync ini (tetap dikelola proses lain).

## Terkait, tapi di luar scope

Selama diskusi ditemukan endpoint Nexus keempat, `get_subordinates?nip=` (balikan: daftar bawahan langsung `{nip, nama, project, position}`) — berpotensi dipakai merekonstruksi hierarki `nipAtasan` yang sekarang disinkron `orgStructureSync.ts` dari MSSQL. Pengguna memutuskan (2026-08-06) migrasi org structure ini **tetap dipisah** dari spec outlet ini, akan jadi spec SDD tersendiri kalau/ketika dikerjakan — dicatat di sini sebagai pointer, bukan dibangun di spec ini.

## Status

🟢 **v1 diimplementasikan 2026-08-06** — `src/lib/sync/outletSync.ts` ditulis ulang total: `runOutletSync()` tidak lagi menerima `connectionString` MSSQL, sekarang meng-iterasi NIP `role=MR` aktif dari Postgres `User`, memanggil `get_outlet_by_nip` per NIP (concurrency 10, timeout 5s, 1x retry untuk 5xx/network error), upsert `Outlet` untuk field yang tersedia dari Nexus, dan rebuild `MrOutletAssignment` dengan delete SELEKTIF per NIP yang berhasil di-fetch (bukan delete-semua-periode) — resolusi OQ-1. Caller `scripts/syncOrg.ts` diupdate mengikuti signature baru. `docs/form-poa/02-data-model.md` diperbarui agar tidak lagi menyebut `Outlet` bersumber MSSQL. `npx tsc --noEmit` bersih.

**Yang TIDAK diimplementasikan di v1** (sesuai `03-ui-and-access.md` §Non-goals): route HTTP terpisah untuk trigger outlet sync (OQ-5), pengisian `statusOutlet`/`kategori`/`namaChannel`/`coveredByNip`/`coveredByRole` dari Nexus (OQ-3 — tetap dari `importStrukturVerifiedKAM.ts`), migrasi `orgStructureSync.ts`/`User.nipAtasan` ke Nexus.

⚠️ **Belum diverifikasi jalan di lingkungan nyata** — implementasi baru lolos type-check, belum pernah dijalankan (`npx tsx scripts/syncOrg.ts`) melawan Nexus + Postgres sungguhan. Sebelum dianggap selesai penuh, jalankan sekali di staging dan periksa: jumlah outlet/assignment yang ter-upsert masuk akal, error rate NIP wajar, dan mapping hierarki teritori (OQ-2 — `kodeSub`/`namaSub` dari `subarea_code`/`name`, `kodeGT`/`namaGT` dari `territory_code`/`name`) tervalidasi dengan sample lebih besar dari 1 NIP.

## Ringkasan

`outletSync.ts` saat ini melakukan satu query MSSQL ke `Struktur_Marketing_PI` yang sekaligus menghasilkan outlet master data + assignment MR→outlet, karena satu baris tabel itu sudah punya kolom `SPV_NIP`/`FF_NIP`. Nexus `get_outlet_by_nip` punya bentuk terbalik: query per-NIP, balikan daftar outlet milik NIP itu. Migrasi ini mengganti sumber outlet master + assignment dengan memanggil endpoint tersebut untuk tiap NIP aktif di tabel `User` (hasil `orgStructureSync.ts`, tidak berubah), lalu upsert `Outlet` + rebuild `MrOutletAssignment` dari hasil gabungan seluruh panggilan. Field yang secara struktural tidak tersedia di Nexus (status, kategori, channel, cascade coverage) sengaja tidak disentuh sync ini — tetap dikelola `scripts/importStrukturVerifiedKAM.ts` seperti sekarang. Lihat `docs/TODO.md` #1 (Struktur baru) dan #14 (Monitoring POA lama, sudah menyebut eksplorasi Nexus) untuk konteks upstream.
