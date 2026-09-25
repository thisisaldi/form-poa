# Evaluasi Kontrak Non-Hospital — Spec Index

*(Ditulis 2026-09-25, spec-driven development: spesifikasi ditulis dan disetujui dulu, kode belakangan. Sumber requirement: permintaan pengguna 2026-09-25 + prototipe/skeleton "Evaluasi Kontrak Non-Hospital" (artifact HTML, disimpan di `internal/Evaluasi Kontrak Non-Hospital.html` — file itu hanya cangkang, isi aslinya dibaca dari alamat artifact-nya). Prototipe itu sendiri direkonstruksi dari dua file Excel milik pengguna: "Summary KPI Non Hospital.xlsx" (rekap 42 personil) dan "KPI P250021 – Teguh Wira Satria.xlsx" (rincian bulanan satu personil). **Memo/kebijakan resmi skema Non-Hospital belum ada di repo** — lihat Open Questions.)*

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — indikator & bobot, formula (diturunkan dari angka contoh di prototipe), tier rekomendasi, alur persetujuan/keputusan, aturan penanda data bermasalah, dan open questions.
2. [`02-data-model.md`](./02-data-model.md) — sumber data per indikator (existing vs baru), model Prisma yang diusulkan, invariant.
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — halaman, role/akses, komponen yang dipakai ulang, non-goals.

## Status

🟡 **UI + alur keputusan dibangun 2026-09-25, skor belum lengkap.** Halaman `/evaluasi-kontrak-non-hospital` (ADMIN-only) sudah ada: kartu ringkasan, tabel dengan cari/filter/urut, Detail Skor (drawer), input bulanan SC Menang/Absensi, form keputusan (append-only), dan Export Excel. Formula Achievement dan Kunjungan sudah dihitung dari data nyata dan dicek terhadap angka prototipe (`scripts/checkNonHospitalScoring.ts`). **Total Score dan rekomendasi baru muncul setelah band nilai SC Menang dan Absensi dikonfirmasi** (OQ-2, OQ-3 — kodenya sengaja mengembalikan `null`, bukan menebak), dan **daftar kontrak kosong sampai ADMIN mengimpor data kontrak** (`scripts/importNonHospitalContracts.ts`, OQ-5). Migration Non-Hospital sudah diterapkan ke DB **staging** (2026-09-25, bukan production), dengan 3 kontrak percobaan bertanda `source = "TEST_SEED"` (hapus sebelum data asli diimpor). Sales aktual sudah tersambung ke `OMG1` (OQ-9 terjawab).

Keputusan pengguna 2026-09-25 (✅ terkonfirmasi): fitur ini hanya untuk skema **Non-Hospital** (bukan Hospital, bukan keduanya); fitur yang diambil dari prototipe: Detail Skor, Persetujuan + keputusan, data kontrak + kartu "berakhir bulan ini", Export Excel + penanda data bermasalah; data kontrak diusulkan dari file HR.

⚠️ **Koreksi terhadap usulan "data kontrak dari file HR"**: dicek 2026-09-25 terhadap `hrd-karyawan-gabungan.xlsx` — file itu hanya memuat **tanggal masuk** (`Kry_TglMasuk`, cocok dengan "awal kontrak" di prototipe untuk 6 dari 6 NIP yang dicek). **Akhir kontrak, lama kontrak, dan nama cabang TIDAK ada**: `Kry_TglKeluar` kosong untuk karyawan aktif, `Kry_IkatanKerja` dan `Kry_Percobaan` bernilai 0, cabang hanya ID angka (`Kry_CabID`). Sumber untuk tiga field itu masih terbuka.

## Ringkasan cepat

Skema Non-Hospital menilai personil **PSR / Supervisor / Area Manager / Manager** dengan 4 indikator berbobot (Achievement Target 50%, Jumlah Kunjungan 25%, Jumlah SC Menang 15%, Absensi 10%), skor 0-100, dirata-rata per bulan selama window evaluasi (6 bulan pada contoh). Total skor dipetakan ke rekomendasi perpanjangan kontrak 12/9/6/0 bulan — **tier yang sama persis** dengan skema Hospital (`recommendContractMonths`, `src/lib/kpiScoring.ts`). Berbeda dari halaman Monitoring KPI Hospital yang sudah ada (`/kpi-perpanjangan`, hanya melihat), halaman ini adalah **layar evaluasi kontrak**: ada data kontrak, drilldown per indikator, dan keputusan atasan (setujui rekomendasi, atau ubah dengan alasan wajib + rencana pengembangan, sesuai memo Hospital §4-§6 yang diasumsikan berlaku sama). Data ini melengkapi `KpiContractEvaluation` yang sudah dimodelkan tetapi belum punya halaman (lihat `docs/kpi-monitoring/README.md`).
