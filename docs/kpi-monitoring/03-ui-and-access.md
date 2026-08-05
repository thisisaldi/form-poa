# KPI Monitoring — UI & Access

*(Halaman inti diimplementasikan 2026-07-30 — lihat status per bagian di bawah. Form Evaluasi Kontrak dan role matrix akhir masih berupa proposal, belum diimplementasikan.)*

## 1. Role & visibility — menggunakan ulang `src/lib/authz.ts`

Mengikuti pola yang sama dengan Monitoring/Summary: jangan membuat RBAC baru, generalisasi dari `getSubordinateMRNips(actor)` yang sudah menjadi "single source of truth". Untuk KPI Monitoring, scope-nya sedikit berbeda karena personil yang dinilai bukan hanya MR — mencakup ASM & SM juga (§1 `01-business-rules.md`).

🟡 **Status implementasi (2026-08-05)**: role matrix di bawah ini adalah **target akhir**, belum sepenuhnya diimplementasikan. Kode v1 (`requireAdmin()`, `src/app/actions/kpi.ts:31-37`) hanya menerapkan satu baris paling bawah tabel ini (ADMIN penuh) — seluruh baris lain (MR/ASM/SM/NSM/GM/SFE/VIEWER) belum di-enforce di kode; setiap peran non-ADMIN yang mengakses server action ini akan menerima error "KPI Monitoring is ADMIN-only for now." Helper `getSubordinatePersonnelNips(actor)` yang disebut sebagai kebutuhan untuk role matrix akhir **belum dibuat** — subtree ASM/SM di v1 memakai `getSubordinateMRNips` yang sudah ada (dipanggil ulang per role via `subordinateMrNips()`, `src/app/actions/kpi.ts:147-155`), karena kebutuhan v1 baru sebatas menjumlahkan/rata-ratakan data MR di bawah suatu ASM/SM untuk ditampilkan ke ADMIN, bukan menentukan akses.

| Role viewer | Bisa melihat KPI siapa | Bisa input/edit KPI siapa |
|---|---|---|
| MR | Diri sendiri (read-only) | — |
| ASM | Diri sendiri + MR/SPV di bawahnya (read-only untuk semua) | — (ASM bukan evaluator menurut memo §6) |
| SM | Diri sendiri + ASM/SPV/MR subtree | **ASM/SPV/MR** langsung di bawahnya (input Call Activity/Absensi manual, mengisi `KpiContractEvaluation`) |
| NSM | SM/ASM/SPV/MR subtree | **SM** langsung di bawahnya |
| GM / SFE / VIEWER | Company-wide, read-only | — |
| ADMIN | Company-wide | Semua (override/koreksi data) |

Ini berbeda dari pola approval POA yang sudah ada (`canEdit`/`canApprove` di `authz.ts`) — KPI bukan dokumen berjenjang yang di-submit/approve, melainkan evaluasi searah dari atasan langsung ke bawahan. Jangan menggunakan ulang `PoaStatus`/workflow approval yang ada; ini membutuhkan access-check baru yang lebih sederhana (atasan-langsung-saja, bukan seluruh chain).

## 2. Halaman

### "Monitoring KPI Perpanjangan" — 🟢 diimplementasikan, halaman baru terpisah dari `/monitoring` existing

**Diputuskan 2026-07-30 (pengguna):** halaman baru, bukan tab tambahan di `/monitoring`. Nama halaman: **"Monitoring KPI Perpanjangan"** — nama ini secara eksplisit menegaskan tujuan utamanya (dasar keputusan perpanjangan kontrak), berbeda dari `/monitoring` existing yang murni berisi "Target vs Sales Actual".

Route: `src/app/(app)/kpi-perpanjangan/page.tsx` → path `/kpi-perpanjangan`. Terdaftar di sidebar (`src/components/layout/Sidebar.tsx`) sebagai item "Monitoring KPI Perpanjangan".

**v1 access (diputuskan 2026-07-30): ADMIN-only**, mengikuti pola yang sama seperti `/monitoring` yang juga masih dibatasi ADMIN selama "sedang direview" — diverifikasi di kode: `requireAdmin()` (`src/app/actions/kpi.ts:31-37`). Role matrix di §1 tetap menjadi target akhir (SM menilai ASM/SPV/MR, NSM menilai SM, dan seterusnya) tetapi belum dibuka ke role lain sampai halaman ini dianggap matang — perluasan akses mengikuti keputusan bisnis di kemudian hari, mengikuti pola komentar di kode `monitoring/page.tsx:56-58`.

