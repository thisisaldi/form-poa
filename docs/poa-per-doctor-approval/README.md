# POA — Approval/Rejection Per Dokter

## Sumber requirement

Diminta langsung oleh pengguna via chat, 2026-08-13. Kutipan permintaan asli:

> "untuk approval dan rejection atasan, itu dibuat agar bisa diapprove/reject bukan per draft, tapi per dokternya. jadi atasan bisa reject dokter a dan reject dokter b pada draft yang sama"

Klarifikasi lanjutan (`AskUserQuestion`, 2026-08-13):
- Grouping approval "udah gaada per MR lagi, tapi per dokter" — unit approve/reject bergeser dari **1 draft POA** (yang berisi banyak dokter milik 1 MR) menjadi **1 dokter di dalam draft itu**.
- Approver-nya tetap sama (ASM → SM → NSM, current holder yang sama) — yang berubah cuma granularitas: bukan "approve seluruh draft", tapi "approve/reject dokter tertentu di draft itu".

## Status

🟡 **Open questions RESOLVED 2026-08-13 (keputusan pengguna: "all become per doctor") — implementasi v1 sedang berjalan.**

Ini BUKAN perubahan kecil: state machine approval POA (`PoaStatus`, `docs/form-poa/01-business-rules.md` §1) saat ini melekat di level `PoaForm` (1 status untuk seluruh draft) dan dibaca sebagai ground truth oleh banyak bagian sistem lain — Lock Edit Logic, notifikasi email, export Excel, Ringkasan/Summary/Monitoring dashboard, dan gating submit/edit. v1 menyelesaikan mekanisme inti (model data, state machine, authz, halaman approval utama) per-dokter penuh; rework export Excel & dashboard Summary/Monitoring ke per-dokter adalah **follow-up terpisah** (lihat OQ-6/Non-goals) — sementara itu keduanya baca rollup `PoaForm.status` yang live-derived dari status dokter-dokternya.

## Ringkasan

MR menyusun 1 draft POA per kuartal berisi banyak dokter (masing-masing dengan 1+ `PoaLineItem` per produk). Saat ini atasan (ASM/SM/NSM) approve/reject SELURUH draft sekaligus. Requirement baru: atasan bisa approve/reject **per dokter** di dalam draft yang sama — mis. Dokter A dan Dokter B ada di draft POA yang sama, atasan bisa reject Dokter A (kembali ke MR untuk direvisi) sambil Dokter B tetap lanjut ke tahap berikutnya (atau sudah approved), tanpa saling mem-block.

Konsekuensi utama: `PoaForm.status` tidak lagi bisa jadi satu-satunya sumber kebenaran soal "sedang di level mana" — perlu record approval baru per (POA, dokter). Lihat `02-data-model.md` untuk desain yang diusulkan dan `01-business-rules.md` untuk daftar lengkap perilaku yang perlu didefinisikan ulang (submit, lock edit, fast-track, cancel-approved, ajukan-edit, notifikasi, export, dashboard).
