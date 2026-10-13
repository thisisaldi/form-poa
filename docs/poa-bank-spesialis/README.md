# Bank Spesialis — Produk Kontes & warning spesialisasi (2026-10-13)

Permintaan (dari tim, via Aldi): (1) update data Produk Kontes memakai sheet **Bank Spesialis** di
`internal/data Rekomendasi dokter Per Hospital dan per Spesialist.xlsx`; (2) bridging spesialis untuk
rekomendasi PSSP + **warning** bila estimasi produk tidak sesuai spesialisasi dokternya.

## Keputusan (dikonfirmasi Aldi 2026-10-13)

| Hal | Keputusan |
|---|---|
| Produk Kontes | = semua produk di sheet Bank Spesialis (166 kode unik, 17 spesialis, 680 baris). Menggantikan daftar lama "Paket Produk Kontes PM" (PAKET PEDIATRIC/PENCERNAAN/…). |
| "Paket" | Sekarang = nama spesialis kanonik Bank. `getAllPakets(nama)` non-kosong ⇔ Produk Kontes; `getProductTier` tier 0 ⇔ produk direkomendasikan untuk spesialis dokter. |
| Warning | Non-blocking, di picker produk `LineItemEditor` (di bawah warning duplikat). Muncul hanya bila spesialisasi dokter punya padanan di Bank DAN produk tidak ada di daftar spesialis itu. |
| Bridge spesialisasi | Sheet "list spesialisasi" TIDAK ada di workbook; "List Dokter PSSP" tidak punya kolom spesialis. Dipakai alias dari DB/Exodus → 17 nama Bank (`BANK_ALIAS` di `src/lib/bankSpesialis.ts`). Spesialisasi tanpa padanan (GP, THT, Kulit, …) → tidak ada warning. |

## Implementasi

- **Sumber kebenaran = tabel `BankSpesialis`** (migrasi `20261013120000_bank_spesialis`, seed 677 pasangan dari sheet). Dikelola ADMIN di halaman Admin → panel "Bank Spesialis" (lihat/cari/filter, tambah, hapus, edit Keterangan), tanpa deploy.
- `src/lib/bankSpesialis.ts` (pure, aman client): indeks modul-level + helper `canonicalBankSpesialis`, `isProdukSesuaiSpesialisasi` (true/false/null), `bankKeterangan`, `bankSpesialisForNama`. Alias spesialisasi DB/Exodus → nama Bank ada di sini (`BANK_ALIAS`).
- `src/lib/bankSpesialisStore.ts` (server): `loadBankSpesialis()` baca tabel (+ `Product.namaProduk` per kode karena ejaan Excel bisa beda), cache 30 dtk. Dipanggil di `(app)/layout.tsx`, summary, export tim, export POA, dan `targetCalculation`.
- `BankSpesialisProvider` mengisi indeks client dari layout. `paketProduk.ts` (`getAllPakets`, `getProductTier`, `getPaketsBySpesialisasi`) membaca indeks itu.
- `src/lib/bankSpesialisData.ts` (generated `scripts/generateBankSpesialisData.py`) hanya **fallback** bila tabel gagal dibaca; bukan sumber utama.

## Dampak yang perlu diketahui

- Produk Kontes naik dari daftar lama ke 166 produk → tile/tabel "Produk Kontes" di Ringkasan, `computeKontesProductTargetsSummary`, export Excel, dan DraftChecklist ikut memakai definisi baru (semuanya lewat `getAllPakets`).
- Label paket di picker (`sublabel`) kini nama spesialis, bukan "PAKET …".
- Kolom **Keterangan** Bank (95 baris terisi) bisa dilihat/diedit di panel Admin, belum ditampilkan ke MR di UI.
- **Prod butuh migrasi** `20261013120000_bank_spesialis` (CREATE TABLE + seed). Tanpa migrasi, loader jatuh ke data fallback (perilaku sama dengan seed), tapi panel Admin error.
- Spesialis baru tidak bisa dibuat dari panel (hanya 17 nama yang ada); ejaan lain harus ditambah di `BANK_ALIAS`.
- Sheet "Bank Spesialis - Edit" (keterangan lebih lengkap) tidak dipakai — sesuai permintaan memakai "Bank Spesialis".

## Regenerasi fallback / seed ulang

1. Dump sheet "Bank Spesialis" (kolom A–D, baris 4+) ke JSON `[{spesialis,kode,nama,ket}]` (openpyxl read_only; exceljs OOM karena workbook 36MB).
2. Dump `Product` untuk kode-kode itu → `[{kodeProduk,namaProduk}]`.
3. `python -I scripts/generateBankSpesialisData.py bank.json master.json`.
