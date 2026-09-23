# SP Non Sales Memo — Data Model

Semua keputusan inti RESOLVED (`01-business-rules.md` §3) — model di bawah final untuk v1, bukan draft lagi. Sisa open question (§7 #5-9) tidak mengubah struktur skema, cuma detail scope/asumsi kecil.

## Data yang sudah ada (reuse)

- `PoaStandarisasiProduk.spNonSalesJumlahBox` (`prisma/schema.prisma`, dipakai `poaStandarisasi.ts:1393-1405`) — sumber "Qty (Box)" di tabel memo.
- `PoaStandarisasi.distributors` — sumber data distributor (dipakai buat proses SP Non Sales, walau tidak muncul eksplisit di tabel memo §4 — perlu dicek apa masih relevan sebagai konteks memo atau cuma internal).
- `Product.principalName` (`schema.prisma:658`) — calon sumber kolom "PT NIE" di tabel memo (`01-business-rules.md` §4) — BELUM dikonfirmasi cocok persis.
- `Product.kodeProduk`/`namaProduk`, `Outlet.namaOutlet`+`kodePI`, `PoaStandarisasi.ownerId`→`User.name` (Nama Pengusul) — semua sudah ada, tinggal di-map ke kolom tabel memo.
- Pola checkbox sign: `DokterApproval.sudahTtd` (dipakai `poaStandarisasi.ts:1104,1120-1123`) — reuse pola BOOLEAN + siapa/kapan, bukan bikin state machine baru.
- `GoogleDriveConfig.spNonSalesFolderId` — reuse sebagai lokasi simpan file memo generated (satu-satunya versi file, tidak ada versi "hasil sign" terpisah — §1.3: tidak ada upload ulang). Pola `GoogleDriveConfig` (satu row config global, ADMIN-settable) juga tempat nyimpen 2 nama penanda-tangan fixed (`01-business-rules.md` §4) — lihat field config baru di bawah.

## Perubahan pada `enum Role` (schema.prisma:12-33)

```prisma
enum Role {
  MR
  ASM
  SM
  NSM
  GM
  ADMIN
  SFE
  VIEWER
  SD
  SALES_SUPPORT   // baru — scope dibatasi ke POA Standarisasi saja, lihat 01-business-rules.md §2
}
```

## Field baru di `PoaStandarisasi`

```prisma
// Ditambahkan ke model PoaStandarisasi existing:
spNonSalesMemoNomor       String?    // nomor memo tercetak, format "DSS / IX / POA001.26" — di-generate saat memo pertama kali dibuat, immutable setelahnya
spNonSalesMemoAlasan      String?    // alasan pengajuan (contoh: "Donasi Rumah Sakit"), diisi MR saat generate — 01-business-rules.md §7 #8
spNonSalesMemoNoSp        String?    // "No SP memo ini [10 digit] (PML)" di footer — diisi manual oleh Sales Support sendiri (RESOLVED, §4), editable terpisah dari generate (Sales Support bisa isi belakangan)
spNonSalesMemoGeneratedAt DateTime?  // kapan memo digenerate — SATU kali, file tidak pernah diganti lagi setelahnya (tidak ada upload ulang)
spNonSalesMemoDriveFileId String?    // file memo hasil generate (satu-satunya versi, permanen) di Google Drive
spNonSalesSignedAt        DateTime?  // kapan Sales Support centang "sudah di-sign"
spNonSalesSignedByNip     String?    // NIP Sales Support yang centang (self-report, bukan approval berlapis — 01-business-rules.md §1.3)
```

```prisma
// Config 2 nama penanda-tangan fixed (01-business-rules.md §4) — ditambah ke
// GoogleDriveConfig existing (satu row config global, ADMIN-settable) atau
// tabel config sejenis kalau GoogleDriveConfig dianggap kurang cocok secara
// penamaan:
spNonSalesMemoSignerHormatKami String? // nama di blok "Hormat kami," (contoh: "Christiana Meyta")
spNonSalesMemoSignerMenyetujui String? // nama di blok "Menyetujui," (contoh: "M.Nugraha")
```

```prisma
// Counter nomor memo, model baru terpisah — bukan field di PoaStandarisasi,
// karena nomornya per-PERIODE (tahun berjalan, RESOLVED §7 #9), bukan
// per-pengajuan.
model SpNonSalesMemoCounter {
  periode String @id // YYYY — reset tiap tahun (RESOLVED 2026-09-23, §7 #9)
  seq     Int    @default(0) // nomor urut terakhir dipakai tahun ini, dicetak "POA[seq 3-digit]"
}
```

### Catatan desain

- Field sign (`spNonSalesSignedAt`/`spNonSalesSignedByNip`) polanya SAMA PERSIS dengan `DokterApproval.sudahTtd` — pasangan timestamp+NIP, bukan enum status bertingkat, karena flow-nya emang cuma 1 langkah centang (dikonfirmasi user, bukan approval berlapis).
- `spNonSalesMemoNomor` di-generate SEKALI (immutable) pakai `SpNonSalesMemoCounter` — increment atomik (`prisma.$transaction` + `update` dengan `increment`, sama pola row-lock yang dipakai counter lain di app ini kalau ada) supaya tidak ada 2 memo pakai nomor sama saat 2 request generate bersamaan.
- `spNonSalesMemoDriveFileId` sengaja **satu file, bukan array** (beda dari `PoaStandarisasiSpNonSalesDocument` existing yang bisa banyak file) — RESOLVED: memang cuma ada SATU versi file, tidak pernah diganti (tidak ada upload ulang/re-generate berulang di v1). Simple by design, bukan lagi sekadar asumsi.
- Dependency generation dokumen: `docxtemplater` (isi placeholder `{{namaField}}` ke file Word master yang dibuat dari foto §4) — **belum ada di `package.json`**, perlu ditambah. Cocok karena template sudah fix (1 halaman, metadata + 1 tabel), dan hasil generate cukup didownload/dilihat langsung (tidak perlu diedit lagi di sistem — §1.3).
- `spNonSalesMemoAlasan` diisi MR sekali saat generate (bagian dari trigger generate). `spNonSalesMemoNoSp` beda siklus — diisi Sales Support KAPAN SAJA setelah memo ada (field edit terpisah, phase-agnostic, sama pola `updateSpNonSalesDistributorsAction` existing yang juga edit field pasca-generate tanpa re-generate ulang dokumennya). Keduanya nullable.

## Performance

Role baru dengan scope company-wide dalam POA Standarisasi (lihat asumsi §2) berarti listing memo Sales Support berpotensi company-wide — **baca `docs/PERFORMANCE.md` sebelum implementasi** kalau listing-nya tanpa pagination/filter tanggal.
