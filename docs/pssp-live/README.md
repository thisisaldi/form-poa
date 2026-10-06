# PSSP Live dari Exodus

**Sumber requirement:** permintaan user (2026-10-06): data PSSP di POA estimasi (histori + aktif) diambil live dari Exodus, bukan snapshot tabel `PsspKontrak` yang diisi manual lewat `scripts/importPsspKontrak.ts`.

**Status:** 🟢 Fase 1 diimplementasikan 2026-10-06 sebagai kartu tambahan "PSSP dari Exodus" di `PsspHistoryPanel` (tidak mengganti `PsspKontrak`; tanpa pelunasan, tanpa per-produk; belum menyentuh "PSSP Aktif" per outlet maupun export). Fase 2 (per-produk) masih terblokir Exodus. Tidak ada keputusan yang sudah dikonfirmasi stakeholder selain yang ditandai di `01-business-rules.md` §5.

## Ringkasan

Exodus sekarang punya tiga endpoint PSSP (hasil probe 2026-10-06, `scripts/probeExodusPssp.ts`): header kontrak (`/promotion/v1/pssp`), pelunasan ringkas (`/promotion/v1/pssp/settlements`), dan per-produk (`/promotion/v1/pssp/products`). Header + settlements cukup untuk tampilan histori/aktif **per kontrak** dan persen pelunasan. Per-produk belum bisa dipakai karena endpoint tidak bisa difilter. Dokumen ini mendefinisikan pemetaan field, fase rollout, dan pertanyaan terbuka ke Exodus.

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — endpoint, pemetaan field ke `PsspKontrakSummary`, fase, non-goals, open questions.
