# KPI Monitoring — Business Rules

*(Sumber: Memo `NO.SM/ETH-II/PI/08.2026`, 28 Juli 2026, efektif 01 Agustus 2026. Berlaku untuk role **MR** (termasuk jabatan "SPV" — secara sistem SPV = role MR dengan `jabatan` override, lihat `internal/TODO.md` #1), **ASM**, **SM**. NSM & GM tidak dinilai pakai KPI ini — mereka cuma jadi *evaluator*, bukan yang dievaluasi.)*

## 1. Pilar, indikator, dan bobot

| Pilar | Parameter Penilaian | Indikator | Bobot |
|---|---|---|---|
| Business Result | Sales Achievement | Achievement target sales (GT/area) | 50% |
| Activity & Coverage | Call Activity | Achievement target kunjungan | 25% |
| Market Development | Customer Expansion | Jumlah customer aktif (PS/SP) | 15% |
| Attitude | Kepatuhan | Absensi (reporting) | 10% |

Formula umum: `Score indikator = Nilai band (0-100) × Bobot`, dijumlahkan semua indikator → **Total Score KPI** (maks 100). Semua indikator dihitung **rata-rata per bulan**.

## 2. Band nilai per indikator

Setiap indikator dipetakan ke skala SR/R/S/T/ST → skor 40/55/70/85/100.

### 2a. Sales Achievement (50%)
Achievement % = Sales Actual / Target × 100.

| Band | SR | R | S | T | ST |
|---|---|---|---|---|---|
| Achievement | <80% | 80-89% | 90-99% | 100-109% | ≥110% |
| Score | 40 | 55 | 70 | 85 | 100 |

Sumber data: sudah tersedia — sama seperti perhitungan Monitoring page (`PoaForm.target` per periode, vs `OutletSalesValueMonthly` real sales). Lihat `02-data-model.md` §1.

### 2b. Call Activity (25%)
Achievement % = realisasi kunjungan / standar kunjungan × 100.

| Band | SR | R | S | T | ST |
|---|---|---|---|---|---|
| Kesesuaian Standar Kunjungan | <70% | 70-79% | 80-89% | 90-99% | ≥100% |
| Score | 40 | 55 | 70 | 85 | 100 |

Standar kunjungan per memo: **MR/SPV = 4 + 6**, **ASM = 2+3**, **SM = 3**. ⚠️ **Butuh klarifikasi stakeholder** — angka ini kemungkinan "kunjungan ke customer tier-A + tier-B per bulan" tapi memo tidak menjelaskan unit/satuan/tier secara eksplisit. Jangan diasumsikan sebelum dikonfirmasi.

⚠️ **Tidak ada data realisasi kunjungan sama sekali di sistem** (lihat `02-data-model.md` §2). Ini bukan celah baru — sudah lama nge-hang sebagai `internal/TODO.md` **#38** (Historis Kunjungan By MR by Customer, akumulasi 3 bulan terakhir — NEED CONFIRMATION, dikonfirmasi ke Pak Fakhri via Anthony SFE, belum ada jawaban) dan **#25** (History Visit sebelumnya — ON-PROSES, placeholder UI ada tapi angka historis belum). KPI Monitoring v1 memakai **input manual oleh atasan** sebagai jembatan sampai #38/#25 selesai atau ada sync eksternal.

### 2c. Customer Expansion (15%)
Indikator absolut (bukan persentase): jumlah customer aktif (PS/SP = Perpanjangan/Serah-terima Kontrak PSSP, perlu dikonfirmasi singkatan pastinya).

| Band | SR | R | S | T | ST |
|---|---|---|---|---|---|
| Jumlah Customer Aktif | <6 | 6-8 | 9-11 | 12-15 | ≥15 |
| Score | 40 | 55 | 70 | 85 | 100 |

Untuk **SM & ASM**: nilai = rata-rata dari jumlah customer aktif seluruh MR/SPV di bawahnya (bukan hitungan langsung SM/ASM sendiri).

Sumber data kandidat: `PsspKontrak` aktif per outlet yang di-cover MR (`getActivePsspByOutlets`, sudah dipakai Summary page). ⚠️ **Butuh konfirmasi** — ini proxy "kontrak PSSP aktif", bukan hitungan customer/dokter yang MR kunjungi/kembangkan secara umum. Kalau maksud memo lebih luas dari PSSP (mis. termasuk customer non-PSSP yang jadi target ekspansi baru), butuh sumber data tambahan (`Customer`/`CustomerOutlet`/`CustomerPengajuan`).

### 2d. Kepatuhan Absensi (10%)
Indikator "Reporting" — deadline **08:00 WIB**.

| Band | SR | R | S | T | ST |
|---|---|---|---|---|---|
| Reporting | >2 | 2.0-1.0 | 1.0-0.5 | 0.5-0 | 0 |
| Score | 40 | 55 | 70 | 85 | 100 |

⚠️ **Unit belum jelas dari memo** — kemungkinan rata-rata jam keterlambatan lapor per bulan, atau rata-rata jumlah kejadian telat, relatif ke jam 08:00. Lebih rendah = lebih baik (nilai 0 = ST/sempurna). **Butuh klarifikasi stakeholder** sebelum band ini di-hardcode ke scoring engine.

⚠️ **Tidak ada data absensi sama sekali di sistem** — tidak ada model, tidak ada sync HRIS. Sama seperti Call Activity: v1 pakai **input manual oleh atasan**, placeholder untuk sync eksternal nanti.

## 3. Contoh perhitungan (dari memo, dipakai sebagai test case)

| Pilar | Nilai | Bobot | Score |
|---|---|---|---|
| Sales Achievement | 70 | 50% | 35 |
| Call Activity | 85 | 25% | 21,25 |
| Customer Expansion | 70 | 15% | 10,5 |
| Kepatuhan Absensi | 70 | 10% | 7 |
| **Total** | | **100%** | **73,75** |

Kesimpulan: score 73,75 → kontrak diperpanjang 9 bulan. **Ini harus jadi unit test pertama untuk scoring engine.**

## 4. Rekomendasi keputusan kontrak

| Nilai KPI Total | Keputusan | Kontrak |
|---|---|---|
| >85 | Sangat Baik | 12 bulan |
| 71-85 | Baik | 9 bulan |
| 55-70 | Perlu evaluasi | 6 bulan |
| <55 | Tidak direkomendasikan | 0 bulan |

**Keputusan final tetap di tangan atasan** — rekomendasi sistem bukan keputusan otomatis. Atasan boleh override, **wajib** disertai penjelasan jelas & logis (field wajib diisi kalau override ≠ rekomendasi sistem).

## 5. Siklus evaluasi & periode

- Evaluasi KPI mengacu ke **periode masa kontrak** FF tersebut, bukan kalender tetap (mis. kuartalan).
- Contoh dari memo: kalau FF diperpanjang 9 bulan di evaluasi terakhir, maka evaluasi kontrak *berikutnya* menghitung rata-rata KPI selama 9 bulan itu.
- Artinya: indikator dihitung **bulanan** (§1), tapi **evaluasi kontrak** adalah agregasi (rata-rata) dari seluruh entry bulanan dalam window kontrak berjalan → 1 keputusan per siklus kontrak, bukan per bulan.
- Ketentuan efektif per **01 Agustus 2026**.

## 6. Siapa menilai siapa

- **SM** menilai & mengisi evaluasi untuk: **ASM, SPV, MR** di bawahnya.
- **NSM** menilai & mengisi evaluasi untuk: **SM** di bawahnya.
- Pimpinan (SM untuk bawahannya, NSM untuk SM) **wajib mengisi "Evaluasi Rencana Pengembangan Personil"** + rasionalisasi perpanjangan ke direksi, dilengkapi data & fakta — bukan cuma angka skor.
- Di luar ketentuan yang tercantum di memo, management berhak menentukan kebijakan lain sesuai kebutuhan (klausul fleksibilitas eksplisit).

## 7. Open questions — status & assumptions dipakai untuk v1

Sesuai konvensi repo ini (lihat `internal/TODO.md` — item ambigu ditandai NEED CONFIRMATION, bukan diasumsikan diam-diam), berikut daftar lengkap dengan status masing-masing. **Keputusan user 2026-07-30: lanjut implementasi pakai asumsi di bawah, koreksi belakangan kalau meleset** — jadi ini BUKAN klarifikasi asli dari stakeholder/pemegang memo, cuma pilihan kerja sementara supaya v1 bisa dibangun. Tandai jelas di kode (komentar) supaya gampang ditelusuri & dikoreksi nanti, sama seperti pola item lain di `internal/TODO.md` yang punya catatan "⚠️ butuh klarifikasi".

1. **Standar kunjungan "4+6 / 2+3 / 3"** — **ASUMSI**: dipakai sebagai total angka standar kunjungan/bulan per role (bukan di-breakdown tier), yaitu MR/SPV = 10, ASM = 5, SM = 3. Achievement% = realisasi ÷ angka ini × 100. Kalau ternyata maksud aslinya breakdown per tier customer, band/formula ini perlu direvisi.
2. **Format input manual Call Activity** — **ASUMSI**: satu angka realisasi kunjungan per personil per bulan (field `callActivityRealisasi` di `KpiMonthlyEntry`), tanpa breakdown per customer/tier di v1.
3. **Unit indikator Absensi** — **ASUMSI**: rata-rata jam keterlambatan lapor per bulan (relatif ke deadline 08:00 WIB), nilai desimal, makin kecil makin baik (0 = ST/sempurna). Disimpan di `absensiValue` (`KpiMonthlyEntry`).
4. **Customer Expansion** — **ASUMSI**: pakai proxy PSSP aktif (§2c, `getActivePsspByOutlets`) apa adanya, tanpa filter tambahan.
5. **"PS/SP"** — **ASUMSI**: tidak difilter berdasarkan `enum PsSp` (`PS`/`SP`) — semua kontrak PSSP aktif dihitung, terlepas dari nilai `jenisPsSp`-nya. Field enum itu sendiri statusnya juga belum jelas di schema ("business meaning not yet pinned down", lihat komentar di `schema.prisma`), jadi tidak dipakai sebagai filter sampai ada kejelasan.
6. ~~Apakah KPI Monitoring ini halaman terpisah, atau tab baru di halaman **Monitoring** yang sudah ada?~~ **Terjawab (2026-07-30)** — halaman baru terpisah, nama **"Monitoring KPI Perpanjangan"**, akses **ADMIN-only untuk v1** (sama pola kayak `/monitoring` yang juga masih dibatasi ADMIN). Lihat `03-ui-and-access.md` §2.
