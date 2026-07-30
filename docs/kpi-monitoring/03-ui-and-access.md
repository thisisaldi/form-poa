# KPI Monitoring — UI & Access

*(Proposal, belum diimplementasi.)*

## 1. Role & visibility — reuse `src/lib/authz.ts`

Sama pola dengan Monitoring/Summary: jangan bikin RBAC baru, generalisasi dari `getSubordinateMRNips(actor)` yang sudah jadi "single source of truth". Untuk KPI Monitoring, scope-nya sedikit beda karena orang yang dinilai bukan cuma MR — meliputi ASM & SM juga (§1 `01-business-rules.md`). Perlu helper baru yang serupa polanya, misal `getSubordinatePersonnelNips(actor)`:

| Role viewer | Bisa lihat KPI siapa | Bisa input/edit KPI siapa |
|---|---|---|
| MR | Diri sendiri (read-only) | — |
| ASM | Diri sendiri + MR/SPV di bawahnya (read-only untuk semua) | — (ASM bukan evaluator menurut memo §6) |
| SM | Diri sendiri + ASM/SPV/MR subtree | **ASM/SPV/MR** langsung di bawahnya (input Call Activity/Absensi manual, isi `KpiContractEvaluation`) |
| NSM | SM/ASM/SPV/MR subtree | **SM** langsung di bawahnya |
| GM / SFE / VIEWER | Company-wide, read-only | — |
| ADMIN | Company-wide | Semua (override/koreksi data) |

Ini beda dari pola approval POA yang ada (`canEdit`/`canApprove` di `authz.ts`) — KPI bukan dokumen berjenjang yang di-submit/approve, tapi evaluasi searah dari atasan langsung ke bawahan. Jangan reuse `PoaStatus`/workflow approval yang ada; ini butuh access-check baru yang lebih sederhana (atasan-langsung-saja, bukan seluruh chain).

## 2. Halaman yang diusulkan

### "Monitoring KPI Perpanjangan" — halaman baru, terpisah dari `/monitoring` existing

**Diputuskan 2026-07-30 (user):** halaman baru, bukan tab tambahan di `/monitoring`. Nama halaman: **"Monitoring KPI Perpanjangan"** — nama ini eksplisit menegaskan tujuan utamanya (dasar keputusan perpanjangan kontrak), beda dari `/monitoring` existing yang murni "Target vs Sales Actual".

Route yang diusulkan: `src/app/(app)/kpi-perpanjangan/page.tsx` → path `/kpi-perpanjangan`. Masuk sidebar (`src/components/layout/Sidebar.tsx`) sebagai item baru "Monitoring KPI Perpanjangan".

**v1 access (diputuskan 2026-07-30): ADMIN-only**, sama pola seperti `/monitoring` yang juga masih dibatasi ADMIN selama "sedang direview". Role matrix di §1 tetap jadi target akhir (SM menilai ASM/SPV/MR, NSM menilai SM, dst) tapi belum di-buka ke role lain sampai halaman ini dianggap matang — widen sesuai keputusan bisnis nanti, ikuti pola komentar di kode `monitoring/page.tsx:56-58`.

Isi:
- **Tabel listing** — 1 baris per personil per periode terpilih, kolom: Nama, Role/Jabatan, Area, 4 skor pilar, Total Score, Rekomendasi Kontrak (badge warna sesuai band §4). Reuse `SortableTh`/`compareSortValues` (`src/components/ui/SortableTh.tsx`) untuk sort per kolom, dan pola `MonitoringFilterModal` (period/area/personil filter via query string) untuk filter popup.
- **Drill-down per baris** → detail 4 pilar (nilai mentah + band + score), riwayat bulanan dalam periode kontrak berjalan, tombol "Isi Evaluasi Kontrak" (khusus atasan langsung, lihat §1) yang membuka form `KpiContractEvaluation`.
- **Form input manual Call Activity/Absensi** — khusus atasan langsung, per personil per bulan berjalan (bukan bagian dari listing utama, halaman/modal terpisah supaya tidak mengganggu alur baca scorecard).

### Form Evaluasi Kontrak (`KpiContractEvaluation`)

- Tampilkan rata-rata 4 skor pilar selama window kontrak berjalan + `systemRecommendationMonths` (read-only, hasil hitung otomatis).
- Field `decisionMonths` (default = rekomendasi sistem, bisa diubah atasan).
- Field `decisionReason` — **wajib** kalau `decisionMonths != systemRecommendationMonths` (validasi di server action, pola sama seperti alasan wajib di `rejectPoa()`/`cancelApprovedByNsm()` di `poaWorkflow.ts`).
- Field `developmentPlanNotes` — **selalu wajib** per memo ("wajib mengisi Evaluasi Rencana Pengembangan Personil serta rasionalisasi... dilengkapi dengan data dan fakta").

## 3. Export

Reuse pola `export/team/route.ts` (multi-sheet Excel) — tambah sheet baru "KPI Personil" kalau tim minta export, bukan endpoint terpisah. Tidak masuk scope v1 kecuali diminta eksplisit.

## 4. Non-goals v1

- Tidak membangun notifikasi/reminder otomatis ke atasan untuk mengisi evaluasi (bisa jadi item lanjutan).
- Tidak membangun dashboard tren historis lintas-kontrak (grafik multi-periode) — cukup tabel riwayat bulanan per personil di drill-down.
