# KPI Personil — Layout Final (Hospital + Non-Hospital)

*(Ditulis 2026-10-05. Sumber: mockup `internal/KPI Personil (Copy).html` — data dummy, hanya acuan layout/alur, bukan data/logic final. Status: **Leaderboard sudah diimplementasikan 2026-10-05** (`/kpi-leaderboard`, `getKpiLeaderboard` di `src/app/actions/kpi.ts`, `KpiLeaderboardView`) — periode = satu bulan (default bulan terakhir selesai), tanpa filter area dan tanpa ▲▼ pergerakan (menunggu Q3/Q7), hanya personil dengan 4 pilar lengkap yang diperingkat. **Detail KPI + form evaluasi + export diimplementasikan 2026-10-05** (`/kpi-detail`, `/kpi-detail/[nip]`, `src/app/actions/kpiDetail.ts`, `/api/kpi-personil/export`; migration `20261005100000_kpi_evaluation_direction_rationale` — **harus dijalankan sebelum halaman dipakai**). Keputusan yang dipakai: window evaluasi = 6 bulan selesai terakhir (belum ada data kontrak Hospital, §7 Q3), atasan = `User.nipAtasan` langsung (SM/NSM; ADMIN semua), satu keputusan per personil per window dan terkunci (Q4 default), `KpiContractEvaluation` dipakai untuk Hospital dan Non-Hospital. Kartu Hospital kini memuat rincian per outlet / per MR (Sales), matriks PSSP per bulan atau customer per MR (Customer), record absensi harian dari SIPP (live, ≤6 panggilan per kartu), sparkline pilar, kolom point per pilar di rekap, dan Leaderboard punya filter area + ▲▼ (area = `Outlet.namaArea`/`namaReg` tim; ▲▼ butuh compute bulan sebelumnya, jadi Leaderboard menghitung dua bulan company-wide). **Belum ada:** periode "rata-rata kontrak" (tidak ada data kontrak Hospital), PTID SIPP & kontrak sebelumnya di profil, rincian Non-Hospital per outlet. **Non-Hospital:** Point total selalu kosong karena band SC Menang & Absensi belum dikonfirmasi (`nonHospitalScoring.ts`, OQ-2/OQ-3) — Leaderboard Non-Hospital akan kosong sampai band itu ada. Menggantikan §2 "Halaman" di [`03-ui-and-access.md`](./03-ui-and-access.md) untuk bagian yang bertentangan; sisanya (role matrix, non-goals) tetap berlaku sampai keputusan di §7 diambil.)*

## 1. Ringkasan perubahan dari kode sekarang

Sekarang: dua halaman terpisah (`/kpi-perpanjangan` Hospital, `/evaluasi-kontrak-non-hospital`), masing-masing satu tabel flat per periode + input manual inline (`KpiSchemeHeader` dengan tab link antar route).

Final: satu produk **"KPI Personil"** dengan dua halaman, masing-masing mendukung skema Hospital dan Non-Hospital:

| Halaman | Isi | Siapa |
|---|---|---|
| **Leaderboard** | Tab skema (Hospital / Non-Hospital) → stat ringkas → Top 3 → tabel peringkat. **Point saja**, tanpa rincian data mentah, tanpa tombol buka detail. | Semua orang (lihat §7 Q1) |
| **Detail KPI** | Daftar **bawahan langsung** penilai yang login → klik baris → kartu detail per personil (profil, rekap bulanan, rincian per pilar, form evaluasi) dengan navigasi ← sebelumnya / berikutnya →. | Atasan (SM→ASM/SPV/MR, NSM→SM; Non-Hospital: atasan per wilayah) |

**Menu:** satu entri sidebar "KPI Personil" (`/kpi-leaderboard`, aktif juga di `/kpi-detail`, `/kpi-perpanjangan`, `/evaluasi-kontrak-non-hospital`); perpindahan halaman lewat `KpiPageNav` (Leaderboard · Detail KPI · Monitoring Bulanan, hanya yang boleh dibuka role tsb).

