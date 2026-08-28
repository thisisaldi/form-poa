# Fitur Survey Pasien: Upload Data Survey & Warning Outlet Kosong — Spec Index

*(Ditulis 2026-08-10, mengikuti proses di `docs/sdd/`. Sumber requirement: daftar 13 task baru dari pengguna, item #10 — "Penambahan Fitur / Function Form Input Data Survey" — dan item #12 — "Warning/Alert Data Survey Outlet Kosong". Keduanya digabung satu spec karena sama-sama domain "survey".)*

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — fakta fitur survey yang SUDAH ada (penting supaya tidak salah asumsi ini "belum ada sama sekali"), requirement final item #10 (upload Excel ke Google Drive), format nama file, dan open question item #12 yang masih blocking.
2. [`02-data-model.md`](./02-data-model.md) — model baru `SurveyUploadLog` (audit trail upload), env var kredensial Google Drive.
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — halaman baru "Input Data Survey", lokasi UI existing sebagai konteks, role/akses, non-goals.

## Status

🟢 **Tab "Data Survey" di `/summary` — IMPLEMENTED 2026-08-24** (`src/app/(app)/summary/page.tsx`, komponen `src/components/poa/SurveyDataSummaryTable.tsx`). Requirement dari pengguna langsung (bukan memo), diklarifikasi 2 putaran karena awalnya ambigu:
- **"Data survey yang existing di per outlet"** — dikonfirmasi pengguna ini adalah `SurveyRekomendasi` (survey ketiga di atas literally salah baca — bukan konsep baru, cuma penyebutan ulang model yang sudah ada, yang sama dipakai panel "Data Survey" saat input POA estimasi). Digabung dengan `SurveyUploadLog` (upload web) sebagai 2 sumber yang sama-sama dihitung — satu outlet dianggap "ada data survey" kalau muncul di SALAH SATU dari kedua tabel ini.
- **Target = 3** — per ASM, **ALL-TIME** (bukan per-kuartal seperti tab lain di halaman ini), dihitung sebagai jumlah OUTLET DISTINCT (bukan jumlah baris survey) di antara seluruh outlet yang dipegang MR di bawah ASM tersebut yang punya minimal satu baris survey (dari sumber manapun). "Tercapai" = ≥3 outlet.
- Baris = 1 ASM per baris, scope company-wide untuk ADMIN/GM/SFE/VIEWER, subtree untuk SM/NSM, baris tunggal untuk ASM (lihat diri sendiri saja) — reimplementasi BFS ≤2 query per role, bukan query per-ASM dalam loop (docs/PERFORMANCE.md §2 poin 2/4).
- Tidak ada model Prisma baru — reuse `SurveyUploadLog`/`SurveyRekomendasi` murni, keduanya sudah kodePI-keyed.

**Revisi 2026-08-26, ronde 1 (setelah feedback pengguna)**:
1. **4 section bertumpuk**: Total → Per NSM → Per SM → Per ASM (bukan cuma ASM).
2. **Scope dipersempit ke populasi Ethical/Hospital saja** (`User.project === null`) — sebelumnya ikut menghitung populasi OMEGA (Sales Counter), yang tidak relevan sama sekali untuk survey/outlet Hospital. Diverifikasi: `project === null` adalah representasi in-app dari "Ethical" (nama project di Nexus API untuk populasi Hospital yang sama — lihat `src/lib/sync/orgStructureSync.ts`), sedangkan `project === "OMEGA"` adalah populasi Sales Counter/apotek yang terpisah sepenuhnya. Filter ini diterapkan di query ASM/SM/NSM dan di edge MR→ASM (`mrsByAsm`), pola yang sama dengan `dashboard/page.tsx`/`Sidebar.tsx`.
3. **Filter kuartal disembunyikan khusus di tab ini** — tab ini ALL-TIME, menampilkan filter kuartal akan menyiratkan seolah memengaruhi angkanya (tidak pernah).
4. **Performa** — tab sekarang early-return sebelum menyentuh `poas`/`lineItems`/PSSP/sales/Nexus sama sekali (sebelumnya ikut menanggung biaya query berat yang di-generalize ke semua tab pada redesign 2026-08-07, meskipun tidak dipakai) — laporan pengguna: "berat banget untuk buka tab data survey".

**Revisi 2026-08-26, ronde 2 (koreksi atas ronde 1)**: target=3 outlet TERNYATA **ada juga di level NSM/SM/Total**, bukan cuma ASM — pengguna mengoreksi: "tinggal di sum if aja yang di bawahnya". Target NSM/SM/Total sekarang = `SURVEY_TARGET_OUTLETS × jumlah ASM di bawahnya`, dan **Achievement% pakai formula yang SAMA di semua level** (`outletsWithSurvey / target × 100`, uncapped) — formula "% ASM yang mencapai target sendiri-sendiri" dari ronde 1 sudah tidak dipakai. Sekaligus ditemukan & diperbaiki bug terkait: `outletsWithSurvey` di level rollup sebelumnya dijumlah per-ASM tanpa dedup, sementara `totalOutlets` sudah dedup lewat `Set` — outlet yang dipegang lebih dari satu ASM (outlet SHADOW-pair bisa punya beberapa MR holder) berisiko dihitung dobel di `outletsWithSurvey` tapi tidak di `totalOutlets`. Ditambahkan juga sorting per-kolom per-section (`SortableTh`, sama komponen yang dipakai `KpiTable.tsx`).

**Revisi 2026-08-26, ronde 3**: baris **Total** sekarang juga menghitung outlet yang punya data survey (`SurveyUploadLog`/`SurveyRekomendasi`) tapi **tidak ada di `MrOutletAssignment` sama sekali** — pengguna: "ada data survey yang ada di outlet yang ga masuk struktur". Outlet semacam ini tidak bisa diatribusikan ke ASM/SM/NSM manapun (tidak ada yang memegangnya), jadi cuma muncul di baris Total, dan **hanya ditambahkan kalau viewer sudah company-wide** (ADMIN/GM/SFE/VIEWER) — Total milik SM/NSM/ASM tetap berarti subtree mereka sendiri, outlet tak-terstruktur bukan bagian dari subtree siapapun sehingga tidak pantas "bocor" masuk ke Total seorang SM/NSM/ASM. Query `SurveyUploadLog`/`SurveyRekomendasi` yang sebelumnya di-scope ke outlet dalam struktur sekarang unscoped (company-wide) supaya outlet tak-terstruktur ini bisa dideteksi.

🟢 **Item #18 (docs/TODO.md) — perluasan Input Data Survey, IMPLEMENTED 2026-08-13.** Menambah ke form/endpoint upload yang sudah ada (item #10 di bawah): field **Biaya Data** (Rupiah, opsional), **Sumber** (dropdown, opsional — whitelist di `src/lib/surveySumber.ts`, dikonfirmasi pengguna 2026-08-13: Programmer/IT, Apoteker, Bagian Pembelian/Pengadaan, Bagian Gudang, Tukang Amprah, Komputer Dokter/Perawat, Perawat, Sales Farmasi Lain, Lainnya — semua "(Internal RS)"/"(Eksternal RS)" sesuai request asli), dan **support format file ZIP** (selain .xlsx/.xls yang sudah ada). Kedua field baru disimpan di `SurveyUploadLog.biayaData`/`.sumber` (nullable, non-breaking terhadap row lama). UI dipercantik mengikuti pola form POA: outlet pakai `Combobox` searchable (sama komponen yang dipakai picker produk/customer di POA), Biaya Data pakai input dengan unit "Rp" (pola sama seperti `UnitInput` di `LineItemEditor.tsx`).

🟡 **Item #10 sudah RESOLVED (2026-08-10) — siap diimplementasikan.** Awalnya sangat ambigu (app sudah punya 2 fitur "survey" berbeda: `surveyPasienHarian` dan `SurveyRekomendasi`), tapi pengguna mengonfirmasi ini genuinely fitur baru ketiga: **MR upload file Excel, diteruskan ke shared drive (Google Drive) via service account**, dengan audit trail di database dan format nama file yang sudah ditentukan (`01-business-rules.md` §3a). Ini infrastruktur yang **genuinely belum ada sama sekali** di codebase (belum ada dependency Google API, belum ada endpoint upload file apapun) — lihat detail di `01-business-rules.md` §2.

✅ **Update 2026-08-27**: kredensial sudah disiapkan dan feature genuinely berfungsi di staging. `GOOGLE_SERVICE_ACCOUNT_KEY` tetap env var (raw JSON, bukan base64 — lihat `02-data-model.md`), tapi folder tujuan upload sekarang ADMIN-settable dari halaman Admin (tabel `GoogleDriveConfig`), bukan env var `GOOGLE_DRIVE_SURVEY_FOLDER_ID` lagi (dihapus).

⬜ **Item #12 (warning outlet kosong) masih BUTUH KONFIRMASI** — definisi "kosong" belum jelas (3 kandidat interpretasi, lihat `01-business-rules.md` §4), dan sedikit terkait item #10 (kalau "kosong" ternyata merujuk ke belum-ada-upload-survey-Excel, bukan `surveyPasienHarian`).

## Ringkasan

Riset kode (2026-08-10) menemukan app ini **sudah punya 2 konsep "survey" yang terpisah** sebelum task ini:
1. **`surveyPasienHarian`** (`PoaLineItem`, wajib diisi) — MR input manual jumlah pasien survey harian per dokter, dipakai di alur input POA (`LineItemEditor.tsx`).
2. **`SurveyRekomendasi`** — data kompetitor produk per dokter×outlet, diimpor dari Excel via script CLI, dipakai untuk auto-suggest "Produk Kompetitor". Tidak ada input manual dari UI.

**Item #10 dikonfirmasi sebagai konsep survey KETIGA**, genuinely baru dan sederhana secara scope fungsional (tidak ada parsing isi Excel, app cuma jadi perantara upload) tapi besar secara infrastruktur (integrasi Google Drive API + service account dari nol). MR mengisi Nama RS + Periode, pilih file Excel, submit — file diberi nama `[YYYYMMDDHHMM] - Data Survey [Nama RS] Periode [Periode] oleh [Pengaju]` dan diupload ke folder shared drive tertentu, dicatat di model baru `SurveyUploadLog` untuk audit trail.
