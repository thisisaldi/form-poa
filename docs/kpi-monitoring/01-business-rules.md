# KPI Monitoring — Business Rules

*(Sumber: Memo `NO.SM/ETH-II/PI/08.2026`, 28 Juli 2026, efektif 01 Agustus 2026. Berlaku untuk role **MR** (termasuk jabatan "SPV" — secara sistem SPV adalah role MR dengan `jabatan` override, lihat `docs/TODO.md` #1), **ASM**, dan **SM**. NSM dan GM tidak dinilai menggunakan KPI ini — mereka hanya berperan sebagai *evaluator*, bukan pihak yang dievaluasi.)*

## 1. Pilar, indikator, dan bobot

| Pilar | Parameter Penilaian | Indikator | Bobot |
|---|---|---|---|
| Business Result | Sales Achievement | Achievement target sales (GT/area) | 50% |
| Activity & Coverage | Call Activity | Achievement target kunjungan | 25% |
| Market Development | Customer Expansion | Jumlah customer aktif (PS/SP) | 15% |
| Attitude | Kepatuhan | Absensi (reporting) | 10% |

Formula umum: `Score indikator = Nilai band (0-100) × Bobot`, dijumlahkan seluruh indikator → **Total Score KPI** (maksimum 100). Seluruh indikator dihitung sebagai **rata-rata per bulan**.

## 2. Band nilai per indikator

Setiap indikator dipetakan ke skala SR/R/S/T/ST → skor 40/55/70/85/100.

### 2a. Sales Achievement (50%)
Achievement % = Sales Actual / Target × 100.

| Band | SR | R | S | T | ST |
|---|---|---|---|---|---|
| Achievement | <80% | 80-89% | 90-99% | 100-109% | ≥110% |
| Score | 40 | 55 | 70 | 85 | 100 |

Sumber data: sudah tersedia — identik dengan perhitungan pada halaman Monitoring (`PoaForm.target` per periode, dibandingkan terhadap `OutletSalesValueMonthly` sebagai real sales). Lihat `02-data-model.md` §1.

### 2b. Call Activity (25%)
Achievement % = realisasi kunjungan / standar kunjungan × 100.

| Band | SR | R | S | T | ST |
|---|---|---|---|---|---|
| Kesesuaian Standar Kunjungan | <70% | 70-79% | 80-89% | 90-99% | ≥100% |
| Score | 40 | 55 | 70 | 85 | 100 |

Standar kunjungan per memo — **dikonfirmasi pengguna 2026-09-21**: angka adalah **minimal kunjungan per jendela waktu**:

| Role | Minimal 08:00-15:00 | Minimal 15:00-08:00 | Total |
|---|---|---|---|
| MR / SPV | 4 | 6 | 10 |
| ASM | 2 | 3 | 5 |
| SM | 3 (tanpa split) | — | 3 |

✅ **Diimplementasikan 2026-09-21** (sumber data: MSSQL `exodus_sfe.dbo.visit_realizations`, bukan lagi API `count-by-nip`; jumlah barisnya identik dengan API itu — diverifikasi 10 NIP, Agustus 2026 — `visit` dan `extra call` sama-sama dihitung). Aturan:
- Angka di tabel = minimal **rata-rata kunjungan per hari aktif** dalam sebulan (dikonfirmasi pengguna). "Hari aktif" = hari (WIB) dengan ≥1 kunjungan — dipilih karena tidak butuh kalender libur/cuti; celahnya: orang yang cuma masuk 1-2 hari bisa rata-ratanya tinggi. Alternatif kalau perlu lebih ketat: bagi dengan hari kerja kalender.
- Jendela waktu pakai jam WIB (`visit_start_date` tersimpan UTC, +7 jam): 08:00-14:59 = jendela siang, sisanya (15:00-07:59) = jendela luar jam.
- Realisasi efektif = `min(rata2 siang, minimal siang) + min(rata2 luar, minimal luar)` — tiap jendela di-cap di minimalnya sendiri supaya kelebihan di satu jendela tidak menutupi kekurangan di jendela lain. Achievement% = realisasi efektif ÷ (minimal siang + minimal luar) × 100, lalu band di atas. SM: `min(rata2 semua jam, 3)`. Lihat `callActivityRealisasiFromDailyAvgs`, `src/lib/kpiScoring.ts`.
- `KpiMonthlyEntry.callActivityRealisasi` jadi `Float` (migration `20260921120000_kpi_call_activity_realisasi_float`) karena hasilnya pecahan. Nilai lama (total kunjungan bulanan dari sync versi sebelumnya) tidak valid lagi — jalankan ulang "Sync Kunjungan dari Exodus" per bulan yang mau dipakai.
- Catatan: rata-rata jendela 15:00-08:00 untuk mayoritas orang di bawah minimal 6, jadi skor Call Activity bisa turun dibanding sebelum aturan ini.

🟢 **Update 2026-09-08 — realisasi kunjungan kini bisa disinkron otomatis dari Exodus**, menutup `docs/TODO.md` **#38** untuk pilar ini. Stakeholder memberikan URL endpoint "Get Count Visit By NIP" (`GET /exodus/activity/v1/visits/count-by-nip?nip=...&periode_awal=YYYYMM&periode_akhir=YYYYMM`, response `data.actual_visit_by_period` per bulan) — diimplementasikan sebagai `getVisitCountByNip` (`src/lib/exodusApi.ts`) + job sync `src/lib/sync/kpiCallActivitySync.ts`, trigger manual saja lewat tombol "Sync Kunjungan dari Exodus" di `/kpi-perpanjangan` (atau `scripts/syncKpiCallActivity.ts` CLI) — pola identik sync Absensi SIPP (§2d), termasuk "manual wins": row yang `callActivitySource`-nya udah "MANUAL" gak ditimpa sync berikutnya. `docs/TODO.md` **#25** (History Visit UI placeholder) masih terpisah, belum tersentuh perubahan ini.

⚠️ Sync sekarang membaca MSSQL langsung (lihat paragraf di atas), bukan API count-by-nip.

### 2c. Customer Expansion (15%)
Indikator absolut (bukan persentase): jumlah customer aktif (PS/SP = Perpanjangan/Serah-terima Kontrak PSSP, perlu dikonfirmasi singkatan pastinya).

| Band | SR | R | S | T | ST |
|---|---|---|---|---|---|
| Jumlah Customer Aktif | <6 | 6-8 | 9-11 | 12-15 | ≥15 |
| Score | 40 | 55 | 70 | 85 | 100 |

Untuk **SM & ASM**: nilai dihitung sebagai rata-rata dari jumlah customer aktif seluruh MR/SPV di bawahnya (bukan hitungan langsung milik SM/ASM sendiri). Diverifikasi terhadap kode: `src/app/actions/kpi.ts:166-174`.

Sumber data kandidat: `PsspKontrak` aktif per outlet yang dicakup MR (`getActivePsspByOutlets`, sudah dipakai halaman Summary). ⚠️ **Butuh konfirmasi** — ini adalah proxy "kontrak PSSP aktif", bukan hitungan customer/dokter yang dikunjungi/dikembangkan MR secara umum. Jika maksud memo lebih luas dari PSSP (misalnya termasuk customer non-PSSP yang menjadi target ekspansi baru), dibutuhkan sumber data tambahan (`Customer`/`CustomerOutlet`/`CustomerPengajuan`).

### 2d. Kepatuhan Absensi (10%)
Indikator "Reporting" — deadline **08:00 WIB**.

| Band | SR | R | S | T | ST |
|---|---|---|---|---|---|
| Reporting | >2 | 2.0-1.0 | 1.0-0.5 | 0.5-0 | 0 |
| Score | 40 | 55 | 70 | 85 | 100 |

⚠️ **Unit belum jelas dari memo** — kemungkinan rata-rata jam keterlambatan lapor per bulan, atau rata-rata jumlah kejadian telat, relatif terhadap jam 08:00. Semakin rendah nilainya semakin baik (nilai 0 = ST/sempurna). **Butuh klarifikasi stakeholder** sebelum band ini di-hardcode secara final ke scoring engine.

⚠️ **Tidak ada data absensi sama sekali di sistem** — tidak ada model, tidak ada sync HRIS. Sama seperti Call Activity: v1 memakai **input manual oleh atasan**, sebagai placeholder untuk sync eksternal nanti.

🟢 **Update 2026-08-24 — diimplementasikan**: API eksternal **SIPP (Trade Marketing)** (`API - Trade Marketing Documentation.pdf`, API Doc. Ver. 1.0.2026) sekarang disambungkan ke pilar ini via `src/lib/sippApi.ts` (client) dan `src/lib/sync/kpiAbsensiSync.ts` (job sync). **Trigger manual saja, sengaja TIDAK otomatis/cron** — satu HTTP call per personil per run, dan menjalankannya di setiap page render/company-wide akan melanggar `docs/PERFORMANCE.md` §2 poin 4; solusinya bukan cron background, tapi ADMIN menekan tombol "Sync Absensi dari SIPP" di `/kpi-perpanjangan` (`syncKpiAbsensiAction`, `src/app/actions/kpi.ts`) sesaat sebelum melihat data, atau `scripts/syncKpiAbsensi.ts [period]` dari CLI.

**Keputusan unit (diambil 2026-08-24, atas arahan pengguna "ikuti memonya, implementasikan")**: dipakai bacaan literal memo — Reporting dibandingkan terhadap deadline 08:00 WIB, dan band bernilai desimal (`2.0-1.0`, `1.0-0.5`, dst) paling cocok dibaca sebagai **rata-rata jam keterlambatan per bulan** (bukan jumlah kejadian) — konsisten dengan asumsi kerja lama di §7 poin 3, `scoreAbsensi()` di `kpiScoring.ts` TIDAK berubah. Dihitung dari `AbsDateIn` API SIPP: untuk setiap record dengan `AbsTelatYN="Y"`, `jam_telat = max(0, jam_checkin - 08:00)`; dirata-rata terhadap **seluruh** record kehadiran pada bulan itu (bukan hanya yang telat) — supaya telat sesekali dan telat kronis tidak menghasilkan rata-rata yang sama (`computeAvgLateHours`, `src/lib/sippApi.ts`). Ini tetap pilihan kerja, bukan konfirmasi asli dari pemegang memo/HR — koreksi apabila meleset, sama seperti asumsi §7 lainnya.

**Belum bisa aktif di production** sampai tiga hal berikut disediakan: (1) kredensial vendor SIPP (`SIPP_BASE_URL`/`SIPP_CLIENT_ID`/`SIPP_CLIENT_SECRET`, lihat `src/lib/env.ts`) — sync ini degrade diam-diam ke "skip" (bukan error) selama env var ini belum diisi, pola yang sama seperti `EXODUS_*`; (1b) **diverifikasi 2026-08-24 di staging**: `scripts/sippCreateVendor.ts` berhasil mendaftarkan vendor baru, TAPI vendor baru berstatus **inactive** secara default (`AuthenticateVendor` menolak dengan `"vendor inactive"`) — perlu pihak SIPP/HR ops mengaktifkan `VendorCode` yang didaftarkan sebelum `SIPP_CLIENT_ID`/`SIPP_CLIENT_SECRET` benar-benar bisa dipakai, self-registrasi saja tidak cukup; dan (2) API SIPP mewajibkan `AbsPTID` per request, tetapi **aplikasi ini tidak punya field company/entity apa pun pada model `User`** (diverifikasi 2026-08-24 — tidak ada `ptId`/`company`/`cabang` di `schema.prisma` maupun di manapun pada `src/`).

**⚠️ kredensial `TradeMarketing` di PDF dokumentasi API ternyata BUKAN contoh, melainkan kredensial vendor asli yang aktif di staging** (diverifikasi: berhasil auth sungguhan) — dikonfirmasi pengguna 2026-08-24 ini memang tim/vendor mereka sendiri, bukan kebocoran vendor lain. Tetap disarankan rotate `ClientSecret` sebelum dipakai di production, karena sudah pernah tersebar lewat PDF.

**Desain PTID final (2026-09-23)**: PTID diambil dari `User.sippAbsPtId`, diisi dari file master HR (xlsx, satu sheet per sumber: NTSQL=PTID 1, PML=PTID 7, Faratu=PTID 20; kolom `Kry_NIP`/`Kry_PTID`) lewat `scripts/importSippPtidFromHrFile.ts <path-xlsx>` — dijalankan 2026-09-23 ke DB staging dan production, jalankan ulang tiap HR mengirim file baru. Ini menggantikan tebakan awalan huruf NIP: file HR menunjukkan awalan tidak cukup (1.083 NIP berawalan `P` sebenarnya PTID 7 / PML, bukan 1; awalan `F` = 20). NIP yang tidak ada di file HR (`sippAbsPtId` masih null) dilaporkan sebagai error di hasil sync, bukan ditebak — karena PTID salah pada API SIPP tidak error melainkan mengembalikan data kosong. NIP berawalan `TEST` dikecualikan dari sync dan dari halaman monitoring.

*Sejarah*: (1) 2026-08-24: probing kandidat `[1, 7]` per NIP + cache di `sippAbsPtId`; (2) 2026-09-21: mapping awalan huruf P/L/F hardcoded; (3) 2026-09-23: mapping per-NIP dari file HR (di atas). Catatan operasional 2026-09-23: sempat terlihat bug NULL di server SIPP (`AbsLemburYN`/`AbsUpdateDate`) untuk ~111 NIP dan data kosong untuk NIP `L`, tapi hilang sendiri pada pengecekan ulang hari yang sama (sisi SIPP)—hasil sync setelahnya: production Agustus 672/694, September 650/694 ter-sync, sisanya tanpa data.

✅ **Kredensial vendor production sudah dibuat dan diverifikasi aktif 2026-08-24** — `VendorCode: TradeMarketing` didaftarkan di production via `scripts/sippCreateVendor.ts`, sempat inactive (sama seperti temuan awal di staging), lalu diaktifkan (oleh siapa/tim mana belum tercatat di sini) dan berhasil auth + `AbsPTID=7` mengembalikan data nyata di production. Kredensial production **berbeda** dari staging (host terpisah) — kedua pasang ClientID/ClientSecret sudah diserahkan ke pengguna untuk dimasukkan ke Vault (staging → `.env.local` developer, production → lewat Bryan).

"Manual menang atas sync": apabila ADMIN pernah mengisi `absensiValue` manual untuk suatu nip+periode (`absensiSource="MANUAL"`), sync job melewati baris tersebut pada run berikutnya — tidak menimpa koreksi manual (`kpiAbsensiSync.ts`). UI (`KpiTable.tsx`) menampilkan label kecil "(sinkron)" pada nilai yang berasal dari SIPP, supaya ADMIN tahu sumbernya sebelum melakukan override manual.

Endpoint terkait lain di API SIPP yang sama, belum dipakai: `get=perbaikanabsen` (histori pengajuan koreksi absen), `get=cuti` (histori cuti — di luar cakupan pilar Absensi), dan `get=detailkaryawan` (profil master karyawan, berpotensi jadi sumber PTID per-NIP di masa depan bila field-nya tersedia di respons — belum diverifikasi).

## 3. Contoh perhitungan (dari memo, dipakai sebagai test case)

**Ini adalah acceptance test kanonis untuk scoring engine** — setiap perubahan pada `src/lib/kpiScoring.ts` wajib tetap menghasilkan angka yang sama persis untuk input berikut, sesuai prinsip "requirement harus dapat diuji" (`docs/sdd/04-quality-checklist.md` §3).

| Pilar | Nilai | Bobot | Score |
|---|---|---|---|
| Sales Achievement | 70 | 50% | 35 |
| Call Activity | 85 | 25% | 21,25 |
| Customer Expansion | 70 | 15% | 10,5 |
| Kepatuhan Absensi | 70 | 10% | 7 |
| **Total** | | **100%** | **73,75** |

Kesimpulan: score 73,75 → kontrak diperpanjang 9 bulan.

Verifikasi terhadap kode (2026-08-05): `computeTotalScore({ salesScore: 70, activityScore: 85, customerScore: 70, absensiScore: 70 })` di `src/lib/kpiScoring.ts:101-108` menghasilkan `70×0.5 + 85×0.25 + 70×0.15 + 70×0.1 = 73.75`, dan `recommendContractMonths(73.75)` (`src/lib/kpiScoring.ts:116-121`) mengembalikan `{ months: 9, label: "Baik" }` — cocok persis dengan contoh memo di atas.

⚠️ **Status verifikasi**: kecocokan di atas baru diverifikasi secara manual (pembacaan kode), **bukan lewat automated test**. Grep terhadap `**/*.test.ts`/`**/*.spec.ts` di `src/` tidak menemukan berkas test apa pun, dan `package.json` tidak memiliki test script maupun dependency test framework (Jest/Vitest) sama sekali — repositori ini belum punya infrastruktur automated testing sama sekali, bukan hanya untuk `kpiScoring.ts`. Artinya acceptance criterion di atas masih berupa intent yang terdokumentasi dan diverifikasi manual, belum sungguh-sungguh "diverifikasi di kode" dalam arti ada test yang gagal otomatis kalau formula berubah.

## 4. Rekomendasi keputusan kontrak

| Nilai KPI Total | Keputusan | Kontrak |
|---|---|---|
| >85 | Sangat Baik | 12 bulan |
| 71-85 | Baik | 9 bulan |
| 55-70 | Perlu evaluasi | 6 bulan |
| <55 | Tidak direkomendasikan | 0 bulan |

**Keputusan final tetap berada di tangan atasan** — rekomendasi sistem bukan keputusan otomatis. Atasan boleh melakukan override, **wajib** disertai penjelasan yang jelas dan logis (field wajib diisi apabila override berbeda dari rekomendasi sistem).

## 5. Siklus evaluasi & periode

- Evaluasi KPI mengacu pada **periode masa kontrak** FF yang bersangkutan, bukan kalender tetap (misalnya kuartalan).
- Contoh dari memo: apabila FF diperpanjang 9 bulan pada evaluasi terakhir, maka evaluasi kontrak *berikutnya* menghitung rata-rata KPI selama 9 bulan tersebut.
- Artinya: indikator dihitung **bulanan** (§1), tetapi **evaluasi kontrak** merupakan agregasi (rata-rata) dari seluruh entry bulanan dalam window kontrak berjalan → satu keputusan per siklus kontrak, bukan per bulan.
- Ketentuan berlaku efektif per **01 Agustus 2026**.

### Tahapan siklus evaluasi kontrak (disintesis dari §4-§6, belum ada implementasi kode)

Urutan berikut merangkum §4-§6 di atas sebagai tahapan eksplisit, mengikuti prinsip "setiap transisi state harus terdefinisi" (`docs/sdd/04-quality-checklist.md` §8). Belum ada kode yang mengimplementasikan alur ini — `KpiContractEvaluation` baru berupa model data (lihat `02-data-model.md`), belum punya halaman/form (`03-ui-and-access.md` §2 "Form Evaluasi Kontrak") maupun server action:

1. **Entry bulanan terkumpul** — setiap bulan dalam window kontrak berjalan, satu `KpiMonthlyEntry` per personil per periode terbentuk (§1, `@@unique([nip, period])` — lihat invariant di `02-data-model.md`).
2. **Window kontrak berakhir** — atasan (SM untuk ASM/SPV/MR, NSM untuk SM — §6) memulai evaluasi kontrak untuk personil tersebut, dengan `periodeMulai`/`periodeAkhir` mencakup seluruh bulan window yang berjalan.
3. **Sistem menghitung rekomendasi** — rata-rata 4 skor pilar dari seluruh `KpiMonthlyEntry` dalam window tersebut → `systemRecommendationMonths` sesuai band §4 (12/9/6/0 bulan).
4. **Atasan memutuskan** — mengisi `decisionMonths` (boleh sama dengan atau berbeda dari rekomendasi sistem). Jika berbeda, `decisionReason` **wajib** diisi (§4).
5. **Atasan mengisi rencana pengembangan** — `developmentPlanNotes` **selalu wajib** diisi, berikut rasionalisasi ke direksi dilengkapi data dan fakta (§6).
6. **Window kontrak baru dimulai** — bulan setelah evaluasi ini menjadi awal window berikutnya, dengan panjang window mengikuti `decisionMonths` yang baru saja diputuskan (kembali ke langkah 1).

❓ **Belum tercakup oleh memo maupun spesifikasi ini** (edge case, `docs/sdd/04-quality-checklist.md` §7) — perilaku berikut belum didefinisikan dan tidak boleh diasumsikan sampai dikonfirmasi: (a) apa yang terjadi jika satu atau lebih bulan dalam window evaluasi memiliki `KpiMonthlyEntry` yang tidak lengkap/tidak ada (lihat catatan failure behavior di `02-data-model.md` §"Catatan desain — KpiContractEvaluation"); (b) apa yang terjadi jika kontrak personil berakhir lebih cepat dari jadwal (mis. resign) sebelum window evaluasi selesai; (c) apakah evaluasi dapat diulang/dikoreksi setelah `evaluatedAt` tersimpan, atau bersifat final begitu tersimpan.

## 6. Siapa menilai siapa

- **SM** menilai dan mengisi evaluasi untuk: **ASM, SPV, MR** di bawahnya.
- **NSM** menilai dan mengisi evaluasi untuk: **SM** di bawahnya.
- Pimpinan (SM untuk bawahannya, NSM untuk SM) **wajib mengisi "Evaluasi Rencana Pengembangan Personil"** beserta rasionalisasi perpanjangan ke direksi, dilengkapi data dan fakta — bukan sekadar angka skor.
- Di luar ketentuan yang tercantum dalam memo, management berhak menentukan kebijakan lain sesuai kebutuhan (klausul fleksibilitas eksplisit).

## 7. Open questions — status & assumptions dipakai untuk v1

Sesuai konvensi repositori ini (lihat `docs/TODO.md` — item ambigu ditandai NEED CONFIRMATION, bukan diasumsikan secara diam-diam), berikut daftar lengkap beserta status masing-masing. **Keputusan pengguna 2026-07-30: lanjutkan implementasi menggunakan asumsi di bawah ini, koreksi kemudian apabila meleset** — sehingga daftar ini BUKAN klarifikasi asli dari stakeholder/pemegang memo, melainkan pilihan kerja sementara agar v1 dapat dibangun. Ditandai secara jelas di kode (komentar) agar mudah ditelusuri dan dikoreksi nanti, mengikuti pola item lain di `docs/TODO.md` yang memiliki catatan "⚠️ butuh klarifikasi".

1. **Standar kunjungan "4+6 / 2+3 / 3"** — **Arti angka dikonfirmasi 2026-09-21** (minimal per jendela 08-15 / 15-08, lihat §2b), tapi sudah diimplementasikan per jendela (lihat §2b). Catatan lama: dulu dipakai sebagai total angka standar kunjungan per bulan per role (bukan di-breakdown per tier), yaitu MR/SPV = 10, ASM = 5, SM = 3. Achievement% = realisasi ÷ angka ini × 100. Diimplementasikan di `CALL_ACTIVITY_STANDARD_BY_ROLE` (`src/lib/kpiScoring.ts:22-26`). Apabila ternyata maksud aslinya adalah breakdown per tier customer, band/formula ini perlu direvisi.
2. **Format input manual Call Activity** — **ASUMSI**: satu angka realisasi kunjungan per personil per bulan (field `callActivityRealisasi` di `KpiMonthlyEntry`), tanpa breakdown per customer/tier di v1. Lihat juga catatan update Exodus Activity API di §2b — belum mengubah asumsi ini karena integrasi belum dikerjakan.
3. **Unit indikator Absensi** — **ASUMSI**: rata-rata jam keterlambatan lapor per bulan (relatif terhadap deadline 08:00 WIB), nilai desimal, semakin kecil semakin baik (0 = ST/sempurna). Disimpan di `absensiValue` (`KpiMonthlyEntry`). Diimplementasikan di `scoreAbsensi` (`src/lib/kpiScoring.ts:85-91`). **Belum tereselesaikan oleh update API SIPP 2026-08-24** (lihat §2d) — API baru menyediakan data mentah (timestamp check-in + flag telat Y/N), tapi tidak menentukan sendiri apakah unit yang benar adalah rata-rata jam telat atau jumlah kejadian telat; keputusan ini tetap membutuhkan konfirmasi stakeholder sebelum di-hardcode.
4. ~~**Customer Expansion** — proxy PSSP aktif cukup?~~ **Terkonfirmasi (2026-07-30, pengguna)** — betul, yang terhitung hanya customer dengan PSSP AKTIF (`prdAkhir >= periode berjalan`, via `getActivePsspByOutlets`), bukan yang PSSP-nya sudah habis/expired. Ini bukan lagi asumsi kerja.
5. **"PS/SP"** — **ASUMSI**: tidak difilter berdasarkan `enum PsSp` (`PS`/`SP`) — seluruh kontrak PSSP aktif dihitung, terlepas dari nilai `jenisPsSp`-nya. Field enum itu sendiri statusnya juga belum jelas di schema ("business meaning not yet pinned down", lihat komentar di `schema.prisma`), sehingga belum dipakai sebagai filter sampai ada kejelasan.
6. ~~Apakah KPI Monitoring ini halaman terpisah, atau tab baru di halaman **Monitoring** yang sudah ada?~~ **Terjawab (2026-07-30)** — halaman baru terpisah, dengan nama **"Monitoring KPI Perpanjangan"**, akses **ADMIN-only untuk v1** (mengikuti pola yang sama seperti `/monitoring` yang juga masih dibatasi ADMIN). Lihat `03-ui-and-access.md` §2.