Navigasi atas (mockup): breadcrumb `KPI Personil / Leaderboard / Hospital`, h1, tab skema (hanya di Leaderboard), dan dua tombol halaman ("Leaderboard — Semua orang · point saja", "Detail KPI — Khusus atasan · bawahan langsung"). Selector "Simulasi: masuk sebagai" di mockup **hanya alat demo** — tidak dibangun; di aplikasi nyata penilai = user yang login.

## 2. Leaderboard

### Hospital
- **Stat row**: Personil, Rata-rata Point, Point tertinggi, Point terendah (untuk periode terpilih).
- **Toolbar**: periode (`Rata-rata kontrak` default, atau satu bulan dalam window kontrak), segmen role (Semua/MR/SPV/ASM/SM), area, pencarian nama/NIP.
- **Top 3** (podium, non-klik).
- **Tabel**: `#` (+ pergerakan ▲▼ vs bulan sebelumnya, hanya saat periode = satu bulan, bukan rata-rata), Personil (nama, NIP · role), Area, **Point per pilar** (Sales 50 / Call Activity 25 / Customer Aktif 15 / Absensi 10, yaitu `nilai band × bobot`), Point total (maks 100).
- Rank dihitung dari seluruh personil, bukan hasil filter (nomor tidak berubah saat filter dipakai).

### Non-Hospital
- Stat row sama. Toolbar: segmen jabatan (Semua/PSR/Supervisor/Area Manager/Manager), urut (Point tertinggi / Nama A–Z), pencarian nama/NIP/cabang.
- Tabel: `#`, Personil, Jabatan, Cabang, Point (satu angka total — skema NH tidak menampilkan point per pilar di leaderboard).

## 3. Detail KPI — daftar bawahan

- **Lockbar**: "Masuk sebagai {nama · jabatan wilayah}. Halaman ini hanya menampilkan N bawahan langsung; personil lain tidak dapat dibuka."
- **Stat row**: Bawahan langsung, Sudah dievaluasi (x/N), Belum dievaluasi, Rata-rata Point.
- **Tabel klik-baris**: Personil, Jabatan, Area/Cabang, Periode (bln), Akhir kontrak, Point, **Status data** (Lengkap / ⚠ Bermasalah + tooltip catatan), Rekomendasi (`12 bln · Sangat Baik`), Keputusan (✓ durasi / Belum dievaluasi), `›`.
- Urutan: belum dievaluasi dulu, lalu Point tertinggi.
- Tombol **Export Excel · semua bawahan**.
- Setelah kembali dari kartu detail, baris terakhir yang dibuka di-flash dan scroll position dipulihkan.

## 4. Detail KPI — kartu personil

Sticky **action bar**: `← Daftar bawahan` · Export Excel (kartu ini) · `n / N` · `‹ Sebelumnya` · `Berikutnya ›`. Pintasan keyboard: Esc = kembali, ←/→ = sebelumnya/berikutnya (nonaktif saat fokus di input/textarea/select). Di bawahnya **jump bar** anchor ke tiap section.

### 4.1 Hospital (jump bar: Profil & Kontrak · Rekap Bulanan · Sales · Call Activity · Customer Aktif · Absensi · Evaluasi Atasan)

