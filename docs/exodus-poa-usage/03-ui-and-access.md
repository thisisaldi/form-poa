# Exodus POA Usage Flag — Endpoints & Access

Tidak ada halaman UI baru — ini murni API-to-API antara Exodus dan POA, sama seperti `GET /api/poa-doctors` yang sudah ada.

## Endpoint yang diimplementasikan

| Method | Path | Efek |
|---|---|---|
| `GET` | `/api/poa-doctors?nip=...&keyword=...` | List (endpoint utama yang dipakai Exodus, per konfirmasi 2026-08-27) — `keyword` baru, filter `usedInExodus`+`approveUntil==NSM` baru |
| `GET` | `/api/poa-doctors/{id}` | Detail satu baris — TIDAK disentuh permintaan 2026-08-27, tetap perilaku v1 kecuali field baru (idPoa/periode/nilaiR/hna/qty) yang otomatis ikut lewat `buildDoctorRows` bersama |
| `PATCH` | `/api/poa-doctors/{id}` | Body opsional: tanpa body / `{"usedInExodus":true}` → mark as used (`usedInExodus` → `true`, set `usedInExodusAt`); `{"usedInExodus":false}` → **revert** (baru 2026-08-27, lihat `01-business-rules.md` §8 — membalik aturan "tidak pernah revert" yang tadinya dikonfirmasi eksplisit oleh Exodus, BELUM ada konfirmasi ulang tertulis dari mereka). Idempotent di kedua arah. *(Sempat dipecah jadi `PATCH`+`DELETE` terpisah, digabung lagi jadi satu `PATCH` di hari yang sama atas preferensi Aldi — satu endpoint lebih simpel daripada dua method untuk aksi yang konsepnya sama, "set flag ini".)* |

`{id}` = `uidCustomer` dari response `GET /api/poa-doctors` (anchor `PoaLineItem.id`).

Response `PATCH` 200: shape sama seperti `GET /api/poa-doctors/{id}`, dengan `usedInExodus` sesuai hasil aksinya.

Lihat `docs/api-poa-doctors.md` untuk kontrak request/response lengkap dan kode error.

**Konfirmasi eksplisit 2026-08-27 (pesan Aldi ke tim Exodus)**: cuma 2 endpoint yang dipakai — `GET` list (poin 1 di bawah) dan `PATCH` (poin 2). `GET /api/poa-doctors/{id}` tetap ada untuk kompatibilitas tapi bukan bagian dari permintaan ini.

1. GET all — bisa pake `keyword` (customer name, outlet name, `code_customer`, `outlet_code`, `id_poa`)
2. PATCH — update flag "sudah dipakai di Exodus atau belum"

## Auth

Reuse persis pola `GET /api/poa-doctors` (`src/lib/apiBasicAuth.ts` + `PoaDoctorsApiCredential`, dipusatkan lewat `isAuthorizedPoaDoctorsRequest` di `src/lib/poaDoctorsRows.ts`) — session cookie ATAU HTTP Basic Auth, tidak ada kredensial terpisah untuk endpoint ini.

**Staging**: endpoint yang sama tersedia di `https://staging-form-poa.chc.pharmalink.id` (ditanyakan tim Exodus 2026-08-27) — kredensial/session TERPISAH dari production.

## Role/access

Tidak ada role/access matrix baru — endpoint ini murni server-to-server (dipanggil Exodus, bukan user login lewat browser). Gate satu-satunya adalah Basic Auth di atas.

## Non-goals v2

- **Tidak ada endpoint approve terpisah** — lihat `01-business-rules.md` §Open questions #4, ditutup ulang di §7 (meeting 2026-08-27 tidak menyebutnya lagi).
- **Keyword search TIDAK company-wide** — tetap scoped dalam `nip` yang wajib. Search lintas semua POA (tanpa `nip`) butuh desain ulang (pagination + review `docs/PERFORMANCE.md`) yang secara eksplisit BUKAN yang diminta 2026-08-27.
- **`qtyPerBulan`/`qtyTotal` cuma untuk kuartal berjalan**, bukan seluruh periode item sendiri kalau item itu span lebih dari 1 kuartal (lamaPeriode 6/12 bulan) — konsisten dengan scope endpoint yang memang selalu kuartal berjalan.
- **Endpoint "batas approval role dari Exodus" (poin 1 chat 2026-08-24)** — masih di luar scope, tidak disinggung lagi di meeting 2026-08-27, lihat Open questions #1 di `01-business-rules.md`.
