# Data Model — Approval Level Dinamis

## Sudah ada (dipakai ulang, tanpa perubahan skema)

| Data | Dipakai untuk |
|---|---|
| `PoaStandarisasiProduk.estimasiDiskonPct` | Angka penentu level (§2 business rules) |
| `PoaStandarisasi.statusApprovalAsm/Sm/Nsm` + `tanggalApproval*` | Jalur lama — dipertahankan untuk pengajuan yang sudah berjalan (Q3) |
| `User.nipAtasan`, `Role.GM`, `Role.SD` | Rantai approver ASD/SD (pola POA Estimasi, `poaWorkflow.ts` `approvalCeiling`/APPROVAL_CHAIN) |

## Baru (butuh migration)

```prisma
enum ApprovalLevelStandarisasi {
  ASM
  SM
  NSM
  ASD
  SD
}

// Satu baris per produk × level yang dibutuhkan. Dibuat sekali saat
// advanceToApprovalAtasanAction (snapshot level dari estimasiDiskonPct saat itu).
model PoaStandarisasiProdukApproval {
  id String @id @default(uuid())

  produkId String
  produk   PoaStandarisasiProduk @relation(fields: [produkId], references: [id], onDelete: Cascade)

  level ApprovalLevelStandarisasi
  // Diskon PI yang dipakai saat snapshot — jejak kenapa level ini muncul.
  diskonPctSnapshot Decimal @db.Decimal(10, 4)

  status        StatusApprovalAtasan @default(MENUNGGU) // enum yang sudah ada (MENUNGGU/DISETUJUI/DITOLAK)
  decidedByNip  String? // NIP plain (tanpa relasi), sama pola spNonSalesSignedByNip
  decidedAt     DateTime?

  @@unique([produkId, level])
  @@index([produkId])
}
```

`PoaStandarisasiProduk` mendapat relasi balik `approvals PoaStandarisasiProdukApproval[]`.

## Catatan desain

- **Child table, bukan kolom di produk**: 5 level × (status, tanggal, NIP) = 15 kolom nullable; child table juga membuat "level yang dibutuhkan" = baris yang ada, tanpa kolom `requiredLevel` tambahan.
- **Snapshot, bukan live-derive**: `diskonPctSnapshot` + keberadaan baris membekukan hasil tabel level saat masuk Fase 2 (§2).
- **Invariant**: (a) unik `(produkId, level)`; (b) baris hanya dibuat oleh `advanceToApprovalAtasanAction`, tidak pernah ditambah/dihapus setelahnya (rantai tidak berubah selama Fase 2); (c) baris level N `DISETUJUI` hanya jika semua level < N produk itu `DISETUJUI`; (d) Cascade delete mengikuti produk (produk hanya bisa dihapus di Fase 1).
- **Performa**: dibaca per pengajuan (paling banyak ~N produk × 5 baris), tidak ada halaman company-wide baru; `docs/PERFORMANCE.md` tidak terpicu. Kalau nanti ada antrean "menunggu saya" company-wide untuk ASD/SD, baca `PERFORMANCE.md` dulu.
- **Migrasi data lama**: tidak ada backfill. Pengajuan yang sudah lewat Planning saat rilis tetap di jalur lama (`statusApproval*` header); kode harus mengenali jalur mana lewat "ada baris `PoaStandarisasiProdukApproval` untuk pengajuan ini atau tidak".