1. **Profil & Kontrak** — avatar inisial, nama, NIP · role · GT · area; badge (evaluasi kontrak ke-n, kelengkapan data x/N bulan, rekomendasi, disetujui bila sudah); Point rata-rata `/ 100`; grid: penilai, atasan langsung, kontrak berjalan, kontrak sebelumnya, periode evaluasi, outlet dikelola (atau jumlah MR/SPV untuk ASM/SM), standar kunjungan, PTID SIPP; **4 kartu pilar** (point/bobot, nilai mentah rata-rata, sparkline per bulan); tabel point total per bulan + rata-rata.
2. **Rekap Bulanan** — satu tabel lebar, satu baris per bulan dalam window kontrak: Sales (target, aktual, %, band, point), Call Activity (real/std, %, band, point), Customer Aktif (jumlah, band, point), Absensi (reporting, band, point), Total Point; footer rata-rata. Band ditampilkan sebagai chip SR/R/S/T/ST.
3. **Sales Achievement** — rincian aktual per outlet (MR/SPV) atau per MR/SPV bawahan (ASM/SM) × bulan; footer: total aktual, target, achievement, band · point. Sumber ditulis di bawah judul section.
4. **Call Activity** — per bulan: standar, realisasi, achievement, band, point, **sumber (EXODUS_SYNC / MANUAL)**, diinput oleh, waktu.
5. **Customer Aktif** — MR/SPV: daftar kontrak PSSP aktif (kode, customer+spesialisasi, outlet, mulai/berakhir) × matriks ✓/– per bulan + status kontrak per bulan terakhir; ASM/SM: tabel customer aktif per MR/SPV bawahan, dirata-rata dan dibulatkan.
6. **Absensi** — tabel per bulan (record, hari telat, total jam telat, rata-rata, band, point) + **record kehadiran harian** per bulan (segmen bulan, tabel scroll: tanggal, hari, check-in, telat Y/N, jam telat; baris telat berwarna merah) + footer rumus (Σ jam telat ÷ record).
7. **Evaluasi Atasan** — lihat §5.

Setiap section memuat legenda band/rumus di bawah tabelnya (teks identik dengan `01-business-rules.md`).

### 4.2 Non-Hospital (jump bar: Profil & Kontrak · Achievement · Kunjungan · SC Menang · Absensi · Ringkasan · Evaluasi Atasan)

- **Profil**: badge Data lengkap / ⚠ Data bermasalah, rekomendasi; Point total; grid periode kontrak, awal, akhir, cabang; 4 kartu pilar bila rincian bulanan tersedia.
- Section per indikator (Achievement Target 50%, Jumlah Kunjungan 25%, Jumlah SC Menang 15%, Absensi 10%) berupa tabel bulanan + baris legenda `Real FF · Nilai · Bobot · Point`; section **Ringkasan perhitungan** (Real FF × nilai band × bobot, total).
- Bila rincian bulanan **belum tersedia** untuk personil itu: tampilkan kartu kosong "Rincian bulanan belum tersedia" + `catatan` data; section Evaluasi tetap muncul.
- Catatan data bermasalah (`catatan`) ditampilkan sebagai note amber.

## 5. Form Evaluasi Atasan (bersama Hospital & Non-Hospital)

Field (urutan layout): Keputusan perpanjangan (12 / 9 / 6 bulan / Tidak diperpanjang; opsi yang sama dengan rekomendasi diberi label "(rekomendasi)"), kotak **Rekomendasi sistem** (durasi, label band, Point), Penilai (read-only), Penjelasan keputusan, Evaluasi rencana pengembangan personil (**wajib selalu**), Rasionalisasi perpanjangan ke direksi.

Aturan (sudah konsisten dengan spec existing):
- Rekomendasi: >85 → 12 bln · 71–85 → 9 · 55–70 → 6 · <55 → tidak diperpanjang (`01-business-rules.md` §4).
- Penjelasan keputusan **wajib** bila keputusan ≠ rekomendasi; hint inline "Sesuai rekomendasi sistem" / "Berbeda dari rekomendasi: penjelasan wajib diisi".
- Tombol "Setujui Perpanjangan" butuh **klik dua kali** (konfirmasi, reset otomatis setelah 3 detik).
- Draft form dipertahankan saat berpindah kartu/refresh render (di mockup: state sementara; implementasi: state client, tidak perlu disimpan ke DB).
- Setelah disimpan: form diganti **kotak "✓ Disetujui: perpanjangan N bulan · waktu"** + keterangan sesuai/berbeda dari rekomendasi + tampilan read-only ketiga field teks. Tidak bisa diedit dari UI (koreksi → lihat §7 Q4).

## 6. Export Excel

