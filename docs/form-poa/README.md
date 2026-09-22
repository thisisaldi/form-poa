# Form POA — Spec Index (Retroactive)

*(Ditulis 2026-08-05, mengikuti proses di `docs/sdd/`. Ini adalah spesifikasi RETROAKTIF — sistemnya sudah dibangun dan berjalan di production, dokumen ini disusun untuk mendokumentasikan apa yang ADA saat ini, bukan proposal fitur baru. Ditulis berdasarkan riset kode langsung (4 agent paralel, setiap klaim memiliki referensi file:line di tiga dokumen berikutnya), bukan dari ingatan atau asumsi.)*

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — lifecycle POA (state machine approval), struktur line item, formula inti (Estimasi/Nilai PSSP/Budget/Tercacah/Growth), sistem quarter/periode, klasifikasi dokter (Dokter Baru/Pernah PSSP/Retensi), konsep PSSP.
2. [`02-data-model.md`](./02-data-model.md) — inventori penuh skema Prisma per domain, model User/Role, sumber data tiap model (sinkronisasi MSSQL/Excel/manual UI/API eksternal).
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — resolusi hierarki organisasi & role/access matrix (`authz.ts`), inventori halaman + navigasi, detail halaman Summary/Dashboard/Monitoring, Excel export, integrasi eksternal (Nexus/Exodus), maintenance mode.

## Status

🟢 **Live di production** — dokumen ini bukan mendeskripsikan v1 yang sedang dibangun, melainkan dokumentasi dari sistem yang sudah berjalan penuh dan digunakan sehari-hari. Detail per area (mana yang sudah settled versus mana yang masih memiliki catatan "belum jelas"/"legacy tapi dipertahankan") tercantum di masing-masing dokumen — dokumen ini tidak mengasumsikan seluruh sistem rapi; beberapa bagian memiliki nuansa/legacy behavior yang sengaja dicatat apa adanya.

Spesifikasi terpisah yang sudah ada sebelumnya dan TIDAK didokumentasikan ulang di sini (baca langsung): **`docs/kpi-monitoring/`** (KPI Monitoring / Monitoring KPI Perpanjangan — model `KpiMonthlyEntry`/`KpiContractEvaluation`, ADMIN-only v1).

## Ringkasan cepat

**Form POA** adalah sistem perencanaan penjualan (sales planning) untuk tim sales Pharos — MR (Medical Representative) menyusun **POA** (rencana per kuartal) berisi rencana kunjungan & PSSP (program standarisasi) per dokter per produk, kemudian POA tersebut disetujui secara berjenjang PER DOKTER (`docs/poa-per-doctor-approval/`, bukan whole-draft lagi sejak 2026-08-13). Rantai default ASM → SM → NSM, tapi bisa lanjut ke ASD (GM) → SD kalau ceiling dari Exodus (`GET /promotion/v1/pssp/approval-level`) memintanya — dan sejak **2026-09-22** ceiling itu juga bisa berhenti lebih awal di ASM atau SM saja, bukan dipaksa minimal NSM (lihat `docs/exodus-poa-usage/`). Sistem juga menyediakan analytics (Summary, Monitoring, PM Dashboard), export Excel, dan sinkronisasi data dari MSSQL (`mkt_insight`) serta beberapa API eksternal (Nexus untuk pencarian customer secara live, Exodus Activity untuk histori kunjungan).

Konsep inti yang paling sering muncul di seluruh sistem: **Estimasi** (rencana biaya), **Nilai PSSP** (`Estimasi × %PSSP × Pengali Nilai R`), **Tercacah** (apportionment bulanan/kuartalan dari rencana yang tidak selalu pas 1 kuartal), dan **Lock Edit Logic** (begitu atasan approve/edit, level di bawahnya terkunci sampai siklus REVISI baru).

## Cara menggunakan dokumen ini

Bagi developer atau sesi Claude berikutnya yang ingin memahami bagian tertentu dari sistem sebelum menulis kode — baca dokumen yang relevan di atas terlebih dahulu, jangan langsung menebak dari nama variabel/komponen. Apabila menemukan sesuatu yang telah berubah dari yang tercatat di sini, **perbarui juga dokumennya**, agar dokumen tidak menyimpang dari kode aktual (prinsip yang sama seperti `docs/PERFORMANCE.md` §6 dan `docs/sdd/`).