Isi yang sudah berjalan (diverifikasi terhadap `src/app/(app)/kpi-perpanjangan/page.tsx`):
- **Pemilih periode** (`KpiPeriodPicker`, `src/components/kpi/KpiPeriodPicker.tsx`) — dropdown 12 bulan terakhir termasuk bulan berjalan, via query string `?period=YYYY-MM` (`kpi-perpanjangan/page.tsx:41-43`). Ini satu-satunya filter yang ada di v1 — tidak ada filter area/personil.
- **Ringkasan statistik** (`KpiDashboardStats`, `src/components/kpi/KpiDashboardStats.tsx`) — ditampilkan di atas tabel.
- **Tabel listing** (`src/components/kpi/KpiTable.tsx`) — satu baris per personil aktif (MR/ASM/SM) untuk periode terpilih, kolom: Nama+NIP, Role/Jabatan, 4 skor pilar (Sales/Activity/Customer/Absensi beserta nilai mentah dan band score), Total Score, Rekomendasi Kontrak (warna sesuai band §4 `01-business-rules.md`), dan kolom Input Manual. Menggunakan ulang `SortableTh`/`compareSortValues` (`src/components/ui/SortableTh.tsx`) untuk sort per kolom.
- **Form input manual Call Activity/Absensi** (`ManualInputRow`, `src/components/kpi/KpiTable.tsx:28-91`) — inline per baris tabel (bukan modal/halaman terpisah seperti yang semula diusulkan), memanggil `saveKpiManualInputAction` (`src/app/actions/kpi.ts:232-277`).

Isi yang **belum dibangun** (masih proposal):
- **Drill-down per baris** → detail 4 pilar, riwayat bulanan dalam periode kontrak berjalan, tombol "Isi Evaluasi Kontrak". Belum ada di kode; `KpiTable.tsx` saat ini hanya menampilkan satu baris flat per personil per periode, tanpa ekspansi/detail.
- Filter area/personil melalui popup bergaya `MonitoringFilterModal` — tidak ada di `kpi-perpanjangan/page.tsx` (hanya filter periode, lihat di atas); jika ditambahkan, ikuti pola query-string yang sama.

### Form Evaluasi Kontrak (`KpiContractEvaluation`) — ⬜ belum dibangun

Proposal, belum ada implementasi (lihat `02-data-model.md` §3 — model sudah ada di schema tetapi belum ada kode yang menulis/membacanya):

- Menampilkan rata-rata 4 skor pilar selama window kontrak berjalan + `systemRecommendationMonths` (read-only, hasil hitung otomatis).
- Field `decisionMonths` (default = rekomendasi sistem, dapat diubah atasan).
- Field `decisionReason` — **wajib** apabila `decisionMonths != systemRecommendationMonths` (validasi di server action, mengikuti pola yang sama seperti alasan wajib pada `rejectPoa()`/`cancelApprovedByNsm()` di `poaWorkflow.ts`).
- Field `developmentPlanNotes` — **selalu wajib** per memo ("wajib mengisi Evaluasi Rencana Pengembangan Personil serta rasionalisasi... dilengkapi dengan data dan fakta").
- Lihat `01-business-rules.md` §5 "Tahapan siklus evaluasi kontrak" untuk urutan tahapan yang perlu didukung form ini, termasuk pertanyaan terbuka (❓) mengenai penanganan bulan dengan data tidak lengkap.

## 3. Export

Menggunakan ulang pola `export/team/route.ts` (multi-sheet Excel) — menambah sheet baru "KPI Personil" apabila tim meminta export, bukan endpoint terpisah. Tidak masuk scope v1 kecuali diminta secara eksplisit. ⬜ Belum dibangun, tidak ada kode terkait.

## 4. Non-goals v1

Diverifikasi ulang terhadap kode dan `docs/TODO.md` #67 (2026-08-05) — seluruh butir di bawah masih akurat, tidak ada yang sudah dibangun sejak ditulis:

- Tidak membangun notifikasi/reminder otomatis ke atasan untuk mengisi evaluasi (dapat menjadi item lanjutan).
- Tidak membangun dashboard tren historis lintas-kontrak (grafik multi-periode) — cukup tabel riwayat bulanan per personil pada drill-down (yang drill-down-nya sendiri juga belum dibangun, lihat §2 di atas).
- **Dashboard self-view untuk MR** (personil dapat melihat KPI perpanjangan diri sendiri) — **dikonfirmasi 2026-07-30 (pengguna): ini memang fitur yang diinginkan ke depannya, TETAPI sengaja belum ditampilkan/dibangun sekarang.** Ditahan sampai halaman ADMIN-only ini dianggap matang (sejalan dengan alasan `/monitoring` yang juga masih ADMIN-only — lihat §2). Apabila dikerjakan nanti: MR melihat scorecard diri sendiri secara read-only (baris dirinya sendiri dari tabel yang sama, bukan halaman terpisah) — sesuai dengan role matrix target di §1 (`MR: Diri sendiri (read-only)`), sehingga infrastrukturnya (role matrix, scoring engine, data model) sudah siap, tinggal membuka akses dan membangun view read-only-nya begitu waktunya tiba.
- Role matrix akhir (SM/NSM sebagai evaluator, lihat §1) — belum di-enforce, masih ADMIN-only. Ini bukan non-goal permanen, melainkan tahap berikutnya yang sengaja ditunda sampai halaman ADMIN-only dianggap matang (alasan yang sama dengan poin self-view MR di atas).
- Form Evaluasi Kontrak (§2 di atas) dan drill-down per baris — belum dibangun, lihat catatan status implementasi di §2.
