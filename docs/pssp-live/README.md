# PSSP Live dari Exodus

**Sumber requirement:** permintaan user (2026-10-06): data PSSP di POA estimasi (histori + aktif) diambil live dari Exodus, bukan snapshot tabel `PsspKontrak` yang diisi manual lewat `scripts/importPsspKontrak.ts`.

**Status:** 🟢 Fase 1 diimplementasikan 2026-10-06. Diubah 2026-10-20 (keputusan user):
- Kontrak yang cuma ada di Exodus tampil di `PsspHistoryPanel` sebagai kontrak biasa (tanpa label/kartu terpisah, satu baris "Semua produk", pelunasan 0).
- Pelunasan kontrak yang ada di `PsspKontrak` **ditimpa angka Exodus** (tulis ke `totalLunas`, jadi semua pembaca — panel, export, summary — ikut). Jalan otomatis tiap 00:00 WIB (`src/lib/sync/psspLunasScheduler.ts`, ~20 menit); manual/dry-run lewat `scripts/syncPsspLunasFromExodus.ts`, mis. langsung setelah `importPsspKontrak.ts`.

Fase 2 (per-produk) masih terblokir Exodus.

## Ringkasan

Exodus sekarang punya tiga endpoint PSSP (hasil probe 2026-10-06, `scripts/probeExodusPssp.ts`): header kontrak (`/promotion/v1/pssp`), pelunasan ringkas (`/promotion/v1/pssp/settlements`), dan per-produk (`/promotion/v1/pssp/products`). Header + settlements cukup untuk tampilan histori/aktif **per kontrak** dan persen pelunasan. Per-produk belum bisa dipakai karena endpoint tidak bisa difilter. Dokumen ini mendefinisikan pemetaan field, fase rollout, dan pertanyaan terbuka ke Exodus.

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — endpoint, pemetaan field ke `PsspKontrakSummary`, fase, non-goals, open questions.
