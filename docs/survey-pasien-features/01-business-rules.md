# Fitur Survey Pasien — Business Rules

Requirement asli: lihat `README.md` §Sumber requirement.

## 1. Fitur survey yang SUDAH ADA (penting dibaca sebelum menilai item #10 sebagai "belum ada")

### 1a. `surveyPasienHarian` — input manual MR, per dokter

- Field: `PoaLineItem.surveyPasienHarian Int @default(0)` (`prisma/schema.prisma:324`).
- UI: `DokterFieldsSection` di `LineItemEditor.tsx:549-656` — input `UnitInput` label "Survey Pasien Harian", unit "Pasien", **wajib diisi** (`<Req/>`, validasi di `handleSubmit` baris `:2707` dan `:3819`).
- Berlaku per-dokter (bukan per-produk) — nilai yang sama diduplikasi ke semua baris produk milik dokter itu dalam satu POA, pola yang sama dengan `hariKerjaBulan`/`rencanaVisitMinggu`.
- Echo di dalam `ProdukEntryRow` (`LineItemEditor.tsx:~1110-1123`): "Survey Pasien Per Hari = {n} orang", tampil di bawah input "Pasien Baru / Hari" (`jumlahResepHari`). Heading "Referensi PM" yang tadinya menaungi echo ini sudah dihapus (commit `b8ab508`, 2026-08-10) — echo sekarang tampil tanpa heading pembungkus, TAPI heading "Referensi PM" itu sendiri masih ada untuk blok hint LAIN (data referensi `qtyPerRxPasien`/`lamaPemberianHari`/`jumlahPemberianPerHari`, `:1139-1143`) — jangan disalahartikan sebagai dihapus total.
- Tidak ada API route/server action khusus — nilai ini ikut FormData yang sama dengan seluruh line item, submit lewat `src/app/actions/lineItem.ts`.

### 1b. `SurveyRekomendasi` — data referensi kompetitor, import Excel

- Model: `prisma/schema.prisma:242-263` — per kombinasi `kodePI`+`kodeCustomer`+`kodeProduk` (unique), field: nama produk rekomendasi Pharos, `historyProduk` (string mentah "PRODUCT (XX%); PRODUCT (YY%)" — daftar histori kompetitor), `statusSales`/`statusPssp`/`metodePemilihan`/`potensiBulan`.
- Sumber: **import Excel sekali jalan** (`scripts/importSurveyRekomendasi.ts`, file sumber `internal/17062026 Final Combined All Data Survey (2020 - 2026).xlsx`) — **tidak ada form input manual untuk model ini**, murni data referensi read-only dari sisi UI.
- Dipakai: auto-suggest "Produk Kompetitor" via `getKompetitorHistory` (`customer.ts`), disurfacekan di `SurveyDataPanel` (sidebar tab "Data Survey") dan panel "Produk Rekomendasi" → subsection "Produk Survey".
- Known gap tercatat di `docs/TODO.md`: stakeholder pernah minta produk kompetitor jadi tabel terpisah dari produk rekomendasi Pharos — saat ini masih nested sebagai badge di dalam kartu yang sama, belum dipisah.

## 2. Item #10 — "Input Data Survey" ✅ RESOLVED 2026-08-10 (interpretasi C — genuinely baru)

**Dikonfirmasi pengguna**: bukan interpretasi A (field baru di `surveyPasienHarian`) atau B (form CRUD untuk `SurveyRekomendasi`) — ini fitur **genuinely baru dan simpel**: MR upload file Excel dari browser, file-nya diteruskan ke **shared drive** (Google Drive) pakai **service account**. Tidak ada parsing/validasi isi Excel di sisi app — app cuma jadi perantara upload, bukan pemroses data survey-nya.

**Riset kode (2026-08-10)**: ini infrastruktur yang **genuinely BELUM ADA SAMA SEKALI** di app ini:
- Tidak ada `<input type="file">` atau API route yang menerima `multipart/form-data` di manapun — seluruh `FormData` yang ada sekarang cuma membungkus field teks/angka biasa untuk Server Actions, bukan file.
- Tidak ada dependency Google API (`googleapis`, `google-auth-library`, dll) di `package.json` — perlu install baru.
- Tidak ada pola "service account"/kredensial cloud storage di codebase — satu-satunya precedent kredensial eksternal yang mirip adalah `EXODUS_AUTH_*` (client-secret dari Vault, path `env/data/century/form-poa`, tidak pernah di-hardcode) — pola ini yang akan diikuti untuk kredensial Google service account.
- Import Excel yang sudah ada (`scripts/importSurveyRekomendasi.ts` dkk) selalu berupa **file lokal manual + script CLI**, tidak ada satupun jalur upload dari browser atau integrasi cloud storage.

