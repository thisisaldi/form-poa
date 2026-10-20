# PSSP Live — Business Rules & Pemetaan Data

*Sumber requirement: lihat `README.md`. Fakta endpoint di bawah dari probe langsung 2026-10-06, bukan dari dokumentasi Exodus.*

## 1. Yang dikonsumsi sekarang

`PsspKontrakSummary` (`src/app/actions/customer.ts:98`) berbentuk **satu baris per produk per kontrak** (`cUrut` = nomor kontrak, `kdProduk`/`nmProduk`, `estBaris`, `totalLunas`, periode `YYYYMM`). Dipakai oleh `getPsspHistory`, `getPsspHistoryByCustomers`, `getActivePsspByOutlets`/`ByCustomers`, `PsspHistoryPanel`, badge "Pernah PSSP", dan dua export (`computePelunasanPct`, `computeOldEstPerMonth`).

## 2. Endpoint Exodus (fakta terkonfirmasi probe)

| Endpoint | Filter yang bekerja | Isi |
|---|---|---|
| `GET /promotion/v1/pssp` | `customer_id` (numerik Exodus; `outlet_code` diabaikan) | Header: `pssp_header_id`, `ref_id_header`, `customer.customer_code`, `start_period`/`end_period` (ISO), `total_given_value`, `total_estimation_value`, `request_status`, `is_draft`, `outlets[]` |
| `GET /promotion/v1/pssp/settlements` | `user_nip` (wajib; `nip`/`customer_id` → 500 "user projects not found") | Per kontrak: `pssp_id`, `pssp_number`, `outlet_code`, `customer_code`, `start_date`/`end_date`, `percentage`, `progres_settlement`, `status_settlement` |
| `GET /promotion/v1/pssp/products` | **Tidak ada** (`pssp_id`, `id`, `pssp_header_id`, `customer_id` semua diabaikan); `page`+`limit` wajib | Per produk: `pssp_id`, `product_code`, `product_name`, `value_pssp`, `quantity[]`, `periode[]` (isi `0001-01-01`, kosong), `estimation_value` null; total 443.199 baris |

## 3. Pemetaan ke `PsspKontrakSummary` — Fase 1 (level kontrak)

**Sifat integrasi: tambahan di atas data `PsspKontrak` yang ada, bukan pengganti** (keputusan user 2026-10-06). Kontrak Exodus yang `cUrut`-nya sudah ada di `PsspKontrak` dibuang; sisanya ditampilkan sebagai kartu terpisah "PSSP dari Exodus" dan TIDAK ikut rumus pelunasan/estimasi (karena tanpa per-produk dan tanpa `totalLunas` asli). Satu baris per kontrak per outlet (header multi-outlet di-expand, keputusan 2026-09-02; `outlets[]` bisa berisi outlet duplikat → dedupe per `outlet_code`).

| Field | Sumber | Catatan |
|---|---|---|
| `cUrut` | `ref_id_header` (header) == `pssp_number` (settlements) | ✅ Terverifikasi probe 2026-10-06 (8/8 sampel). Join lewat nomor ini, BUKAN `pssp_id` ↔ `pssp_header_id` (id berbeda, 0 cocok). **`PsspKontrak.cUrut` membuang huruf `P` di depan** (Exodus `PCJ37904` = DB `CJ37904`) → bandingkan setelah `replace(/^P/, "")`. Endpoint yang sama juga memuat program lain (`L…` listing fee, `F…`): hanya nomor berawalan `P` yang dianggap PSSP. Satu nomor bisa punya banyak header (mis. `PE201272` = 6 header, periode & customer sama) → `biaya`/`estBaris` dijumlah per nomor. |
| `prdAwal`/`prdAkhir` | `start_period`/`end_period` → `YYYYMM` | Pakai UTC, hindari geser zona waktu. |
| `biaya` | `total_given_value` | Dikonfirmasi user 2026-09-02. |
| `estBaris` | `total_estimation_value` | Dikonfirmasi user 2026-09-02. |
| `totalLunas` | `Σ estBaris × percentage / 100` per kontrak, dibagi ke baris produk proporsional `totalLunas` lama (atau `estBaris` kalau masih 0) — `applySettlementPct` di `exodusApi.ts` | ✅ `percentage` = persen pelunasan terhadap estimasi, terverifikasi 2026-10-20 (mayoritas kontrak P080285 cocok ±0.1% dengan `PsspKontrak`). Bisa > 100 (mis. 111.54) — dipakai apa adanya. Endpoint lambat (12–20 dtk/nip) → hanya dipanggil dari script sync, tidak live. |
| `kdProduk`/`nmProduk` | — | `null` di Fase 1. |
| Hanya hitung `request_status == "approved"` dan `is_draft == false` | header | Dikonfirmasi 2026-09-02. |

## 4. Fase

| Fase | Isi | Prasyarat |
|---|---|---|
| 1 | Kontrak level header + persen pelunasan. Dipakai untuk "PSSP Aktif", `computePelunasanPct`, ringkasan per dokter. | Verifikasi asumsi §3 di data nyata |
| 2 | Per-produk: badge "Pernah PSSP" per produk, `computeOldEstPerMonth`, running-rate di `PsspHistoryPanel`. | Exodus menambah filter di `/pssp/products` (§5 Q1) |
| 3 | Pelunasan rupiah + bulanan. | Exodus menambah field (§5 Q3) |

Semua rumus tetap membaca `PsspKontrak`; pelunasan di tabel itu disegarkan dari Exodus oleh `scripts/syncPsspLunasFromExodus.ts` (keputusan user 2026-10-20: Exodus = sumber terbaru, menang atas Excel).

## 5. Open questions — status & asumsi v1

| # | Pertanyaan | Asumsi untuk lanjut | Siapa yang menjawab |
|---|---|---|---|
| Q1 | Bisakah `/pssp/products` difilter per `pssp_id`/`customer_id`/`pssp_header_id`? | Belum bisa → fase 2 terblokir. Dilarang sync 443k baris (`docs/PERFORMANCE.md`). | Tim Exodus |
| Q2 | Join settlements↔header? | ✅ `pssp_number` == `ref_id_header`; `pssp_id` ≠ `pssp_header_id`. Relasi `pssp_id` ke `/pssp/products` belum diketahui. | — |
| Q3 | Apakah ada field pelunasan rupiah dan `periode` bulanan yang terisi? | Tidak ada → `totalLunas` diturunkan dari `percentage`. | Tim Exodus |
| Q4 | `settlements` hanya bisa per `user_nip`: apakah level GM/NSM/ADMIN (company-wide) bisa dipanggil tanpa melebarkan beban? | Panggil per MR dalam scope, di-cache (pola `customersDbCacheByNip`), bukan satu panggilan global. | Perlu dicek terhadap `docs/PERFORMANCE.md` |
| Q5 | Apakah settlements memuat kontrak lama (histori > 2 tahun) atau hanya yang belum lunas? | Belum diketahui; kalau terpotong, histori lama tetap dari `PsspKontrak`. | Cek sendiri (probe) |

## 6. Perilaku kegagalan

Mengikuti kontrak `exodusApi.ts`: tanpa konfigurasi / non-2xx / timeout → kembalikan `null`; kartu Exodus tidak muncul, panel tampil seperti sekarang.

## 7. Non-goals

Tidak menghapus tabel `PsspKontrak` atau `importPsspKontrak.ts` (pelunasan-nya saja yang ditimpa Exodus); tidak menulis balik ke Exodus; tidak mengubah rumus pelunasan/estimasi di POA.
