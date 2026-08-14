# POA Standarisasi — Spec Index

*(Ditulis 2026-08-13, mengikuti proses Spec-Driven Development di `docs/sdd/`. Sumber requirement: **materi teknis dari pihak eksternal** — `README_INTEGRASI (1).md` + `Preview_UI_POA_Standarisasi_v12 (1).html`, dilampirkan pengguna [m.naufaldi.aldi@gmail.com] pada 2026-08-13 (disalin apa adanya ke `source/` di folder ini). Ini BUKAN memo resmi dari stakeholder bisnis — ini adalah proposal desain/kode siap-drop yang sudah cukup matang (skema Prisma, server actions, wizard UI 4-phase), tapi ditulis oleh pihak yang tidak punya akses penuh ke codebase saat ini, jadi berisi asumsi yang perlu diverifikasi ulang terhadap kode nyata dan dikonfirmasi ke tim bisnis sebelum diimplementasikan.)*

Trigger SDD yang terpenuhi (lihat `docs/sdd/01-when-and-workflow.md`): sumber dari materi eksternal, model data baru (`PoaStandarisasi*`, `Distributor`), role/access matrix baru (approval ASM→SM di luar chain regular POA), dan ambiguitas nyata bertanda ⚠️/❓ langsung di dokumen sumbernya sendiri.

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — definisi istilah, formula, lifecycle 4-phase, dan open questions.
2. [`02-data-model.md`](./02-data-model.md) — skema Prisma yang diusulkan (model baru vs reuse), invariant.
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — halaman, role/akses, pola UI yang di-reuse dari POA Estimasi.

## Status

⬜ **Belum dimulai — spesifikasi masih draft, belum ada kode implementasi.** Tidak ada file `PoaStandarisasi*`, tidak ada route `/poa-standarisasi/*`, tidak ada model `Distributor` di `prisma/schema.prisma` saat spesifikasi ini ditulis (diverifikasi langsung terhadap kode 2026-08-13, bukan diasumsikan dari dokumen sumber).

🟢 **Ke-4 open question BLOCKING sudah dijawab pengguna (2026-08-14)** — convergence check selesai, implementasi v1 sudah bisa dimulai. Ringkasan keputusan (detail & rationale di `01-business-rules.md` §7):
1. "Golongan yang Dipakai Saat Ini" **per dokter**, reuse `getSurveyRekomendasiInfo(kodeCustomer, kodePI, kodeProduk)` (`customer.ts:763`) persis seperti "Produk Kompetitor Utama" di POA Estimasi — bukan agregat per outlet, dan **tidak disimpan sebagai FK snapshot** (live-derive saat render, sama seperti POA Estimasi tidak menyimpan FK ke `SurveyRekomendasi` di `PoaLineItem`).
2. Approval Atasan **blocking**, berhenti di SM (tidak eskalasi ke NSM) — ASM approve dulu baru SM bisa approve, pengajuan tidak lanjut ke Phase 3 sebelum keduanya `DISETUJUI`.
3. Approver Phase 2 mengikuti **struktur organisasi** (`nipAtasan` chain milik MR pembuat pengajuan) — reuse mekanisme hierarki yang sudah ada di `authz.ts`, termasuk resolusi vacant-team yang sama dipakai `Outlet.coveredByNip`/`coveredByRole`.
4. Formula **TIDAK** dikalikan `periodeBulan` — field `estimasiNilaiRp`/`estimasiQty`/dst. adalah nilai **PER BULAN**, bukan potensi total. Field & label di-rename eksplisit jadi "per Bulan" di seluruh spec supaya tidak disalahartikan sebagai total (lihat `02-data-model.md`).

Open question non-blocking (bisa jalan dengan asumsi kerja, disesuaikan belakangan) masih ada di `01-business-rules.md` §7 — termasuk ambang "OVER BUDGET" 30%, URL "+ Buat DPL/DPF baru", cakupan upload "Surat Approval Standarisasi KFT" (per pengajuan vs per produk), dan sumber data `Outlet.jumlahBed`.

## Ringkasan

**POA = Plan of Action.** Dua sub-form, dua sumbu utama yang berbeda — koreksi 2026-08-14 (framing "Dokter × Outlet" pada revisi sebelumnya dokumen ini SALAH, sudah diperbaiki):

| | Sumbu utama (unit baris) | Unit rencana |
|---|---|---|
| **POA Estimasi** (sudah ada) | **Dokter × Produk** | Satu `PoaForm` berisi banyak `PoaLineItem` — tiap baris = 1 dokter × 1 produk. Dokter itu sendiri sudah terikat ke 1 outlet (`kodePI`+`namaCust`), tapi Outlet bukan sumbu baris terpisah — dia atribut yang menempel ke dokternya. Approval per-dokter (`PoaDoctorApproval`, menggabungkan semua baris produk milik 1 dokter jadi 1 unit approval) |
| **POA Standarisasi** (baru, spec ini) | **Produk × Outlet** | Satu `PoaStandarisasi` = 1 outlet, berisi banyak `PoaStandarisasiProduk` — tiap baris = 1 produk di outlet itu. Dokter di sini jadi sub-entity pendukung per produk (syarat kelengkapan tanda tangan, BUKAN unit approval utama seperti di POA Estimasi) |

Approval dokter tetap ada di POA Standarisasi sebagai syarat kelengkapan per produk (dokter menandatangani fisik, dicentang "Sudah TTD" — bukan approve/reject in-app seperti `PoaDoctorApproval`). Flow-nya wizard 4-phase: **Planning Standarisasi → Approval Atasan → Approval User/Dokter → Finalisasi**, per pengajuan (bukan per baris seperti reject/approve granular POA Estimasi).

Sengaja dibuat model terpisah (bukan dipaksa masuk ke `PoaLineItem`) karena unit kerjanya beda, tapi periode/estimasi sengaja disamakan pola dengan yang sudah ada (`periodeAwal`+`lamaPeriode`, formula `resep × qty × hari × HNA_ST` ala `computeEstimasi()`) supaya helper `lib/poaUtils.ts` dan konsep bisnis "periode" tetap konsisten di seluruh app — lihat `01-business-rules.md` §1 untuk daftar lengkap apa yang di-reuse vs baru.

Tidak ada cross-reference ke `docs/TODO.md` — belum ada item terkait fitur ini di tracker saat spesifikasi ditulis.
