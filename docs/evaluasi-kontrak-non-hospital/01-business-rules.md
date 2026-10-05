# Evaluasi Kontrak Non-Hospital — Business Rules

*(Sumber: prototipe "Evaluasi Kontrak Non-Hospital" + dua file Excel asalnya, lihat `README.md`. Semua formula di bawah **diturunkan dari angka contoh** di prototipe (dihitung ulang dan cocok), bukan dari memo resmi — tanda ⚠️ menunjukkan bagian yang belum terkonfirmasi.)*

## 1. Cakupan

Personil skema Non-Hospital, level jabatan **PSR / Supervisor / Area Manager / Manager** (42 personil di prototipe, semua kontraknya berakhir Okt 2026). ❓ Pemetaan jabatan ini ke `role` sistem (MR/ASM/SM/…) dan siapa saja yang masuk daftar — lihat §7 (OQ-6).

## 2. Indikator, bobot, dan cara menghitung "Real"

| Indikator | Bobot | "Real" untuk satu window evaluasi | Satuan |
|---|---|---|---|
| Achievement Target (Sales) | 50% | rata-rata ACH bulanan; ACH bulan = Sales ÷ Target | % |
| Jumlah Kunjungan | 25% | rata-rata ACH bulanan; ACH bulan = Jumlah visit ÷ (Hari kerja × target visit/hari) | % |
| Jumlah SC Menang | 15% | rata-rata jumlah SC menang per bulan | SC |
| Absensi | 10% | rata-rata jumlah **hari** telat per bulan | hari/bln |

**Skor** = Σ (Nilai indikator × Bobot); Nilai 0-100 dari band (§3). Semua indikator dirata-rata **per bulan**, sama seperti skema Hospital (`docs/kpi-monitoring/01-business-rules.md` §1).

Verifikasi terhadap contoh di prototipe (personil `P250021`, window Mar-Agu 2026): rata-rata ACH sales `[0,7413; 0,9444; 0,8197; 0,9823; 0,7827; 0,7953]` = **84,4%** ✓; ACH kunjungan bulan Mar = 213 ÷ (21 × 12) = 0,845 ✓, rata-rata enam bulan = **90,1%** ✓; SC menang `[5, 11]` (hanya Jul & Agu) rata-rata = **8** ✓; absensi telat `[3,4,2,5,6,0]` rata-rata = **3,33 hari/bln** ✓.

Target kunjungan per hari: **12 visit/hari** pada contoh (PSR). ❓ Nilai untuk Supervisor/AM/Manager — OQ-7.

## 3. Band nilai per indikator

| Indikator | Band (Real → Nilai) | Status |
|---|---|---|
| Achievement Target | <80% → 40 · 80-89% → 55 · 90-99% → 70 · 100-109% → 85 · ≥110% → 100 | ⚠️ sama dengan Sales Hospital (`scoreSalesAchievement`); cocok dengan contoh (84,4% → 55) tetapi hanya satu titik data |
| Jumlah Kunjungan | <70% → 40 · 70-79% → 55 · 80-89% → 70 · 90-99% → 85 · ≥100% → 100 | ⚠️ sama dengan Call Activity Hospital (`scoreCallActivity`); cocok dengan contoh (90,1% → 85) tetapi hanya satu titik data |
| Jumlah SC Menang | ❓ tidak diketahui — contoh: 8 SC → 85 | ❓ OQ-2 |
| Absensi | ❓ tidak diketahui — contoh: 3,33 hari/bln → 40 (nilai terendah) | ❓ OQ-3 |

Belum boleh diimplementasikan sebelum OQ-2 dan OQ-3 dijawab: dua band ini tidak bisa ditebak dari satu titik data.

## 4. Tier rekomendasi kontrak

Total Score → rekomendasi, **identik** dengan `recommendContractMonths` (`src/lib/kpiScoring.ts:133`, sudah dibandingkan dengan `tierFor` di prototipe): `> 85` → 12 bln "Sangat Baik — diperpanjang"; `71 s/d 85` → 9 bln "Baik — diperpanjang"; `55 s/d < 71` → 6 bln "Perlu evaluasi"; `< 55` → 0 "Tidak direkomendasikan". Batas tepat 85 masuk tier 9 bulan, batas tepat 71 masuk tier 9, batas tepat 55 masuk tier 6.

## 5. Keputusan & persetujuan

Prototipe hanya punya tombol **"Setujui"** (menyetujui rekomendasi sistem). Memo Hospital §4-§6 (`docs/kpi-monitoring/01-business-rules.md`) mewajibkan lebih dari itu; spec ini mengasumsikan aturan yang sama berlaku untuk Non-Hospital (⚠️ OQ-8):

| Status | Arti |
|---|---|
| `BELUM_DIPUTUSKAN` | Belum ada keputusan. Rekomendasi sistem ditampilkan. |
| `DISETUJUI` | Atasan menyetujui **sesuai rekomendasi** (`decisionMonths = systemRecommendationMonths`). Alasan tidak wajib. |
| `DIUBAH` | Atasan memutuskan bulan **berbeda** dari rekomendasi. `decisionReason` **wajib** diisi (server action menolak kalau kosong). |

