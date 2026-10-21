# PSSP Live dari Exodus

**Sumber requirement:** permintaan user (2026-10-06): data PSSP di POA estimasi (histori + aktif) diambil live dari Exodus, bukan snapshot tabel `PsspKontrak` yang diisi manual lewat `scripts/importPsspKontrak.ts`.

**Status:** 🟢 Fase 1 diimplementasikan 2026-10-06. Diubah 2026-10-20 (keputusan user):
- **Fase 2 (2026-10-20):** `PsspKontrak` diisi penuh dari Exodus per produk per bulan untuk setiap kontrak yang ada di Exodus (estimasi + pelunasan asli tanpa batas, termasuk produk non-estimasi, termasuk kontrak yang belum ada di Excel) — lihat `01-business-rules.md` §5b. Menggantikan pendekatan §3 (persen Exodus × estimasi Excel), yang terbukti salah untuk kontrak yang masanya keluar dari rentang Excel.
- Semua pembaca (panel, export, summary) ikut karena data ditulis ke `PsspKontrak`. Jalan otomatis tiap 03:00 WIB (`src/lib/sync/jobs.ts` job `pssp-lunas`, ~30–45 menit; status & run manual di Admin → Scheduler); manual/dry-run lewat `scripts/syncPsspLunasFromExodus.ts`, mis. langsung setelah `importPsspKontrak.ts`.
- Indikator per kontrak di panel histori: badge "Terupdate <tanggal>" kalau pelunasan sudah dikonfirmasi Exodus (`PsspKontrak.lunasSyncedAt`, diisi sync, dikosongkan `importPsspKontrak.ts`), "Belum update" kalau masih angka Excel (kontrak yang tidak ada di Exodus, atau sync belum jalan). Footer: jumlah kontrak terupdate + tanggal Excel.


## Ringkasan

Exodus sekarang punya tiga endpoint PSSP (hasil probe 2026-10-06, `scripts/probeExodusPssp.ts`): header kontrak (`/promotion/v1/pssp`), pelunasan ringkas (`/promotion/v1/pssp/settlements`), dan per-produk (`/promotion/v1/pssp/products`). Header + settlements cukup untuk tampilan histori/aktif **per kontrak** dan persen pelunasan. Per-produk belum bisa dipakai karena endpoint tidak bisa difilter. Dokumen ini mendefinisikan pemetaan field, fase rollout, dan pertanyaan terbuka ke Exodus.

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — endpoint, pemetaan field ke `PsspKontrakSummary`, fase, non-goals, open questions.
