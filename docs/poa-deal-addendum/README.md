# POA — Gelombang (Batch) Baru untuk Dokter yang Sudah Deal

**Sumber requirement:** permintaan pengguna, 2026-10-09 (setelah kasus Adhit/Pascal): "kalau sudah deal tidak boleh diubah sama sekali" **dan** MR harus bisa input customer yang sama lagi (outlet/dokter/produk sama, mis. jenis PSSP berbeda) **di POA yang sama**, bukan draft baru. Dipilih lewat pertanyaan 2026-10-09: "Baris baru di POA Q4 yang sama".

**Status:** 🟢 Diimplementasikan 2026-10-09 (migrasi `20261009120000_poa_batch_gelombang`, belum dijalankan di DB bersama; diuji end-to-end di DB lokal: tambah baris untuk dokter Deal → gelombang 2 di POA yang sama, submit gelombang 2, rollup, dan `/api/poa-doctors` + PATCH tanpa perubahan kontrak). Yang belum: export Excel POA menghitung dokter per dokter (bukan per gelombang) dan tidak menandai gelombang; badge WARNING input ganda lintas gelombang.

## Ringkasan
Approval POA melekat per dokter (`PoaDoctorApproval`, kunci unik `(poaId, kodePI, namaCust)`). Karena itu menambah baris untuk dokter yang sudah Deal akan masuk ke approval yang sama: baris lama ikut mundur ke REVISI (melanggar "Deal tidak boleh diubah") atau baris baru lolos tanpa approval. Spec ini menambah konsep **gelombang (batch)**: satu dokter di satu POA boleh punya beberapa gelombang, masing-masing dengan baris dan siklus approval sendiri. Gelombang yang sudah Deal tidak pernah disentuh lagi.

## Dokumen
1. [`01-business-rules.md`](./01-business-rules.md) — aturan, dampak, open questions.
2. [`02-data-model.md`](./02-data-model.md) — perubahan skema dan daftar kode yang terdampak.
