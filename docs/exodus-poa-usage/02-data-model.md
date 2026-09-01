# Exodus POA Usage Flag — Data Model

## Data yang sudah ada (reuse, tanpa perubahan)

- `PoaDoctorApproval` (`prisma/schema.prisma:215`) — baris ini SELALU sudah ada untuk dokter manapun yang lolos filter `GET /api/poa-doctors` (endpoint itu sudah exclude dokter yang belum pernah diapprove, dan baris `PoaDoctorApproval` dibuat lazy saat submit pertama — lebih awal dari titik approve manapun). Artinya field status penggunaan Exodus aman ditaruh di sini, tidak perlu tabel terpisah untuk kasus "dokter belum pernah disubmit" karena dokter seperti itu memang tidak pernah muncul di response yang dipakai Exodus.
- Unique key `[poaId, kodePI, namaCust]` dipakai untuk resolve baris dari `uidCustomer` (anchor item → kodePI/namaCust via `PoaLineItem`, sama seperti yang sudah dilakukan `poaDoctorsRows.ts` untuk grouping dokter).
- `getLiveProductPricing()` (`src/lib/exodusApi.ts:122`, sudah ada sejak 2026-08-26, sebelum fitur ini) — fetch live ke Exodus core products API (`api.pharos.id/exodus/core/v1/products`), dengan in-memory cache 5 menit. Sudah dipakai `masterData.ts` untuk override `Product.hna`/`Product.nilaiRPersen` di product picker app sendiri (`applyLivePricing`). **Diperluas 2026-08-27** untuk fitur ini: `LivePricing` sekarang juga membawa `rValue` (raw, sebelumnya di-compute jadi rasio `nilaiRPersen` lalu dibuang) — lihat "Data baru" di bawah.
- `Product.hna`/`Product.nilaiRPersen` (`prisma/schema.prisma:574-575`, master data produk, key `kodeProduk`) — dipakai sebagai FALLBACK kalau live API di atas tidak tersedia. `hna` = "HNA per SJ" (**S**atuan **J**ual, bukan ST). `nilaiRPersen` = `r_value ÷ hna` (rasio), disimpan oleh `scripts/syncNilaiR.ts`/`scripts/importProductR.ts` — dipakai untuk merekonstruksi `nilaiR` (Rupiah) = `nilaiRPersen × hna` saat live API tidak tersedia.

## Data baru (migration `20260826000000_add_used_in_exodus_flag`, `20260827000000_add_poaform_seq` — sudah diterapkan; tidak ada migration DB untuk poin ini)

```prisma
model PoaDoctorApproval {
  // ...field existing tidak berubah...

  usedInExodus   Boolean   @default(false)
  usedInExodusAt DateTime?
}

model PoaForm {
  // ...field existing tidak berubah...

  seq Int @unique @default(autoincrement())
}
```

```typescript
// src/lib/exodusApi.ts — bukan migration DB, cuma field baru di interface TS
// yang sudah ada (LivePricing), tidak ada penyimpanan tambahan di Product.
export interface LivePricing {
  hna: number;
  nilaiRPersen: number | null; // sudah ada
  rValue: number | null;       // BARU 2026-08-27 — raw Rupiah, API's r_value
}
```

## Data baru (DRAFT — belum ada migration, menunggu jawaban Open Questions blocking di `01-business-rules.md` §9)

Diusulkan untuk revisi 2026-09-01 (§9 di `01-business-rules.md`) — Juni Pharos mengonfirmasi kebutuhan tracking nomor pengajuan Exodus + status (`PENGAJUAN`/`APPROVED`), bukan cuma boolean `usedInExodus`.

```prisma
enum ExodusUsageStatus {
  PENGAJUAN
  APPROVED
}

model PoaDoctorApproval {
  // ...field existing tidak berubah, termasuk usedInExodus/usedInExodusAt di atas...

  exodusStatus         ExodusUsageStatus? // null = belum pernah di-PATCH status baru ini
  exodusNomorPengajuan String?
  exodusStatusAt       DateTime?          // kapan exodusStatus terakhir berubah
}
```

