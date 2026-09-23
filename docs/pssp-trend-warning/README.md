# PSSP Trend Warning — Spec Index

*(Ditulis 2026-09-23, mengikuti pendekatan spec-driven development: spesifikasi ditulis dan disetujui terlebih dahulu, sebelum kode ditulis — lihat `docs/sdd/01-when-and-workflow.md`. Sumber requirement: pesan WhatsApp Brian Lembong, 17/09/2026 18:06, tentang tips PoA Q4 — lihat kutipan di `01-business-rules.md:3`.)*

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — requirement dari pesan, definisi "Total PS/SP Aktif + Rencana", aturan "turun", dan open questions yang butuh klarifikasi sebelum implementasi dimulai.
2. [`02-data-model.md`](./02-data-model.md) — model Prisma baru (snapshot bulanan), data yang di-reuse dari fitur Summary yang sudah ada, cross-reference `docs/PERFORMANCE.md`.
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — halaman yang diusulkan, role/akses, non-goals v1.

## Status

⬜ **Belum dimulai** — spesifikasi masih draft, belum ada kode implementasi. Ditulis dari hasil investigasi kode (2026-09-23) terhadap chart "PSSP Rencana vs Aktif" yang sudah ada di halaman Summary (`src/app/(app)/summary/page.tsx`), bukan dari klarifikasi stakeholder — lihat ⚠️ di `01-business-rules.md` §"Open questions" untuk semua keputusan yang masih berupa asumsi kerja.

## Ringkasan cepat

Boss (Brian Lembong) minta: kalau Total PS/SP Aktif + Rencana per MR turun bulan-ke-bulan, atasan harus di-warn supaya bisa intervensi (dorong perpanjangan, peremajaan, atau ganti dokter — bukan dibiarkan naik-turun tanpa tindakan). Riset kode (2026-09-23) menemukan: chart "PSSP Rencana vs Aktif" yang sudah ada (`RingkasanCharts.tsx`, dipakai `summary/page.tsx`) **sudah** punya pembanding "Aktif Q-Sebelumnya", tapi itu granularity **kuartal**, bukan bulan, dan bukan snapshot historis asli — dihitung ulang dari kontrak `PsspKontrak` yang aktif **hari ini** yang kebetulan overlap ke bulan-bulan kuartal lalu (lihat `01-business-rules.md` §2 untuk detail keterbatasan ini). Untuk pembanding bulan-ke-bulan yang akurat, dibutuhkan tabel snapshot baru yang ditulis tiap akhir bulan — bukan reuse langsung query live yang sudah ada.
