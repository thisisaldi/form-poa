# MCL — Rekomendasi Dokter & Indikator Standarisasi dari Excel Internal — Spec Index

*(Ditulis 2026-10-15, mengikuti proses Spec-Driven Development di `docs/sdd/`. Sumber requirement: (1) memo rapat Pak Brian & Pak Arthur dengan Tim Sales Hospital — diteruskan pengguna [m.naufaldi.aldi@gmail.com], tanggal rapat tidak tertera ("kemarin malam"); (2) percakapan dengan Clara (Pharos) 2026-10-13 yang mengklarifikasi bahwa "MCL" = rekomendasi dari file Excel internal `internal/data Rekomendasi dokter Per Hospital dan per Spesialist.xlsx`; (3) keputusan pengguna 2026-10-14/15 bahwa indikator "sudah listing/standarisasi" bersumber utama dari Excel, bukan dari sales 3 bulan + DPL.)*

Trigger SDD yang terpenuhi (`docs/sdd/01-when-and-workflow.md`): sumber dari dokumen/percakapan eksternal, model data baru (tabel hasil import Excel), perubahan definisi bisnis yang sudah ada (indikator "sudah standarisasi" per 2026-10-01), dan ambiguitas nyata yang tercatat di `01-business-rules.md` §6.

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — definisi MCL, isi Excel, aturan indikator, hasil pengukuran matching, open questions.
2. [`02-data-model.md`](./02-data-model.md) — tabel baru hasil import, algoritma matching nama, invariant, performa.
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — titik integrasi di POA Standarisasi, akses, non-goals.

## Status

⬜ **Spesifikasi draft — belum ada kode implementasi.** Tidak ada tabel/script MCL di `prisma/schema.prisma` maupun `scripts/` saat ini (kata "MCL" tidak muncul di kode/docs sebelum dokumen ini).

⚠️ **Asumsi kerja (bukan konfirmasi stakeholder)** — ditandai juga di tempatnya masing-masing:
- Excel = sumber **utama** indikator listing; pengajuan final-submit di app hanya melengkapi satu arah (belum→sudah) karena file tidak akan diperbarui. Ini tafsiran atas "excel sebagai utamanya" (pengguna 2026-10-15) — lihat §6 Q1.
- Tiga status Excel selain `SUDAH LISTING` diperlakukan sebagai "belum" (§6 Q3).
- Fitur dari memo awal (note atasan→bawahan, list prioritas yang diarahkan atasan, "geser ke database lain") **tidak masuk v1** — pengguna menunda ("untuk mcl nanti dulu"), dan penjelasan Clara tidak menyebutnya (§6 Q5).

**Update 2026-10-15 (pengguna):** (a) file Excel itu **satu-satunya dan tidak akan ada versi baru** — import sekali, tidak ada siklus refresh (menjawab Q2); (b) MCL dipakai di **POA Estimasi dan POA Standarisasi**, bukan hanya Standarisasi.

## Ringkasan

MCL bukan sistem baru yang berdiri sendiri: ia adalah **lapisan rekomendasi di atas POA Estimasi dan POA Standarisasi** yang bersumber dari file Excel internal (satu file, diimport sekali). File itu berisi (a) status listing produk per outlet — dipakai sebagai indikator "sudah standarisasi" — dan (b) daftar dokter spesialis per outlet beserta produk yang direkomendasikan. Matching dokter Excel ke database dokter app diukur **61,2%** (6.297 dokter unik; sisa 38,8% tidak ada di sumber Exodus mana pun) sehingga baris Excel disimpan apa adanya dan `customerId` hanya diisi bila match yakin. Indikator standarisasi tidak butuh matching nama karena kuncinya `KODE PI` + `KODE PRODUK` (cocok 100%).

Cross-reference: `docs/poa-standarisasi/01-business-rules.md` §2 (definisi "sudah standarisasi" 2026-10-01 yang akan digantikan), `docs/PERFORMANCE.md` (321 ribu baris sumber → wajib agregat per outlet).