### Catatan desain (draft, field baru §9)

- **Use case dikonfirmasi 2026-09-01**: BUKAN kebutuhan Exodus, tapi POA sendiri yang mau menampilkan nomor pengajuan + status di halaman detail POA (`/poa/[id]`, per baris dokter — lihat `01-business-rules.md` §9 "Klarifikasi"). Exodus cuma jadi sumber datanya lewat PATCH.
- **`usedInExodus` (boolean, existing) TIDAK dihapus, TIDAK digantikan** — **settled 2026-09-01**: ketiga field (`usedInExodus`, `exodusStatus`, `exodusNomorPengajuan`) independen, masing-masing di-update lewat PATCH partial (lihat "Keputusan: PATCH bersifat partial" di `01-business-rules.md` §9). `usedInExodus` tetap jadi sumber kebenaran untuk filter list (`01-business-rules.md` §4).
- **`exodusStatus` nullable, bukan default `PENGAJUAN`** — null secara eksplisit berarti "belum pernah dikirim status oleh Exodus", beda makna dari `PENGAJUAN` (sudah dikirim, masih proses). Sama pola null-vs-nol dengan field `estimasi*` di `docs/poa-standarisasi/02-data-model.md`.
- **`exodusNomorPengajuan` string bebas, tidak divalidasi format** — POA cuma menyimpan apa yang dikirim Exodus apa adanya (lihat Open Question #3 di `01-business-rules.md` §9, masih perlu dikonfirmasi apakah ada pola tertentu).
- **PATCH partial per-field** — server-side, tiap field (`usedInExodus`/`exodusStatus`/`exodusNomorPengajuan`) di body yang HADIR di-update; field yang tidak dikirim TIDAK disentuh/di-null-kan. Konsekuensi: `exodusNomorPengajuan` yang dikirim sekali di awal (submit) TETAP tersimpan melewati PATCH-PATCH berikutnya yang cuma mengirim `exodusStatus` untuk transisi.
- **BELUM ditentukan**: apakah `PENGAJUAN` wajib mendahului `APPROVED` (validasi urutan status — Open Question #2, masih didiskusikan Aldi), apakah `exodusStatus`/`exodusNomorPengajuan` ikut dikosongkan saat revert `usedInExodus: false` (Open Question #5). Sampai dijawab, skema ini adalah draft, bukan final.
- **Migration BELUM dibuat** — menunggu convergence check (terutama Open Question #2 di `01-business-rules.md` §9) sebelum `prisma migrate dev` dijalankan, mengikuti alur SDD (`docs/sdd/01-when-and-workflow.md` langkah 2).

### Catatan desain

- **Boolean, bukan enum tri-state** — draf awal dokumen ini mengusulkan enum (`NOT_USED`/`SUBMITTED`/`APPROVED`) untuk mendukung 2 checkpoint (submit + approve di Exodus). Ditinjau ulang (`01-business-rules.md` §Open questions #4): kutipan bisnis asli hanya menuntut SATU titik kunci ("sekali diajukan tidak bisa dipakai lagi"), jadi boolean sudah cukup dan lebih sederhana. Meeting lanjutan 2026-08-27 (`01-business-rules.md` §7) juga tidak lagi menyebut 2 checkpoint — dianggap CLOSED.
- **`usedInExodusAt` hanya di-set sekali** (endpoint PATCH tidak menimpanya kalau `usedInExodus` sudah `true` — lihat `src/app/api/poa-doctors/[id]/route.ts`), dipakai sebagai "kapan dokter ini pertama kali terkunci dari POA lain".
- **Append-only per row** — field ini TIDAK PERNAH di-reset ke `false` oleh kode manapun (lihat aturan bisnis §2 di `01-business-rules.md`). Invariant: begitu `usedInExodus = true`, tetap begitu selamanya untuk baris `PoaDoctorApproval` itu. Tidak ada endpoint/action di codebase yang menulis `usedInExodus: false` setelah baris dibuat (default `false` cuma berlaku saat `create`).
- **Bukan model company-wide/berat** — field ini dibaca/ditulis per baris tunggal (lookup via unique key), bukan query agregat lintas-company, jadi tidak menyentuh constraint `docs/PERFORMANCE.md`.
- **`PoaForm.seq` — Postgres native autoincrement, bukan aplikasi-level counter** — dipilih supaya tidak ada race condition antar-request yang membuat POA bersamaan (dua `INSERT` konkuren tidak akan pernah dapat nomor yang sama, dijamin oleh sequence di level DB, beda dengan pola "`SELECT MAX(seq)+1`" yang rawan race). **Global, tidak pernah reset per periode/kuartal** — dikonfirmasi user 2026-08-26. Migration `20260827000000_add_poaform_seq` membackfill baris existing dalam urutan `createdAt ASC, id ASC` (pakai `ROW_NUMBER() OVER (...)`, bukan urutan fisik row di tabel) supaya angkanya tetap punya arti historis untuk data lama.
- **`idPoa` (format tampilan "POA0001") dihitung di application layer** (`formatPoaId()` di `poaDoctorsRows.ts`), bukan disimpan sebagai string terpisah di DB — `seq` (integer) adalah satu-satunya sumber kebenaran, string "POA0001" murni presentasi, padStart 4 digit adalah MINIMUM bukan hard cap (seq 12345 → "POA12345").
- **`nilaiR` (response) vs `pengaliNilaiR` vs `Product.nilaiRPersen` vs `PoaLineItem.nilaiR` (kolom mati) — EMPAT hal berbeda, jangan disamakan.** Response `nilaiR` = angka **Rupiah** (bukan rasio), live dari Exodus core products API's `r_value` (`getLiveProductPricing().rValue`), fallback rekonstruksi `nilaiRPersen(db) × hna(db)` kalau live API tidak tersedia. `pengaliNilaiR` = multiplier formula (`nilaiPssp = estimasi × persenPsspDokter × pengaliNilaiR`), tidak terkait. `Product.nilaiRPersen` = rasio (`r_value ÷ hna`), yang ditampilkan UI app sebagai persentase — BUKAN yang dikembalikan di response ini (dicoba dulu 2026-08-27, ditolak user: "kok masih persen"). `PoaLineItem.nilaiR` = kolom DB yang ADA tapi tidak pernah dipakai kode manapun — percobaan pertama yang salah (lihat §7 poin 4 di `01-business-rules.md` untuk kronologi lengkap 2 kali koreksi).
- **`hna` dari `Product`, bukan dari `PoaLineItem.hargaSatuanTerkecil`** — sempat jadi kandidat keliru karena namanya mirip ("Harga Satuan Terkecil"). `hargaSatuanTerkecil` adalah kolom "formula placeholder" yang nullable dan sering kosong (computed externally, lihat komentar schema di `PoaLineItem`), BUKAN harga jual resmi. `Product.hna` adalah master data HNA per SJ yang sebenarnya, yang justru originnya dari Exodus sendiri (lihat `src/lib/exodusApi.ts` komentar "hna itu basically sell_price") — jadi endpoint ini sekadar meng-echo balik apa yang POA simpan dari sync terakhir, bukan sumber kebenaran baru.
- **`qtyPerBulan`/`qtyTotal` satuannya SJ, bukan ST** (dikonfirmasi user 2026-08-27) — karena `hna` yang jadi pembagi adalah harga per SJ. Konversi ke ST butuh `Product.konversiPembagi` (field yang sudah ada, dipakai di `hargaST.ts` untuk arah sebaliknya: `hargaPerST = hnaPerSJ / konversiPembagi`) — TIDAK diimplementasikan, dikonfirmasi tidak perlu untuk kebutuhan ini.
