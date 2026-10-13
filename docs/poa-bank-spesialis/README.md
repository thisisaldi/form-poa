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

- `scripts/generateBankSpesialisData.py` → `src/lib/bankSpesialisData.ts` (generated; jangan edit tangan). Key nama produk memuat ejaan Excel DAN `Product.namaProduk` (beda ejaan pada sebagian kode).
- `src/lib/bankSpesialis.ts`: `canonicalBankSpesialis`, `isProdukSesuaiSpesialisasi` (true/false/null), `bankKeterangan`.
- `src/lib/paketProduk.ts`: `PAKET_BY_PRODUK` & `getPaketsBySpesialisasi` membaca Bank. `SPESIALISASI_TO_PAKET` tinggal dipakai sebagai daftar key dropdown spesialisasi (nilainya legacy).

## Dampak yang perlu diketahui

- Produk Kontes naik dari daftar lama ke 166 produk → tile/tabel "Produk Kontes" di Ringkasan, `computeKontesProductTargetsSummary`, export Excel, dan DraftChecklist ikut memakai definisi baru (semuanya lewat `getAllPakets`).
- Label paket di picker (`sublabel`) kini nama spesialis, bukan "PAKET …".
- Kolom **Keterangan** Bank (95 baris terisi) sudah ikut di-generate (`BANK_KETERANGAN`) tapi belum ditampilkan di UI.
- Sheet "Bank Spesialis - Edit" (keterangan lebih lengkap) tidak dipakai — sesuai permintaan memakai "Bank Spesialis".

## Regenerasi

1. Dump sheet "Bank Spesialis" (kolom A–D, baris 4+) ke JSON `[{spesialis,kode,nama,ket}]` (openpyxl read_only; exceljs OOM karena workbook 36MB).
2. Dump `Product` untuk kode-kode itu → `[{kodeProduk,namaProduk}]`.
3. `python -I scripts/generateBankSpesialisData.py bank.json master.json`.