- **Semua bawahan** (satu sheet): No, Nama, NIP, Jabatan, Area/Cabang, Periode kontrak, Akhir kontrak, Point (Hospital: per pilar + total), status data/catatan (NH), Rekomendasi (bulan + label), Keputusan, Status, Penilai.
- **Satu kartu** (multi-sheet): Profil (+ keputusan bila ada), Rekap Bulanan, Sales, Call Activity, Customer Aktif, Absensi Harian (Hospital) / Ringkasan, Achievement Target, Kunjungan, SC Menang, Absensi, Catatan Data (Non-Hospital).
- Mockup membangun XLSX di client (SheetJS). Implementasi mengikuti pola `export/team/route.ts` (server route) — tidak menambah dependency client.
- Server route harus memakai **check akses yang sama** dengan halaman Detail KPI (hanya bawahan langsung) — export tidak boleh jadi jalan memutar membaca personil lain.

## 7. Gap terhadap kode sekarang & keputusan terbuka

| Area | Kondisi sekarang | Dibutuhkan layout final |
|---|---|---|
| Struktur halaman | 2 route per skema (`/kpi-perpanjangan`, `/evaluasi-kontrak-non-hospital`) | 2 halaman (Leaderboard, Detail KPI) × 2 skema; route lama jadi tab/redirect |
| Leaderboard | Tidak ada | Baru, point-only, peringkat + podium |
| Detail per personil | Tidak ada (tabel flat) | Baru; data mentah per pilar sudah ada di query monitoring, sebagian perlu diekspos |
| Form evaluasi | Hospital: model `KpiContractEvaluation` ada, **tidak ada kode**; NH: `KpiNonHospitalEvaluation` + `NhEvalTable` ada | Satu form bersama; Hospital perlu server action |
| Role matrix | `requireAdmin()` untuk tulis; baca sudah terbuka MR/ASM/SM/NSM (subtree) | Lihat Q1–Q2 |

**Pertanyaan yang harus dijawab sebelum implementasi** (tidak ada di mockup, tidak boleh ditebak):

1. ✅ **Diputuskan 2026-10-05 (pengguna): semua role login bisa melihat Leaderboard** (sesuai mockup), termasuk MR — point per pilar + total saja, tanpa rincian data mentah. Ini pengecualian sengaja dari role matrix §1 `03-ui-and-access.md` (MR self-view only) dan non-goal §4 (self-view MR ditahan); berlaku hanya untuk Leaderboard, bukan Detail KPI. Query Leaderboard company-wide → wajib ikuti `docs/PERFORMANCE.md`.
2. ✅ **Diputuskan 2026-10-05 (pengguna): atasan Non-Hospital dari struktur organisasi, sama seperti Hospital** — `User.nipAtasan` (project-agnostic, `src/lib/authz.ts` BFS). "Bawahan langsung" = `nipAtasan = penilai`. Pengelompokan wilayah/Regional Manager di mockup adalah dummy, tidak dibangun.
3. **Window kontrak Hospital (Non-Hospital sudah ada: `NonHospitalContract`, diimpor ADMIN dari Excel via `scripts/importNonHospitalContracts.ts` karena master HR tidak memuat tanggal kontrak).** Mockup mem-hardcode window `2026-04 s/d 2026-09` untuk semua personil dan "kontrak sebelumnya" ditulis tangan. Hospital tidak punya model kontrak (NH punya `NonHospitalContract`). Perlu sumber tanggal awal/akhir kontrak Hospital (impor seperti NH?) — tanpanya "Rata-rata kontrak", "Evaluasi kontrak ke-n", dan "Akhir kontrak" tidak bisa dihitung. Terkait pertanyaan terbuka §5 `01-business-rules.md` (bulan dengan data tidak lengkap).
4. **Koreksi keputusan.** Mockup: sekali "Setujui" form terkunci. `KpiNonHospitalEvaluation` append-only (koreksi = baris baru); `KpiContractEvaluation` belum punya status/versi. Tentukan: apakah ADMIN boleh membatalkan/mengoreksi, dan apakah Hospital ikut pola append-only NH.
5. **Label "Disetujui" vs data model.** Mockup menyebut "Setujui Perpanjangan" bahkan saat keputusan = "Tidak diperpanjang" dan di `KpiNonHospitalEvaluation` status = `DISETUJUI | DIUBAH`. Tetap pakai istilah itu di UI, atau ganti "Simpan Keputusan" agar tidak janggal untuk keputusan tidak diperpanjang.
6. **Rincian bulanan NH hanya ada untuk 1 personil di mockup** (berkas evaluasi individual P250021). Layout menangani kasus kosong (§4.2), tetapi perlu dikonfirmasi: apakah data bulanan NH untuk semua personil sudah tersedia lewat monitoring bulanan OMEGA (commit `058b7a2`), atau bagian ini tetap kosong untuk sebagian besar personil di v1.
7. **Pergerakan peringkat ▲▼** dihitung dari rank bulan sebelumnya di mockup — butuh skor bulan sebelumnya untuk semua personil (query company-wide). Wajib ikuti `docs/PERFORMANCE.md` untuk Leaderboard (scope seluruh perusahaan).

