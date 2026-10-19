# MCL — Data Model

## Yang sudah ada (digunakan ulang, tanpa perubahan skema)

| Model | Peran |
|---|---|
| `Outlet` (`kodePI`) | Kunci join ke Excel — 293/293 `KODE PI` Excel ada |
| `Product` (`kodeProduk`) | Kunci join produk — 151/151 kode Excel ada (kode Excel bisa bernol-depan, mis. `009342`; DB juga 6 digit) |
| `Customer` + `CustomerOutlet` | Tujuan tautan dokter bila match yakin |

## Yang baru (butuh migration) — DRAFT, menunggu jawaban open questions

```prisma
enum ListingStatusExcel {
  SUDAH_LISTING
  BELUM_LISTING
  PRODUK_TIDAK_ADA
  OUTLET_TIDAK_ADA
}

// Satu baris per (outlet, produk) dari sheet Main. ~41.5 ribu baris.
model OutletProdukListing {
  id          String             @id @default(uuid())
  kodePI      String
  kodeProduk  String
  status      ListingStatusExcel
  importBatch String
  importedAt  DateTime           @default(now())

  @@unique([kodePI, kodeProduk])
  @@index([kodePI])
}

// Satu baris per (outlet, dokter ternormalisasi, produk) setelah dedupe.
model MclRekomendasiDokter {
  id             String   @id @default(uuid())
  kodePI         String
  namaDokter     String
  namaNormalized String
  spesialis      String
  kodeProduk     String
  keterangan     String?
  estimasiAktif  Decimal? @db.Decimal(18, 2)
  pelunasan      Decimal? @db.Decimal(18, 2)
  customerId     String?
  matchTier      String   // EXACT | SUBSET | FUZZY | NONE
  importBatch    String

  @@unique([kodePI, namaNormalized, spesialis, kodeProduk])
  @@index([kodePI])
}
```

### Catatan desain

- **Dua tabel, bukan satu**: indikator butuh kunci (outlet, produk) dan dibaca sangat sering (setiap render Planning); rekomendasi butuh dokter. Memisahkan menghindari scan 321 ribu baris hanya untuk badge. Status terbukti konsisten per (outlet, produk), jadi tidak ada informasi yang hilang.
- **`status` enum 4 nilai, bukan boolean**: nilai mentah dipertahankan agar perlakuan "belum" dapat diubah (Q3) tanpa import ulang.
- **`customerId` nullable tanpa FK keras**: 38,8% baris tidak punya dokter terdaftar; baris Excel tetap harus tampil. Pola snapshot-bukan-FK sama seperti `PoaStandarisasiDokterReassignLog`.
- **`matchTier` disimpan**: tier SUBSET/FUZZY dapat ditampilkan sebagai saran, bukan tautan pasti (Q7).
- **Kolom hierarki (GM..FF) Excel tidak disimpan**: berupa teks nama tanpa NIP dan sudah ada sumber kebenaran di struktur organisasi app (`nipAtasan`, `Outlet.coveredByNip`).
- **`importBatch`**: satu import = satu batch; import ulang (kalau suatu saat perlu koreksi) mengganti seluruh isi (delete-then-insert dalam transaksi), bukan merge, sehingga tidak ada baris yatim dari file lama. File sumber tunggal dan tidak diperbarui (README, update 2026-10-15), jadi tidak ada rancangan refresh berkala.
- **Lookup POA Estimasi** (per dokter): `where kodePI = ? and (customerId = ? or namaNormalized = ?)` — memakai index `kodePI`, hasil puluhan baris per outlet; tidak perlu index tambahan.

## Invariant

1. (kodePI, kodeProduk) unik di `OutletProdukListing`; (kodePI, namaNormalized, spesialis, kodeProduk) unik di `MclRekomendasiDokter` (spesialis ikut kunci: dua dokter beda spesialis dengan nama ternormalisasi sama tidak boleh menyatu).
2. Setelah import, seluruh baris punya `importBatch` yang sama (tidak ada campuran batch).
3. `customerId` terisi hanya bila `matchTier = EXACT` (asumsi v1, Q7).
4. Tabel hanya diubah oleh script import — tidak ada edit manual dari UI.

## Algoritma matching nama (dipakai script import)

Dibatasi per `kodePI` (kandidat = dokter di outlet yang sama dari `CustomerOutlet`; sumber Exodus tidak dibaca saat import karena response-nya live dan per-outlet — dokter Exodus yang belum ada lokal terselesaikan lewat `getCustomersByOutlet` saat MR membuka outlet).

1. Normalisasi: NFD tanpa aksen, huruf besar, buang gelar (`DR/DRG/DRA/PROF/H/HJ/KNA/KGEH/...`, `SP.xx`, `SpA`, dst.), buang tanda baca, buang token 1 huruf.
2. Skor: token cocok bila sama atau jarak Levenshtein ≤ 1 (token ≥ 5 huruf). Tier: EXACT (semua token sama), SUBSET (≥ 2 token, himpunan satu sisi ⊆ sisi lain), FUZZY (Dice ≥ 0,7, ≥ 2 token).
3. Beberapa kandidat EXACT dengan skor sama = duplikat orang yang sama di `Customer` (terobservasi, mis. satu dokter tersimpan dua kali dengan format berbeda) — aman dipakai, ambil yang `kodeCustomer`-nya terisi.

Prototipe algoritma sudah dijalankan untuk pengukuran di `01-business-rules.md` §4; saat implementasi dijadikan `scripts/importMclRekomendasi.ts` mengikuti pola `scripts/importStrukturVerifiedKAM.ts`.

## Server action untuk UI

Satu action baru `getMclDokterByOutlet(kodePI)` (dibuat saat implementasi UI) membaca `MclRekomendasiDokter` per `kodePI` (index `kodePI`) dan mengembalikan rekomendasi per dokter; dipakai bersama oleh dropdown, blok sidebar Standarisasi, dan section POA Estimasi (satu panggilan per outlet terpilih, di-cache di komponen). `getCustomersByOutlet` tidak dimodifikasi.

## Performa

Sumber 321 ribu baris sebelum dedupe (±316 ribu sesudah). Aturan wajib (`docs/PERFORMANCE.md`): **semua query MCL di-scope per `kodePI`** (satu outlet yang sedang dipilih) — tidak ada query company-wide ke `MclRekomendasiDokter`. Agregat lintas outlet (mis. ringkasan per RS segrup) hanya dari `OutletProdukListing` (±41 ribu baris, ber-index `kodePI`). Import dilakukan di luar jalur request (script), bukan lewat server action.
