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

## 5b. Fase 2 — `PsspKontrak` diisi penuh dari Exodus (diimplementasikan 2026-10-20: `src/lib/sync/psspLunasSync.ts`, job `pssp-lunas`; belum di-apply ke DB mana pun)

*Keputusan user 2026-10-20, setelah ditemukan bug di §3 (`totalLunas` = estimasi Excel × persen Exodus menghasilkan rupiah terlalu kecil: estimasi Excel hanya mencakup bulan yang ada kolomnya di file, ±202501–202607, sedangkan persen Exodus terhadap estimasi seluruh kontrak — mis. CJ43624 est Excel 18,8 jt vs Exodus 66,7 jt). Data prod hasil §3 sengaja dibiarkan sampai Fase 2 siap (keputusan user).*

**Endpoint baru** (dokumentasi Exodus diberikan user 2026-10-20, diverifikasi probe ke prod dengan `pssp_id` 43191 = PCJ43624):

| Endpoint | Waktu | Isi yang dipakai |
|---|---|---|
| `GET /pssp/settlements?user_nip=&page=&limit=` | 1,3 dtk (hal. 1) – 9 dtk (hal. 50) per 100 baris; `limit=1000` → 524 timeout | Daftar kontrak: `pssp_id`, `pssp_number`, `customer_code/name`, `outlet_code/name`, `start_date`/`end_date`. Satu-satunya cara mendapat `pssp_id` (tanpa `user_nip` → 500). |
| `GET /pssp/settlements/details?pssp_id=` | ~150 ms | Per produk per bulan: `product_code/name`, `periode` ("Jun 2026"), `monthly_estimated_value`, `settlement_value`, `is_estimated`, `pssp_total_value`. |
| `GET /pssp/settlements/summary/:pssp_id` | ~150 ms | Per bulan: `Estimasi`, `Pelunasan`, `Progress`, `Status`. Tidak dipakai untuk menulis (= Σ details per bulan), hanya verifikasi. |

**Keputusan (user, 2026-10-20):**

| # | Keputusan |
|---|---|
| D1 | Pelunasan **angka asli Exodus**, tanpa batas. (Excel membatasi lunas per bulan per produk ke % estimasi bulan itu — 85% di CJ43624/CJ37937, 75% di CJ41799; Exodus tidak.) |
| D2 | Pelunasan produk yang **tidak diestimasi** (`is_estimated=false`, mis. MAXICEF 930 rb di CJ43624) **ikut dihitung** — jadi baris produk dengan estimasi 0. |
| D3 | Sumber `PsspKontrak` = **Exodus penuh** untuk setiap kontrak yang ada di Exodus (termasuk yang belum ada di DB). Kontrak yang tidak ada di Exodus tetap dari Excel. |

**Pemetaan per kontrak (`pssp_id`) → baris `PsspKontrak` per produk:**

| Field | Sumber |
|---|---|
| `cUrut` | `pssp_number` tanpa `P` depan; hanya nomor berawalan `P` |
| `kdCust` / `nmCust` | `customer_code` / `customer_name` (listing) |
| `kdOutlet` / `nmOutlet` | `outlet_code` / `outlet_name` (listing) |
| `prdAwal` / `prdAkhir` | `start_date` / `end_date` → `YYYYMM` (UTC) |
| `biaya` | `pssp_total_value` (details) |
| `kdProduk` / `nmProduk` | `product_code` / `product_name` |
| `estByPeriod[YYYYMM]` / `estBaris` / `totalEst` | `monthly_estimated_value` per bulan / Σ (cocok dengan Excel: CJ43624 Jun & Jul 9,38 jt) |
| `lunasByPeriod[YYYYMM]` / `totalLunas` | `settlement_value` per bulan / Σ |
| `lunasSyncedAt` | waktu sync |
| `nmSpc`, `nipUsul`, `nmUsul`, `divProd`, dst. | tidak ditimpa kalau baris sudah ada; null untuk baris baru |

Per kontrak: baris produk lama yang tidak lagi muncul di Exodus dihapus (penggantian penuh per kontrak). Satu nomor kontrak = satu `pssp_id` (2.176 nomor P dicek, 0 duplikat). Setelah Fase 2, kartu/baris "kontrak Exodus-only" (`getExodusPsspExtras`) tidak diperlukan lagi karena kontraknya sudah jadi baris `PsspKontrak` biasa.

**Open question blocking:**

| # | Pertanyaan | Asumsi |
|---|---|---|
| F1 | NIP mana yang dipakai untuk listing semua kontrak? | ✅ `972977` (Ahsanul Chalid, user 2026-10-20) — 18.534 settlement, tidak ada di tabel `User`. Env `EXODUS_PSSP_LIST_NIP` (default `972977`). Lebih baik jangka panjang: Exodus menyediakan listing tanpa `user_nip` untuk client service. |
| F2 | Durasi sync: ~187 halaman × 1–30 dtk + ~7–8 rb × 150 ms details ≈ 30–45 menit/malam. Beban ke Exodus wajar? | Listing konkurensi 3, detail konkurensi 5, jalan 03:00 WIB (setelah job lain). |

## 6. Perilaku kegagalan

Mengikuti kontrak `exodusApi.ts`: tanpa konfigurasi / non-2xx / timeout → kembalikan `null`; kartu Exodus tidak muncul, panel tampil seperti sekarang.

## 7. Non-goals

Tidak menghapus tabel `PsspKontrak` atau `importPsspKontrak.ts` (pelunasan-nya saja yang ditimpa Exodus); tidak menulis balik ke Exodus; tidak mengubah rumus pelunasan/estimasi di POA.