- **Rencana pengembangan** (`developmentPlanNotes`) **wajib** untuk kedua status di atas (memo §6).
- **Konfirmasi dua kali klik** sebelum menyimpan (pola prototipe: klik pertama mengubah tombol jadi "Klik lagi untuk konfirmasi" selama 3 detik).
- Transisi: `BELUM_DIPUTUSKAN → DISETUJUI | DIUBAH`. Setelah diputuskan, **tidak ada perubahan diam-diam**: mengubah keputusan membuat catatan baru (append-only, lihat `02-data-model.md` invariant), bukan menimpa.
- **Jalur gagal:** total score tidak bisa dihitung (data bermasalah kritis, §6) → rekomendasi kosong; atasan tetap boleh memutuskan sebagai `DIUBAH` dengan alasan (mis. "data belum lengkap, dievaluasi manual") — bukan dipaksa `DISETUJUI`.

## 6. Penanda data bermasalah

Baris "Bermasalah" = ada minimal satu catatan data. Aturan (dari isi kolom `catatan` di prototipe):

| Kondisi | Teks catatan | Efek |
|---|---|---|
| Visit atau hari kerja bulan X kosong/tidak valid | "Kunjungan: YYYYMM kosong/tidak valid; Hari kerja: YYYYMM kosong/tidak valid" | bulan itu dikeluarkan dari rata-rata kunjungan |
| Target bulan X = 0 / tidak ada | "Target beberapa periode = 0 sehingga ACH tidak dapat dihitung" / "Tidak ada data target dari MM YYYY" | bulan itu dikeluarkan dari rata-rata ACH |
| Data bulan tertentu belum ada, dipakai bulan lain | "Data digunakan dari bulan MM YYYY karena belum ada data MM YYYY" | tampil sebagai catatan; angka tetap dihitung |

Kartu ringkasan "Data Bermasalah" = jumlah baris dengan catatan; ikon ⚠️ di baris menampilkan teks catatan sebagai tooltip; filter status "Lengkap" / "Bermasalah".

## 7. Open questions — status & assumptions

Tiap pertanyaan: apa, asumsi sementara (kalau ada), dan siapa yang perlu menjawab. **Blocking** = kode tidak boleh dimulai sebelum dijawab.

| # | Pertanyaan | Asumsi sementara | Blocking | Penjawab |
|---|---|---|---|---|
| OQ-1 | **Memo/kebijakan resmi skema Non-Hospital** (indikator, bobot, band, aturan window) — ada dokumennya? Semua di atas diturunkan dari angka contoh prototipe. | Bobot 50/25/15/10 dan formula rata-rata bulanan seperti prototipe | ✅ sebagian | Pemegang memo / SM ETH |
| OQ-2 | **Apa itu "SC Menang" dan dari mana datanya?** Band nilainya? Kenapa contoh hanya punya Jul & Agu? | tidak ada — tidak bisa diasumsikan | ✅ **ya** | Pemegang memo Non-Hospital |
| OQ-3 | **Band nilai Absensi** dalam hari telat/bulan (contoh 3,33 → nilai 40). Dan apa definisi "telat" — sama dengan `AbsTelatYN = "Y"` SIPP (jumlah hari)? | hitung hari dengan `AbsTelatYN="Y"` per bulan dari SIPP | ✅ **ya** | Pemegang memo / HR |
| OQ-4 | **Window evaluasi**: contoh Mar-Agu 2026 untuk kontrak berakhir 1 Okt 2026 = 6 bulan penuh terakhir sebelum bulan evaluasi (Sep)? Bagaimana untuk kontrak yang baru < 6 bulan (contoh `periode_kontrak` 3/4)? | 6 bulan penuh terakhir sebelum bulan berakhir kontrak; kalau data < 6 bulan, pakai bulan yang ada | ❌ | Pemegang memo |
| OQ-5 | **Sumber akhir kontrak, lama kontrak (bulan), cabang.** File HR hanya punya tanggal masuk. | Diimpor dari Excel oleh ADMIN (mis. "Summary KPI Non Hospital.xlsx") sampai ada sumber otomatis | ✅ **ya** | Tim HR |
| OQ-6 | (sebagian terjawab 2026-09-25: personil Non-Hospital = `User` dengan `project = "OMEGA"`, wilayah/GT di `User.namaWilayah`; target `TargetNonHospitalValue` baru ada untuk 202608 dan 202609) **Pemetaan jabatan** PSR/Supervisor/Area Manager/Manager ke `User.role` dan struktur organisasi kita; apakah semuanya ada di tabel `User`? | Cocokkan lewat NIP + nama (lihat identitas NIP di `docs/kpi-monitoring/01-business-rules.md` §2d) | ❌ | Tim HR / user |
| OQ-7 | **Target visit/hari per jabatan** (contoh PSR = 12). | 12 untuk semua sampai dikonfirmasi | ❌ | Pemegang memo |
| OQ-8 | **Aturan keputusan** (alasan wajib, rencana pengembangan) berlaku sama seperti Hospital? Siapa evaluatornya (SM untuk ASM/SPV/MR, NSM untuk SM di Hospital)? | Berlaku sama; ADMIN-only untuk v1 | ❌ | Pemegang memo |
| OQ-9 | ✅ **Terjawab 2026-09-25:** sales aktual Non-Hospital = MSSQL `DIR10001B` dengan `DIVISI = 'OMG1'` (13.631 outlet; sync Hospital hanya `KAM1`). Uji GT "DEPOK 02", Agu 2026: aktual Rp133 jt vs target Rp142 jt = 94%. Disimpan di `OutletSalesValueMonthlyOmega` (`scripts/syncOmegaSalesValueMonthly.ts`); belum dijadwalkan otomatis. | — | ❌ (selesai) | User / tim data |
| OQ-10 | Prototipe menampilkan "Status Approval" tanpa nama/waktu pemberi persetujuan di tabel — perlu tampil di tabel/export? | Ya: nama pemberi + waktu | ❌ | User |
