# Fitur Survey Pasien: Upload Data Survey & Warning Outlet Kosong — Spec Index

*(Ditulis 2026-08-10, mengikuti proses di `docs/sdd/`. Sumber requirement: daftar 13 task baru dari pengguna, item #10 — "Penambahan Fitur / Function Form Input Data Survey" — dan item #12 — "Warning/Alert Data Survey Outlet Kosong". Keduanya digabung satu spec karena sama-sama domain "survey".)*

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — fakta fitur survey yang SUDAH ada (penting supaya tidak salah asumsi ini "belum ada sama sekali"), requirement final item #10 (upload Excel ke Google Drive), format nama file, dan open question item #12 yang masih blocking.
2. [`02-data-model.md`](./02-data-model.md) — model baru `SurveyUploadLog` (audit trail upload), env var kredensial Google Drive.
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — halaman baru "Input Data Survey", lokasi UI existing sebagai konteks, role/akses, non-goals.

## Status

🟢 **Item #18 (docs/TODO.md) — perluasan Input Data Survey, IMPLEMENTED 2026-08-13.** Menambah ke form/endpoint upload yang sudah ada (item #10 di bawah): field **Biaya Data** (Rupiah, opsional), **Sumber** (dropdown, opsional — whitelist di `src/lib/surveySumber.ts`, dikonfirmasi pengguna 2026-08-13: Programmer/IT, Apoteker, Bagian Pembelian/Pengadaan, Bagian Gudang, Tukang Amprah, Komputer Dokter/Perawat, Perawat, Sales Farmasi Lain, Lainnya — semua "(Internal RS)"/"(Eksternal RS)" sesuai request asli), dan **support format file ZIP** (selain .xlsx/.xls yang sudah ada). Kedua field baru disimpan di `SurveyUploadLog.biayaData`/`.sumber` (nullable, non-breaking terhadap row lama). UI dipercantik mengikuti pola form POA: outlet pakai `Combobox` searchable (sama komponen yang dipakai picker produk/customer di POA), Biaya Data pakai input dengan unit "Rp" (pola sama seperti `UnitInput` di `LineItemEditor.tsx`).

🟡 **Item #10 sudah RESOLVED (2026-08-10) — siap diimplementasikan.** Awalnya sangat ambigu (app sudah punya 2 fitur "survey" berbeda: `surveyPasienHarian` dan `SurveyRekomendasi`), tapi pengguna mengonfirmasi ini genuinely fitur baru ketiga: **MR upload file Excel, diteruskan ke shared drive (Google Drive) via service account**, dengan audit trail di database dan format nama file yang sudah ditentukan (`01-business-rules.md` §3a). Ini infrastruktur yang **genuinely belum ada sama sekali** di codebase (belum ada dependency Google API, belum ada endpoint upload file apapun) — lihat detail di `01-business-rules.md` §2.

⚠️ **Kredensial service account Google Drive belum disiapkan** — pengguna akan menyiapkan belakangan, implementasi jalan dengan env var placeholder dulu (`GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_DRIVE_SURVEY_FOLDER_ID`, lihat `02-data-model.md`) — tidak blocking untuk mulai coding, tapi fitur tidak akan genuinely berfungsi sampai kredensial asli diisi di environment yang sesuai.

⬜ **Item #12 (warning outlet kosong) masih BUTUH KONFIRMASI** — definisi "kosong" belum jelas (3 kandidat interpretasi, lihat `01-business-rules.md` §4), dan sedikit terkait item #10 (kalau "kosong" ternyata merujuk ke belum-ada-upload-survey-Excel, bukan `surveyPasienHarian`).

## Ringkasan

Riset kode (2026-08-10) menemukan app ini **sudah punya 2 konsep "survey" yang terpisah** sebelum task ini:
1. **`surveyPasienHarian`** (`PoaLineItem`, wajib diisi) — MR input manual jumlah pasien survey harian per dokter, dipakai di alur input POA (`LineItemEditor.tsx`).
2. **`SurveyRekomendasi`** — data kompetitor produk per dokter×outlet, diimpor dari Excel via script CLI, dipakai untuk auto-suggest "Produk Kompetitor". Tidak ada input manual dari UI.

**Item #10 dikonfirmasi sebagai konsep survey KETIGA**, genuinely baru dan sederhana secara scope fungsional (tidak ada parsing isi Excel, app cuma jadi perantara upload) tapi besar secara infrastruktur (integrasi Google Drive API + service account dari nol). MR mengisi Nama RS + Periode, pilih file Excel, submit — file diberi nama `[YYYYMMDDHHMM] - Data Survey [Nama RS] Periode [Periode] oleh [Pengaju]` dan diupload ke folder shared drive tertentu, dicatat di model baru `SurveyUploadLog` untuk audit trail.