**Keputusan pengguna (via `AskUserQuestion`, 2026-08-10)**:
1. **Kredensial service account**: disiapkan belakangan oleh pengguna/tim ops — spec ditulis dengan asumsi env var placeholder, mengikuti pola `EXODUS_AUTH_*` (dari Vault, bukan hardcode). Implementasi TIDAK diblok menunggu kredensial asli — bisa dikerjakan dengan kredensial dummy/lokal dulu untuk testing, tinggal ganti env var saat deploy.
2. **Audit trail**: PERLU dicatat di database — bukan fire-and-forget murni. Model baru kecil untuk mencatat siapa upload apa kapan (lihat `02-data-model.md`).

## 3. Requirement konkret (v1)

1. **Halaman/komponen baru "Input Data Survey"** — form: pilih file (`.xlsx`/`.xls`), plus **field tambahan yang wajib diisi manual** (dikonfirmasi pengguna 2026-08-10 lewat format nama file, lihat §3a) — **Nama RS/Outlet** dan **Periode**. "Pengaju" TIDAK diinput manual, diambil otomatis dari sesi user yang login (`session.userId` → nama). Tombol "Upload".
2. **API route baru** (mis. `POST /api/survey/upload`) — terima `multipart/form-data` (file + `namaRS`/`kodePI` + `periode`), validasi tipe file (`.xlsx`/`.xls` saja, tolak selain itu) dan ukuran maksimum (lihat Open Questions), lalu forward ke Google Drive lewat service account dengan nama file sesuai format §3a.
3. **Google Drive integration** — file diupload ke **satu folder shared drive tertentu** (folder ID via env var, lihat `02-data-model.md`), pakai Google Drive API v3 `files.create` dengan service account credentials, `name` di-set ke format §3a (BUKAN nama file asli dari komputer MR).
4. **Audit trail** — begitu upload ke Drive berhasil, buat 1 row baru di model `SurveyUploadLog` (lihat `02-data-model.md`): uploader (NIP + nama = "Pengaju"), Nama RS, Periode, nama file final (format §3a), waktu upload (timestamp submit — sumber yang sama dipakai untuk isi `[YYYYMMDDHHMM]` di nama file), ID/link file di Drive (dari response API).
5. **Feedback ke MR** — toast/pesan sukses/gagal yang jelas (bukan cuma redirect diam-diam), sama pola `onToast` yang sudah dipakai di `LineItemEditor.tsx`.

### 3a. Format nama file di Drive — dikonfirmasi pengguna 2026-08-10

```
[YYYYMMDDHHMM] - Data Survey [Nama RS] Periode [Periode] oleh [Pengaju]
```

- **`YYYYMMDDHHMM`** — timestamp **waktu submit** (waktu server menerima upload, bukan waktu file Excel dibuat/diedit MR) — 12 digit, tahun-bulan-tanggal-jam-menit, zero-padded. Sumber waktu: `new Date()` di server saat request diterima (bukan client-side, supaya tidak bisa dipalsukan/beda timezone device MR).
- **`[Nama RS]`** — dari field outlet yang diisi MR di form (kemungkinan reuse `Outlet.namaOutlet` via dropdown/combobox yang sudah ada di app, bukan free-text, supaya penamaan konsisten dan tidak typo).
- **`[Periode]`** — dari field periode yang diisi MR (perlu diputuskan format persis: `YYYYMM` seperti field `period` di `PoaForm`, atau `YYYY-QN` seperti quarter yang dipakai di Ringkasan — lihat OQ-5 di bawah).
- **`[Pengaju]`** — nama user yang login (`session.userId` → `User.name`), bukan input manual.
- Karakter yang berpotensi bermasalah di nama file Drive (mis. `/`) pada `Nama RS`/`Pengaju` perlu di-sanitize sebelum dipakai sebagai nama file — cek saat implementasi, Google Drive umumnya lebih toleran dibanding filesystem lokal tapi tetap perlu jaga-jaga.

## 4. Perilaku kegagalan

- **Upload ke Drive gagal** (network, quota, kredensial invalid) — tampilkan error jelas ke MR ("Upload gagal, coba lagi" atau pesan API kalau ada), **jangan** buat row `SurveyUploadLog` untuk upload yang gagal (row itu cuma untuk yang genuinely sukses tersimpan di Drive).
- **File bukan Excel / kosong / melebihi batas ukuran** — ditolak di sisi client (validasi cepat) DAN di server (jangan percaya validasi client saja, sama prinsip yang dipakai di form-form lain app ini).
- **Service account credential belum dikonfigurasi** (env var kosong di suatu environment, mis. dev lokal) — endpoint upload harus gagal dengan pesan jelas ("Fitur upload survey belum dikonfigurasi"), bukan crash 500 generik.

## 5. Open questions — status & assumptions dipakai untuk v1

Tidak ada lagi open question BLOCKING untuk keputusan besar (interpretasi fitur, kredensial, audit trail — semua sudah dikonfirmasi). Sisa open question murni detail teknis kecil yang bisa diputuskan saat implementasi:

