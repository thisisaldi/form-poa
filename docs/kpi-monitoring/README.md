# KPI Monitoring — Spec Index

*(Ditulis 2026-07-30, mengikuti pendekatan spec-driven development: spec ditulis & disetujui dulu sebelum ada kode. Sumber requirement: Memo Internal `NO.SM/ETH-II/PI/08.2026` — "KPI Personil Kinerja, Kontrak & Kaderisasi FF Hospital", berlaku efektif 01 Agustus 2026, menggantikan memo lama `SM/ETH-I/PI/05.2026`.)*

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — requirement dari memo, definisi indikator, formula scoring, band nilai, keputusan kontrak, dan open questions yang butuh klarifikasi stakeholder sebelum implementasi bisa mulai.
2. [`02-data-model.md`](./02-data-model.md) — model Prisma yang diusulkan, sumber data per indikator (existing vs baru), dan rencana integrasi/placeholder untuk 2 indikator yang belum punya data source.
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — halaman, role/akses, dan pola UI yang di-reuse dari fitur Monitoring/Summary yang sudah ada.

## Status

🟢 **v1 diimplementasi 2026-07-30** — halaman `/kpi-perpanjangan` ("Monitoring KPI Perpanjangan" di sidebar), **ADMIN-only**. Tracked di `internal/TODO.md` #67.

Yang sudah jalan: scorecard bulanan 4 pilar (Sales Achievement & Customer Expansion otomatis, Call Activity & Absensi input manual ADMIN), scoring engine (`src/lib/kpiScoring.ts`, cocok persis sama contoh perhitungan memo), tabel sortable dengan rekomendasi kontrak per baris.

Yang **belum** dibangun: halaman/form Evaluasi Kontrak (`KpiContractEvaluation` — agregasi per periode kontrak + keputusan atasan + rencana pengembangan personil), dan role matrix akhir (SM/NSM sebagai evaluator — masih ADMIN-only untuk v1).

⚠️ Beberapa formula pakai **asumsi kerja** (dipilih user 2026-07-30 supaya implementasi bisa jalan, "adjust belakangan"), bukan klarifikasi asli stakeholder — lihat `01-business-rules.md` §7 sebelum mengandalkan angka-angka spesifik untuk keputusan kontrak yang nyata.

## Ringkasan cepat

Memo mendefinisikan scorecard bulanan untuk level **MR, SPV, ASM, SM Hospital** (4 pilar berbobot, skor 0-100) yang jadi dasar rekomendasi perpanjangan kontrak. Riset kode (2026-07-30) menemukan:

- **Business Result (Sales Achievement, 50%)** — data sudah ada penuh, sama persis dengan yang sudah dihitung Monitoring page (`PoaForm.target` vs `OutletSalesValueMonthly`).
- **Market Development (Customer Expansion, 15%)** — data proxy sudah ada (`PsspKontrak` aktif via `getActivePsspByOutlets`), tapi ini basis kontrak PSSP aktif, bukan hitungan customer/dokter mentah — butuh konfirmasi apakah proxy ini diterima.
- **Activity & Coverage (Call Activity, 25%)** dan **Attitude (Kepatuhan Absensi, 10%)** — **tidak ada data sama sekali** di sistem manapun (bukan bug, memang belum pernah dibangun). Ini juga bukan barang baru — overlap langsung sama 2 item yang sudah lama nge-hang di tracker: `internal/TODO.md` **#38** (Historis Kunjungan By MR by Customer, NEED CONFIRMATION) dan **#25** (History Visit sebelumnya, ON-PROSES). Keputusan: kedua indikator ini dibangun sebagai **input manual oleh atasan + placeholder untuk sync eksternal di masa depan** (lihat `02-data-model.md`).
