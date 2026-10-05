# POA Standarisasi — Approval Level Dinamis per Produk

**Sumber requirement**: user (2026-09-29), berdasarkan tabel "Syarat Level Approval DPL, DPF & Discount Custom" (screenshot dari Exodus): level approval ditentukan persentase diskon beban Principal, dihitung terpisah per produk.

**Status**: 🟢 v1 diimplementasikan (2026-09-29): tabel `PoaStandarisasiProdukApproval`, approve per produk/level lewat `approvePoaStandarisasiAtasanAction`, UI per produk di Fase 2 wizard, tampilan `/approvals` untuk approver (termasuk ASD=GM dan SD). Jawaban user: angka = `estimasiDiskonPct` Planning, approval per produk, approver ASD/SD pola POA Estimasi, ASD kosong → SD menyetujui level ASD langsung, `DITOLAK` menahan pengajuan. Daftar/detail `/poa-standarisasi` juga dibuka ke role sales chain (2026-09-30, lihat `03-ui-and-access.md`). **Belum dikerjakan**: ajukan ulang setelah ditolak, Export Excel untuk atasan. ⚠️ Belum dites lewat UI/browser — hanya `scripts/checkDiscountApprovalLevel.ts` (logika urutan) dan smoke test tabel di DB.

## Ringkasan

Fase 2 "Approval Atasan" sekarang statis: ASM → SM → NSM untuk semua pengajuan (`approvePoaStandarisasiAtasanAction`, `authz.ts:931`). Fitur ini menggantinya dengan rantai dinamis ASM → SM → NSM → ASD → SD yang panjangnya per produk ditentukan Disc PI (`estimasiDiskonPct`) produk itu. Approval disimpan per produk (tabel baru), pengajuan lanjut ke Fase 3 kalau semua produk sudah disetujui sampai levelnya masing-masing. Tidak terkait `approval-level` PSSP Exodus (itu berdasar nilai/R, bukan persen diskon).

## Isi
1. [`01-business-rules.md`](./01-business-rules.md) — tabel level, lifecycle per produk, open questions
2. [`02-data-model.md`](./02-data-model.md) — model baru + migrasi data lama
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — approver per level, UI Fase 2, non-goals

Terkait: `docs/poa-standarisasi/` (spec induk), `docs/exodus-poa-usage/01-business-rules.md` §11 (rantai ASD/SD di POA Estimasi), form DPL/DPF Step 5 (`discountApprovalLevel`, `lib/discountApprovalLevel.ts` — logika tabel yang sama).