| # | Pertanyaan | Asumsi yang dipakai untuk v1 | Perlu konfirmasi dari |
|---|---|---|---|
| OQ-1 (non-blocking) | Batas ukuran file upload maksimum. | 10 MB (angka wajar untuk file Excel data survey, disesuaikan saat implementasi kalau ternyata file sumber lebih besar). | Pengguna, opsional |
| OQ-2 (non-blocking) | Role yang boleh akses form ini — cuma MR, atau SFE/Admin juga? | Diasumsikan MR (sesuai konteks "MR cuma upload excel saja" di requirement) — role lain bisa ditambah belakangan kalau diminta. | Pengguna |
| OQ-3 (non-blocking) | Struktur folder di shared drive — flat (semua file di 1 folder) atau per-periode/per-MR (subfolder)? | Flat di 1 folder untuk v1 (paling simpel) — folder ID dikonfigurasi via env var. | Pengguna/tim ops, saat setup folder Drive-nya |
| OQ-4 (non-blocking) | Apakah MR bisa lihat riwayat file yang pernah dia upload dari dalam app (baca `SurveyUploadLog`), atau log itu cuma buat keperluan admin/audit? | v1: tampilkan minimal daftar riwayat upload milik MR yang login (read-only, dari `SurveyUploadLog`) — sudah ada modelnya, sayang kalau tidak disurfacekan sama sekali. | Pengguna |
| OQ-5 (non-blocking) | Format persis field "Periode" di §3a — `YYYYMM` (pola `PoaForm.period`) atau `YYYY-QN` (pola quarter di Ringkasan)? | `YYYYMM`, karena survey biasanya per-bulan bukan per-kuartal — disesuaikan saat implementasi kalau ternyata dimaksudkan per-kuartal. | Pengguna |
| OQ-6 (non-blocking) | "Nama RS" di §3a — dropdown terbatas ke outlet yang jadi coverage MR yang login (`outletKodesForMR`, pola yang sudah ada), atau semua outlet? | Dibatasi ke outlet coverage MR yang login — konsisten dengan pola akses outlet di seluruh app (`docs/form-poa/03-ui-and-access.md`). | Pengguna |

## 4. Item #12 — Warning/Alert Data Survey Outlet Kosong

Lebih jelas scope-nya dibanding #10 (jelas "warning/alert" untuk kondisi "kosong"), tapi definisi "kosong" masih perlu diperjelas:

| Kandidat definisi "kosong" | Catatan |
|---|---|
| Outlet belum punya POA sama sekali di periode berjalan | Paling luas — bisa jadi noise kalau banyak outlet genuinely belum waktunya submit. |
| Outlet punya POA, tapi `surveyPasienHarian` beberapa/semua line item-nya masih 0 (default) | Lebih spesifik ke "data survey" seperti nama task — tapi field ini sudah `required`, jadi 0 cuma mungkin terjadi kalau MR belum submit sama sekali. |
| Outlet tidak punya data `SurveyRekomendasi` (belum pernah ter-cover import Excel) | Beda konsep sama sekali dari 2 kandidat di atas — "kosong" di sini berarti data referensi belum ada, bukan input MR yang kosong. |

❓ **Open question BLOCKING**: definisi "kosong" mana yang dimaksud — tergantung jawaban OQ-1 di §3 juga (kalau item #10 ternyata membangun field survey baru, "kosong" di #12 kemungkinan merujuk ke field baru itu, bukan `surveyPasienHarian` yang sudah ada dan sudah wajib).

**Pola visual yang direkomendasikan untuk reuse** (sudah established, bukan komponen baru): warning-banner ⚠ + amber background/text, dipakai 2× di `summary/page.tsx:1719-1722` dan `:1785-1789` untuk kasus "data dummy". Detail styling di `03-ui-and-access.md`.

## Open questions — status & assumptions dipakai untuk v1

*(Ringkasan dari §3 dan §4 di atas — tabel gabungan sesuai format standar template.)*

| # | Pertanyaan | Asumsi yang dipakai untuk v1 | Perlu konfirmasi dari |
|---|---|---|---|
| OQ-1 (BLOCKING) | Item #10 — survey mana yang dimaksud (§2, interpretasi A/B/C). | Tidak ada — blocking penuh. | Pengguna |
| OQ-2 (BLOCKING) | Item #10 — siapa yang input (role). | Tidak ada. | Pengguna |
| OQ-3 (BLOCKING) | Item #10 — field/data apa persisnya. | Tidak ada. | Pengguna |
| OQ-4 (non-blocking, hanya relevan kalau OQ-1 = interpretasi B) | Item #10 — form pengganti atau pelengkap alur Excel `SurveyRekomendasi`. | — | Pengguna |
| OQ-5 (BLOCKING) | Item #12 — definisi "kosong" (3 kandidat di §4). | Tidak ada. | Pengguna |
