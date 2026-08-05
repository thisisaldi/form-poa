# Form POA — Spec Index (Retroactive)

*(Ditulis 2026-08-05, mengikuti proses di `docs/sdd/`. Ini spec RETROAKTIF — sistemnya udah dibangun dan jalan di production, dokumen ini nyusul buat ngedokumentasiin apa yang ADA sekarang, bukan proposal fitur baru. Ditulis dari riset kode langsung (4 agent paralel, semua klaim ada file:line-nya di 3 dokumen berikutnya), bukan dari ingatan/asumsi.)*

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — lifecycle POA (state machine approval), struktur line item, formula inti (Estimasi/Nilai PSSP/Budget/Tercacah/Growth), sistem quarter/periode, klasifikasi dokter (Dokter Baru/Pernah PSSP/Retensi), konsep PSSP.
2. [`02-data-model.md`](./02-data-model.md) — inventori penuh skema Prisma per domain, model User/Role, sumber data tiap model (sync MSSQL/Excel/manual UI/API eksternal).
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — resolusi hierarki organisasi & role/access matrix (`authz.ts`), inventori halaman + nav, detail halaman Summary/Dashboard/Monitoring, Excel export, integrasi eksternal (Nexus/Exodus), maintenance mode.

## Status

🟢 **Live di production** — ini bukan v1-yang-lagi-dibangun, ini dokumentasi dari sistem yang udah berjalan penuh dan dipakai sehari-hari. Detail per area (mana yang udah settled vs mana yang masih ada catatan "belum jelas"/"legacy tapi dipertahankan") ada di masing-masing dokumen — dokumen ini gak mengasumsikan semuanya rapi, beberapa bagian sistem punya nuance/legacy behavior yang sengaja dicatat apa adanya.

Spec terpisah yang udah ada duluan dan TIDAK di-re-dokumentasiin di sini (baca sendiri): **`docs/kpi-monitoring/`** (KPI Monitoring / Monitoring KPI Perpanjangan — model `KpiMonthlyEntry`/`KpiContractEvaluation`, ADMIN-only v1).

## Ringkasan cepat

**Form POA** adalah sistem perencanaan penjualan (sales planning) buat tim sales  Pharos — MR (Medical Representative) bikin **POA** (rencana per kuartal) berisi rencana kunjungan & PSSP (program standarisasi) per dokter per produk, lalu POA itu di-approve berjenjang (ASM → SM → NSM). Sistem juga nyediain analytics (Summary, Monitoring, PM Dashboard), export Excel, dan sinkronisasi data dari MSSQL (`mkt_insight`) + beberapa API eksternal (Nexus buat pencarian customer live, Exodus Activity buat histori kunjungan).

Konsep inti yang paling sering muncul di seluruh sistem: **Estimasi** (rencana biaya), **Nilai PSSP** (`Estimasi × %PSSP × Pengali Nilai R`), **Tercacah** (apportionment bulanan/kuartalan dari rencana yang gak selalu pas 1 kuartal), dan **Lock Edit Logic** (begitu atasan approve/edit, level di bawahnya kekunci sampai siklus REVISI baru).

## Cara pakai dokumen ini

Kalau kamu (developer/Claude session berikutnya) mau ngerti bagian tertentu dari sistem sebelum ngoding — baca dokumen yang relevan dulu di atas, jangan langsung nebak dari nama variabel/komponen. Kalau nemuin sesuatu yang berubah dari yang tercatat di sini, **update dokumennya juga**, jangan biarin dokumen nyimpang dari kode aktual (prinsip yang sama kayak `docs/PERFORMANCE.md` §6 dan `docs/sdd/`).
