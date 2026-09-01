# Exodus POA Usage Flag — Endpoints & Access

Tidak ada halaman UI baru — ini murni API-to-API antara Exodus dan POA, sama seperti `GET /api/poa-doctors` yang sudah ada.

## Endpoint yang diimplementasikan

| Method | Path | Efek |
|---|---|---|
| `GET` | `/api/poa-doctors?nip=...&keyword=...` | List (endpoint utama yang dipakai Exodus, per konfirmasi 2026-08-27) — `keyword` baru, filter `usedInExodus`+`approveUntil==NSM` baru, dan `nip`/`keyword` DUA-DUANYA **OPSIONAL** (lihat `01-business-rules.md` §7 poin 3): kosongkan `nip` untuk company-wide, kosongkan keduanya untuk SEMUA POA di kuartal berjalan |
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

## DRAFT — perubahan diusulkan 2026-09-01 (belum diimplementasikan)

Lihat `01-business-rules.md` §9 untuk konteks lengkap. Kontrak `PATCH /api/poa-doctors/{id}` di atas masih berlaku SEKARANG (belum berubah) — bagian ini catatan proposal.

**Use case (dikonfirmasi Aldi 2026-09-01)**: nomor pengajuan + status ditampilkan di halaman detail POA (`/poa/[id]`), per baris dokter — bukan kebutuhan Exodus sendiri, Exodus cuma sumber datanya. Lihat rencana UI di bawah.

**Kontrak PATCH — settled 2026-09-01, partial per-field** (bukan lagi open question soal "replace vs alongside" — lihat `01-business-rules.md` §9):

```
PATCH /api/poa-doctors/{id}
{
  "usedInExodus"?: boolean,
  "exodusStatus"?: "PENGAJUAN" | "APPROVED",
  "exodusNomorPengajuan"?: string
}
```

Ketiga field OPSIONAL dan independen — Exodus kirim field mana pun yang berubah, tidak wajib mengirim ketiganya sekaligus. Field yang tidak dikirim tidak disentuh di DB. Body kosong/tanpa field tetap default `usedInExodus: true` (kompatibel dengan kontrak lama). Contoh pemakaian bertahap: PATCH pertama saat submit `{"exodusNomorPengajuan": "EXO-123", "exodusStatus": "PENGAJUAN"}`; PATCH kedua saat approved cukup `{"exodusStatus": "APPROVED"}` — nomor pengajuan yang sudah tersimpan tidak perlu dikirim ulang.

**Masih open (Open Question #2 di `01-business-rules.md` §9, Aldi minta didiskusikan dulu)**: apakah `exodusStatus: "APPROVED"` boleh dikirim langsung tanpa `PENGAJUAN` sebelumnya, atau server harus menolak/validasi urutan.

### Rencana UI (draft) — `/poa/[id]`, per baris dokter

Reuse pola `DraftChecklist`'s `DoctorRow` yang sudah join `PoaDoctorApproval` lewat `doctorApprovalByKey` (`src/app/(app)/poa/[id]/page.tsx:102-103`) — badge/chip baru di baris yang sama dengan `StatusBadge`/`Version X` yang sudah ada, muncul HANYA kalau `exodusStatus` terisi (dokter yang belum pernah disentuh Exodus tidak menampilkan apa-apa). Detail styling/copy belum didesain — menunggu Open Question #2 selesai dulu supaya jelas transisi status apa saja yang perlu direpresentasikan di badge.

## Non-goals v2

- **Tidak ada endpoint approve terpisah** — lihat `01-business-rules.md` §Open questions #4, ditutup ulang di §7 (meeting 2026-08-27 tidak menyebutnya lagi).
- ~~**Keyword search TIDAK company-wide** — tetap scoped dalam `nip` yang wajib.~~ **DIBALIK 2026-08-27 (hari yang sama)** — `nip` sekarang opsional, `keyword` tanpa `nip` men-search company-wide dalam kuartal berjalan. Lihat `01-business-rules.md` §7 poin 3 untuk data volume yang jadi dasar keputusan ini (bukan asumsi).
- **Belum ada pagination** — dengan volume saat ini (~33 baris NSM-approved per kuartal company-wide) belum jadi masalah, tapi kalau data bertambah signifikan (banyak NIP baru aktif, lebih banyak yang final-approved), ini perlu ditambahkan sebelum performa turun di bawah target `docs/PERFORMANCE.md`.
- **`qtyPerBulan`/`qtyTotal` cuma untuk kuartal berjalan**, bukan seluruh periode item sendiri kalau item itu span lebih dari 1 kuartal (lamaPeriode 6/12 bulan) — konsisten dengan scope endpoint yang memang selalu kuartal berjalan.
- **Endpoint "batas approval role dari Exodus" (poin 1 chat 2026-08-24)** — masih di luar scope, tidak disinggung lagi di meeting 2026-08-27, lihat Open questions #1 di `01-business-rules.md`.