## 8. Non-goals (tidak ada di mockup, tidak dibangun)

- Selector "Simulasi: masuk sebagai" dan semua data dummy/generator di mockup (`genMR`, `genMGR`, `HOSP_DEF`, dst.).
- Penyimpanan approval via `claude.use('db')` — diganti server action + Prisma.
- Animasi transisi stage (opsional, hormati `prefers-reduced-motion` bila dibuat).
- Dark mode token mockup — pakai token tema app yang sudah ada (`var(--color-*)`).

## 9. Rantai approval, Summary, PDF — mockup `KPI Personil (Copy) (1).html` (final 2026-10-06)

Mockup versi terbaru menggantikan evaluasi satu langkah (§5) dengan **rantai approval berjenjang**. Rantai dinyatakan final oleh pengguna (2026-10-06). Role "Sales Director" = `Role.SD` yang sudah ada.

**Rantai** (menurut role yang dinilai; berlaku Hospital dan Non-Hospital karena hierarki sama, `User.nipAtasan`):

| Dinilai | Rantai approval | Pengisi evaluasi |
|---|---|---|
| MR / SPV | ASM → SM → NSM | SM |
| ASM | SM → NSM | SM |
| SM | NSM | NSM |

- Menyimpan evaluasi = approval pertama bila pengisinya ada di rantai (SM untuk MR/SPV/ASM, NSM untuk SM). Lalu atasan lain di rantai menekan "Setujui sebagai {role}". **Urutan antar langkah tidak dipaksa** (mockup: tiap atasan boleh menyetujui kapan pun, hanya sekali) — asumsi dari kode mockup, bukan keputusan eksplisit.
- Status: "Belum dievaluasi" · "Disetujui SM, menunggu ASM & NSM" · "Disetujui lengkap". Keputusan baru **final** ("disetujui") hanya bila **semua** langkah rantai sudah menyetujui.
- Daftar Detail KPI: badge "Perlu tindakan Anda" dan baris itu diurutkan paling atas.
- **Akses Detail KPI**: ASM/SM/NSM = seluruh bawahan di subtree (bukan hanya langsung; mockup `subsOf`), ADMIN dan SD = semua personil (SD **hanya-baca**, tanpa tombol evaluasi/approval). ADMIN dapat bertindak sebagai pengisi evaluasi dan sebagai langkah pending pertama (override, tercatat dengan NIP-nya).
- **PIC** di mockup tidak ada sebagai role di sistem → dipetakan ke **ADMIN** (asumsi; belum dikonfirmasi).
- **Data**: tabel baru `KpiEvaluationApproval(evaluationId, step, approvedByNip, approvedAt, unique(evaluationId, step))`; `KpiContractEvaluation` tetap satu baris per personil per window.
- **Summary** (NSM, SD, ADMIN; Hospital): hanya personil yang sudah disetujui lengkap; rata-rata Point final per jabatan, daftar yang diperpanjang, tabel per jabatan dengan peringkat leaderboard.
- **PDF**: Form Approval per personil dan PDF Summary.
- Istilah "Rata-rata" → "Point final" di seluruh kartu; kolom "Join date" menggantikan "Kontrak sebelumnya"/"Periode evaluasi"/"Standar kunjungan"/"PTID".
