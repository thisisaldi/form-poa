# POA Standarisasi Pusat — Data Model

## §1. Sudah ada, dipakai ulang tanpa perubahan skema
`Outlet`, `Product`, `OutletSalesMonthly`, `getDiskonByOutlets`, `discountApprovalLevel` (`src/lib/discountApprovalLevel.ts`), `User.jabatan` (display-only override, dipakai untuk label "DIR").

## §2. Baru (butuh migration)

Blok di bawah rancangan; nama enum/tipe kolom diverifikasi terhadap `schema.prisma` saat implementasi.

```prisma
// Outlet
hkaGroup String? // "Primaya", "Siloam", ... — null = di luar cakupan HKA (tidak kena gateway)
@@index([hkaGroup])

// User
isHka Boolean @default(false) // kapabilitas HKA, terpisah dari `role`

enum PoaStandarisasiPusatPhase { APPROVAL_ATASAN APPROVAL_USER_DOKTER FINALISASI } // tanpa PLANNING: create langsung masuk APPROVAL_ATASAN

model PoaStandarisasiPusat {
  id               String   @id @default(uuid())
  ownerId          String
  owner            User     @relation(fields: [ownerId], references: [nip])
  hkaGroup         String
  tipeStandarisasi TipeStandarisasi
  periodeBulan     Int?
  currentPhase     PoaStandarisasiPusatPhase @default(PLANNING)
  submittedAt      DateTime?
  suratApprovalFilePath    String?
  suratApprovalDriveFileId String?
  produk           PoaStandarisasiPusatProduk[]
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([hkaGroup, submittedAt])
}

model PoaStandarisasiPusatProduk {
  id                           String @id @default(uuid())
  pengajuanId                  String
  pengajuan                    PoaStandarisasiPusat @relation(fields: [pengajuanId], references: [id], onDelete: Cascade)
  kodeProduk                   String
  product                      Product @relation(fields: [kodeProduk], references: [kodeProduk])
  skemaPembayaran              SkemaPembayaran @default(DISKON)
  estimasiDiskonPct            Decimal? @db.Decimal(5, 2)
  estimasiDiskonDistributorPct Decimal? @db.Decimal(5, 2)
  estimasiValueDpRp            Decimal? @db.Decimal(18, 2)
  catatan                      String?
  approvals                    PoaStandarisasiPusatProdukApproval[]
  dokter                       PoaStandarisasiPusatDokter[]

  @@unique([pengajuanId, kodeProduk])
}

// Dokter boleh dari outlet mana pun di grup — outlet milik dokter wajib punya
// Outlet.hkaGroup = pengajuan.hkaGroup, divalidasi di server.
model PoaStandarisasiPusatDokter {
  id         String @id @default(uuid())
  produkId   String
  produk     PoaStandarisasiPusatProduk @relation(fields: [produkId], references: [id], onDelete: Cascade)
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
  wajib      Boolean @default(true)
  sudahTtd   Boolean @default(false)
  createdAt  DateTime @default(now())

  @@unique([produkId, customerId])
  @@index([produkId])
}

model PoaStandarisasiPusatProdukApproval {
  id           String @id @default(uuid())
  produkId     String
  produk       PoaStandarisasiPusatProduk @relation(fields: [produkId], references: [id], onDelete: Cascade)
  level        String // "ASM" | "SM" | "NSM" | "ASD" | "SD" — snapshot, vocab sama dengan PoaStandarisasiProdukApproval
  status       StatusApprovalAtasan @default(MENUNGGU)
  autoApproved Boolean @default(false)
  approverNip  String?
  decidedAt    DateTime?

  @@unique([produkId, level])
}
```

## §3. Catatan desain
- **Model terpisah, bukan melonggarkan `PoaStandarisasi.kodePI`**: wizard/sidebar/Step 5 cabang mengasumsikan `kodePI` non-null (FK ke `Outlet`); melonggarkannya berisiko merusak flow produksi yang sudah jalan. Pusat tidak punya outlet/dokter/KPDM sehingga skemanya jauh lebih kecil.
- **`hkaGroup` kolom baru, bukan `groupRS`**: `groupRS` (dari `updateOutletGroupRS.ts`) adalah grup korporat luas termasuk "NON CHAIN" dan dipakai sidebar existing; daftar HKA subset kurasi 255 outlet dengan penamaan sendiri. Tidak dicampur supaya sidebar existing tidak berubah. Index ada karena gateway query `WHERE hkaGroup = ?` pada tabel Outlet 35k+ baris (`docs/PERFORMANCE.md`).
- **`User.isHka` bukan `Role` baru**: Widodo dan Masril tetap NSM; satu user = satu `Role`, menggantinya menghilangkan akses NSM mereka.
- **Dokter pusat = checklist TTD saja** (`wajib`, `sudahTtd`), tanpa kolom estimasi pasien/resep dan tanpa log ganti-dokter di v1 (alasan ganti tetap divalidasi di server tapi dicatat belakangan jika dibutuhkan); `Customer` tidak punya outlet-FK langsung ke grup, jadi validasi grup lewat outlet milik dokter tersebut.
- **Level di-snapshot** (`level` string), alasan sama dengan cabang: perubahan tabel level tidak mengubah pengajuan berjalan.
- **Invariant**: 1 baris approval per (produk, level); `autoApproved=true` hanya untuk level ≤ level pembuat; pengajuan final (`submittedAt` terisi) tidak bisa diubah; `hkaGroup` pengajuan tidak berubah setelah dibuat.
- **Query gateway (b)**: `PoaStandarisasiPusat` dengan `hkaGroup = G AND submittedAt NOT NULL AND produk.some(kodeProduk = P)` — dilayani index `(hkaGroup, submittedAt)`.

## §4. Import grup
`scripts/importHkaGroups.ts` (baru): baca `internal/Grouping Hospital Key Account (1).xlsx` (kolom: No, Kode Outlet, Nama Outlet, Outlet Grup; hanya 255 baris terisi dari ~1045). Set `Outlet.hkaGroup` per `kodePI`; idempotent; outlet tak ditemukan dilaporkan, tidak dibuat; dry-run default, `--apply` untuk menulis. Script yang sama set `User.isHka = true` untuk 3 NIP (tidak membuat user baru; lapor jika NIP tidak ada). Tidak ada sumber live (dikonfirmasi) — update grup = jalankan ulang dengan file baru.
