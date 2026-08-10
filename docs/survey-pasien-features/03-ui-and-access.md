# Fitur Survey Pasien — UI & Access

## 1. Lokasi existing (konteks, bukan yang diubah)

- `surveyPasienHarian`: `DokterFieldsSection` di `src/components/poa/LineItemEditor.tsx:549-656` — bagian dari form input POA per dokter, halaman edit/tambah line item POA.
- `SurveyRekomendasi`: disurfacekan read-only di `SurveyDataPanel` (sidebar tab "Data Survey") dan panel "Produk Rekomendasi" → "Produk Survey", juga di dalam `LineItemEditor.tsx`.

## 2. Halaman baru — "Input Data Survey" (item #10)

- **Route baru**, mis. `/survey/upload` — form: dropdown "Nama RS" (outlet, dibatasi ke coverage MR yang login — `01-business-rules.md` OQ-6), input "Periode" (`YYYYMM`), file picker (`.xlsx`/`.xls`), tombol submit.
- **Tambahkan ke Sidebar** — entry baru, reuse pola menu item yang sudah ada (lihat sidebar existing untuk "Data Survey" tab di dalam POA — beda konteks, tapi bisa jadi referensi penamaan supaya tidak rancu, mis. label sidebar "Upload Survey" bukan "Data Survey" polos).
- **Riwayat upload** (OQ-4, `01-business-rules.md`) — di bawah/sebelah form, tabel kecil daftar `SurveyUploadLog` milik MR yang login: Nama RS, Periode, waktu upload, link ke file di Drive (`https://drive.google.com/file/d/{driveFileId}/view`).
- **API route baru**: `POST /api/survey/upload` — terima `multipart/form-data`, requires session (reuse `getCurrentUser`/`requireSession` pattern yang sudah ada di seluruh `src/app/actions/`), lihat `01-business-rules.md` §3 untuk alur lengkap.

## 3. Lokasi untuk item #12 (warning outlet kosong)

Kemungkinan besar di tab Ringkasan/Summary (`summary/page.tsx`) — konsisten dengan pola warning-banner yang sudah ada di situ (§4 di bawah), atau di halaman drafting per-outlet (`DraftChecklist.tsx`) kalau maksudnya warning per-POA saat MR sedang menyusun draft. **Belum ditentukan** — tergantung jawaban OQ-5 (`01-business-rules.md` §4) soal definisi "kosong", yang akan menentukan di level apa data itu tersedia untuk dicek (per-outlet company-wide → tab Ringkasan; per-POA MR → halaman drafting).

## 4. Pola visual warning-banner (reuse, bukan komponen baru)

Pola yang sudah dipakai 2× di `summary/page.tsx:1719-1722` dan `:1785-1789` untuk kasus "data dummy":

```
background: "var(--color-warning-bg, #fef3c7)"
color: "var(--color-warning, #92400e)"
prefix: "⚠ "
```

Contoh existing: `⚠ Target per produk memakai data dummy (khusus ADMIN, untuk testing tampilan) — belum ada data Target per produk kontes yang asli.`

Kalau item #12 diimplementasikan, ikuti pola visual yang sama (warna, prefix ⚠, rounded box) supaya konsisten dengan bahasa visual "peringatan" yang sudah dikenal di app ini — bukan bikin gaya warning baru.

## 5. Role & akses

- **Item #10 (upload survey)**: diasumsikan **MR saja** (`01-business-rules.md` OQ-2, sesuai konteks requirement "MR cuma upload excel saja") — role lain (ASM/SM/NSM/ADMIN) tidak melihat halaman ini kecuali diminta belakangan. Dropdown "Nama RS" dibatasi ke outlet coverage MR yang login (reuse `outletKodesForMR`/pola yang sama dengan pembatasan outlet di seluruh app, `docs/form-poa/03-ui-and-access.md`).
- **Item #12 (warning outlet kosong)**: **Belum ditentukan** — tergantung lokasi tampilan (§3 di atas): kalau di tab Ringkasan berarti role company-wide (ADMIN/NSM/dst, sama gate `/summary` yang sudah ada), kalau di halaman drafting berarti MR pemilik POA.

## 6. Non-goals v1

- **Item #10**: tidak ada parsing/validasi ISI file Excel di sisi app — app murni jadi perantara upload ke Drive, tidak membaca/memproses data survey di dalam file (beda total dari `SurveyRekomendasi` yang di-import DAN diparse ke database). Kalau nanti dibutuhkan data survey ini benar-benar masuk ke database (bukan cuma tersimpan sebagai file), itu scope terpisah yang jauh lebih besar (parsing Excel dinamis, validasi struktur kolom, dll) — tidak diasumsikan sebagai bagian v1 ini.
- **Item #10**: tidak menambah role baru — kalau nanti butuh SFE/Admin juga bisa upload, itu keputusan terpisah.
- **Item #10**: tidak membangun UI untuk EDIT/DELETE `SurveyUploadLog` — v1 cuma create (upload) + read (riwayat), append-only sesuai invariant di `02-data-model.md`.
- **Item #12**: tidak dibangun sebelum OQ-5 (`01-business-rules.md` §4) dijawab — definisi "kosong" menentukan lokasi & sumber data yang berbeda total.
- **Tidak mengubah alur import Excel `SurveyRekomendasi`** (`scripts/importSurveyRekomendasi.ts`) — genuinely fitur terpisah dari item #10, tidak tersentuh sama sekali.
