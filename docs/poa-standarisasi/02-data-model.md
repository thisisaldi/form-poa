# POA Standarisasi — Data Model

## Data yang sudah ada (reuse, tanpa perubahan skema)

| Model/field existing | Dipakai untuk |
|---|---|
| `Outlet` (`prisma/schema.prisma:483`) | Pilihan outlet di Planning — **butuh 2 field baru**, lihat "Perubahan ke model existing" di bawah |
| `Product` (`:532`) | Pilihan produk per kartu, sumber `hna`/`konversiPembagi`/`satuan` untuk HNA SJ/ST |
| `Customer` (`:226`) + `getCustomersByOutlet()` (`src/app/actions/customer.ts:609`) | Dropdown dokter klinis per produk (bukan diketik manual). **WAJIB** fungsi ini, bukan `getCustomersByOutletSpesialisasi()` (`:498`) — `getCustomersByOutlet` sudah Nexus-primary untuk `spesialisasi` sejak 2026-08-13, sedangkan yang lain query kolom `Customer.spesialisasi` lokal yang dikonfirmasi pengguna **salah mapping-nya** (2026-08-14, lihat `01-business-rules.md` §1) |
| `SurveyRekomendasi` (`:301`) + `getSurveyRekomendasiByOutlet()`/`getKriteriaByOutlet()` (`customer.ts:797`/`:677`) | Sidebar Data Survey/Produk Rekomendasi |
| `getSurveyRekomendasiInfo(kodeCustomer, kodePI, kodeProduk)` (`customer.ts:763`) | "Golongan yang Dipakai Saat Ini" per dokter di kartu produk — resolved Q1: reuse persis fungsi ini (sama yang dipakai "Produk Kompetitor Utama" POA Estimasi), dipanggil per dokter yang dipilih, **live-derive tiap render, tidak disimpan sebagai FK** |
| `uploadFileToSurveyDrive()` (`src/lib/googleDrive.ts:47`) | Upload dokumen (Form Approval Standarisasi, Surat Approval Standarisasi KFT) ke Google Drive service account — pola sama dengan `SurveyUploadLog` |
| `hargaST()`/`satuanLabel()` (`LineItemEditor.tsx:203`/`:319`) | **Perlu di-extract** ke `src/lib/productLabels.ts` (atau file shared serupa) supaya bisa diimpor dari kedua sisi tanpa duplikasi — saat ini hanya ada sebagai fungsi lokal tidak ter-export di `LineItemEditor.tsx` |
| `formatPeriodeRange()`/`expandPeriodeMonths()`/`computeMonthlyBreakdown()` (`src/lib/poaUtils.ts`) | Formatting periode, konsisten dengan POA Estimasi |
| `getSubordinateMRNips()` / pola hierarki `nipAtasan` (`src/lib/authz.ts`) | Resolusi approver ASM/SM di Phase 2 (lihat Q3) |
| `Role` enum (`MR`, `ASM`, `SM`, `NSM`, `GM`, `ADMIN`, `SFE`, `VIEWER`) | **Tidak perlu role baru** — lihat `03-ui-and-access.md`, "KFT" di UI adalah nama dokumen bukan role |

**Dikonfirmasi TIDAK ada model `Distributor`** di `prisma/schema.prisma` saat ini (grep 2026-08-13, tidak ada match) — jadi model baru di bawah bukan duplikasi.

## Perubahan ke model existing

```prisma
model Outlet {
  // ...field existing tidak berubah...
  jumlahBed Int? // baru — lihat 01-business-rules.md §7 Q8 (sumber data belum pasti: sync vs manual)
}
```

## Model baru

```prisma
enum PoaStandarisasiPhase {
  PLANNING
  APPROVAL_ATASAN
  APPROVAL_USER_DOKTER
  FINALISASI
}

enum TipeStandarisasi {
  PERIODIC
  SISIPAN
  PERMANEN
}

enum StatusApprovalAtasan {
  MENUNGGU
  DISETUJUI
  DITOLAK
}

enum DokumenStandarisasiJenis {
  NIE
  CPOB
  KFA
  SP_NON_SALES
}

model KpdmStandarisasi {
  id        String  @id @default(uuid())
  nama      String  @unique
  jabatanId String?
  jabatan   JabatanStandarisasi? @relation(fields: [jabatanId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  pengajuan PoaStandarisasi[]

  @@index([nama])
}

model JabatanStandarisasi {
  id   String @id @default(uuid())
  nama String @unique

  kpdm KpdmStandarisasi[]

  createdAt DateTime @default(now())
}

// Master distributor — dropdown biasa (bukan creatable seperti KPDM/Jabatan),
// dikelola ADMIN. Dikonfirmasi belum ada tabel serupa di schema saat ini.
model Distributor {
  id   String @id @default(uuid())
  nama String @unique

  isActive Boolean @default(true)

  pengajuan PoaStandarisasi[]

  createdAt DateTime @default(now())
}

// Header pengajuan — satu row = satu Outlet, berisi N produk (PoaStandarisasiProduk).
model PoaStandarisasi {
  id String @id @default(uuid())

  ownerId String
  owner   User   @relation(fields: [ownerId], references: [nip])

  kodePI String
  outlet Outlet @relation(fields: [kodePI], references: [kodePI])

  kpdmId String
  kpdm   KpdmStandarisasi @relation(fields: [kpdmId], references: [id])

  // Snapshot nama/jabatan di waktu pengajuan dibuat — KpdmStandarisasi bisa
  // berubah jabatannya di masa depan, tapi pengajuan ini harus tetap merefer
  // ke apa yang berlaku SAAT pengajuan dibuat (sama alasannya dengan kenapa
  // PoaLineItem menyimpan namaCust/namaOutlet sebagai snapshot, bukan cuma FK).
  kpdmNamaSnapshot    String
  jabatanNamaSnapshot String?

  kpdmEntertainEstimasi Decimal? @db.Decimal(18, 2)
  kpdmEntertainFinal    Decimal? @db.Decimal(18, 2) // default = estimasi saat pertama masuk Finalisasi, lalu independen

  tipeStandarisasi TipeStandarisasi
  // Ditambahkan 2026-08-26 (docs/TODO.md #12, TIDAK ada di draft asli dokumen
  // ini) — field manual (bukan derived), dipilih MR di Planning: apakah
  // pengajuan ini standarisasi BARU atau PERPANJANGAN dari yang sudah pernah
  // ada di outlet ini. Default BARU. Enum `StatusPengajuanStandarisasi`,
  // lihat `prisma/schema.prisma`.
  statusPengajuan  StatusPengajuanStandarisasi @default(BARU)
  periodeBulan     Int? // wajib utk PERIODIC/SISIPAN, null utk PERMANEN — divalidasi di server action, bukan constraint DB (kondisional antar-field)

  jumlahBedRs               Int? // snapshot dari Outlet.jumlahBed saat dipilih, tapi editable & tersimpan independen
  estimasiTimelineSelesai   DateTime?

  currentPhase PoaStandarisasiPhase @default(PLANNING)

  statusApprovalAsm   StatusApprovalAtasan @default(MENUNGGU)
  statusApprovalSm    StatusApprovalAtasan @default(MENUNGGU)
  tanggalApprovalAsm  DateTime?
  tanggalApprovalSm   DateTime?

  jadwalMeetingKft DateTime?

  distributorId String?
  distributor   Distributor? @relation(fields: [distributorId], references: [id])

  // Per 01-business-rules.md §7 Q6 — asumsi: satu file untuk seluruh
  // pengajuan, bukan per produk.
  suratApprovalStandarisasiKftPath String?
  suratApprovalStandarisasiKftDriveFileId String?

  submittedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  produk PoaStandarisasiProduk[]

  @@index([ownerId])
  @@index([kodePI])
  @@index([currentPhase])
}

model PoaStandarisasiProduk {
  id String @id @default(uuid())

  pengajuanId String
  pengajuan   PoaStandarisasi @relation(fields: [pengajuanId], references: [id], onDelete: Cascade)

  kodeProduk String
  product    Product @relation(fields: [kodeProduk], references: [kodeProduk])

  // TIDAK ada FK ke SurveyRekomendasi di sini — "Golongan yang Dipakai Saat
  // Ini" di-resolve LIVE per dokter via getSurveyRekomendasiInfo() (resolved
  // Q1, 01-business-rules.md §7), sama pola dengan bagaimana POA Estimasi
  // TIDAK menyimpan FK SurveyRekomendasi di PoaLineItem sama sekali.

  // ── Estimasi Standarisasi (Planning) — input mentah ─────────────────────
  jumlahPasien     Int?
  resepPerPasienSt Decimal? @db.Decimal(10, 2)

  // Nilai PER BULAN (resolved Q4, 01-business-rules.md §7) — bukan total
  // periode, TIDAK dikalikan periodeBulan. Nama field sengaja eksplisit
  // "PerBulan" supaya tidak disalahartikan sebagai total oleh pembaca kode
  // di masa depan. Computed di server dari jumlahPasien × resepPerPasienSt ×
  // hargaST(product) — TIDAK trust dari client.
  estimasiQtyPerBulan    Decimal? @db.Decimal(18, 2)
  estimasiNilaiRpPerBulan Decimal? @db.Decimal(18, 2)

  estimasiDiskonPct   Decimal? @db.Decimal(10, 4)
  estimasiBiayaListingRp Decimal? @db.Decimal(18, 2)
  estimasiEntertainRp    Decimal? @db.Decimal(18, 2)

  // ── Finalisasi Biaya ──────────────────────────────────────────────────
  finalDiscountPct       Decimal? @db.Decimal(10, 4)
  diskonDistributorPct   Decimal? @db.Decimal(10, 4)
  finalBiayaListingRp    Decimal? @db.Decimal(18, 2)
  // finalEntertain TIDAK ada di sini lagi — dihitung dari SUM PoaStandarisasiDokterUser.entertainRp

  formApprovalFilePath      String?
  formApprovalDriveFileId   String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  dokterApproval PoaStandarisasiDokterApproval[]
  dokterUser     PoaStandarisasiDokterUser[]
  dokumen        PoaStandarisasiDokumen[]

  @@unique([pengajuanId, kodeProduk])
  @@index([pengajuanId])
}

// Dokter Klinis (Planning) — checklist "sudah TTD" per produk, BUKAN approval
// in-app oleh dokter (lihat 01-business-rules.md §1 & §6).
model PoaStandarisasiDokterApproval {
  id String @id @default(uuid())

  produkId String
  produk   PoaStandarisasiProduk @relation(fields: [produkId], references: [id], onDelete: Cascade)

  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])

  wajib    Boolean @default(true)
  sudahTtd Boolean @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([produkId, customerId])
  @@index([produkId])
}

// "Dokter yang Akan Menjadi User" (Finalisasi) — entitas TERPISAH dari
// PoaStandarisasiDokterApproval meski defaultnya di-seed dari dokter yang
// sudah TTD di Phase 3: field & tujuannya beda (di sini ada Jumlah
// Pasien/Resep per Pasien/Entertain, bukan sekadar checklist), dan MR bisa
// mengganti dokternya di Finalisasi tanpa mengubah histori approval Phase 3.
model PoaStandarisasiDokterUser {
  id String @id @default(uuid())

  produkId String
  produk   PoaStandarisasiProduk @relation(fields: [produkId], references: [id], onDelete: Cascade)

  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])

  jumlahPasien     Int?
  resepPerPasienSt Decimal? @db.Decimal(10, 2)

  // Nilai PER BULAN, sama seperti level produk — computed di server, formula
  // sama (01-business-rules.md §3) — bukan input manual.
  estimasiQtyPerBulan     Decimal? @db.Decimal(18, 2)
  estimasiSalesRpPerBulan Decimal? @db.Decimal(18, 2)

  entertainRp Decimal? @db.Decimal(18, 2) // manual, tidak ada formula

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([produkId, customerId])
  @@index([produkId])
}

// NIE/CPOB/KFA/SP Non Sales — download-only, per produk.
model PoaStandarisasiDokumen {
  id String @id @default(uuid())

  produkId String
  produk   PoaStandarisasiProduk @relation(fields: [produkId], references: [id], onDelete: Cascade)

  jenis       DokumenStandarisasiJenis
  namaFile    String
  driveFileId String

  createdAt DateTime @default(now())

  @@unique([produkId, jenis])
  @@index([produkId])
}
```

## Catatan desain

- **Snapshot vs live-derive**: `kpdmNamaSnapshot`/`jabatanNamaSnapshot` di `PoaStandarisasi` dan seluruh field `estimasi*`/`final*` di `PoaStandarisasiProduk` adalah SNAPSHOT tersimpan (bukan live-derive saat render) — sama alasannya dengan `PoaLineItem.namaCust`/`namaProduk` di POA Estimasi: master data (`KpdmStandarisasi`, `Product`) bisa berubah setelah pengajuan dibuat, tapi histori pengajuan yang sudah submit tidak boleh ikut berubah kalau master datanya diedit belakangan.
- **Kenapa `PoaStandarisasiDokterApproval` dan `PoaStandarisasiDokterUser` dipisah** (bukan satu tabel dengan flag): field-nya beda total (checklist vs input finansial) dan siklus hidupnya beda (yang pertama dikunci begitu Phase 3 selesai — histori approval TTD tidak boleh berubah lagi di Finalisasi; yang kedua baru mulai diisi di Phase 4 dan MR boleh ganti dokternya). Menyatukan keduanya berarti banyak field nullable-tergantung-phase yang membingungkan.
- **`estimasiQtyPerBulan`/`estimasiNilaiRpPerBulan`/`estimasiSalesRpPerBulan` semuanya nullable** karena baru terisi setelah `jumlahPasien`+`resepPerPasienSt` diisi DAN dihitung ulang di server (form draft state sebelum lengkap punya nilai null, bukan 0 — beda makna: 0 = dihitung dan hasilnya nol, null = belum dihitung). Semua field ini adalah nilai **per bulan** (resolved Q4) — jangan dikalikan `periodeBulan`/`lamaPeriode` di titik manapun tanpa keputusan bisnis baru.
- **`periodeBulan` nullable** karena validasi wajib/tidaknya kondisional ke `TipeStandarisasi` (lihat `01-business-rules.md` §5) — tidak bisa jadi constraint DB `NOT NULL` biasa, divalidasi di server action seperti pola validasi kondisional lain di repo ini.
- **Invariant**: `PoaStandarisasiProduk` unik per `(pengajuanId, kodeProduk)` — satu produk tidak boleh muncul dua kali dalam satu pengajuan. `PoaStandarisasiDokterApproval`/`PoaStandarisasiDokterUser` unik per `(produkId, customerId)` — satu dokter tidak boleh diduplikasi di satu produk yang sama. `PoaStandarisasiDokumen` unik per `(produkId, jenis)` — hanya satu file aktif per jenis dokumen per produk (upload baru menimpa, bukan menambah histori — beda dengan `SurveyUploadLog` yang append-only, karena di sini dokumennya representasi "current state", bukan log kejadian).
- **Model ini tidak company-wide/berat secara query** — `PoaStandarisasi` di-scope per outlet dan dibuat oleh satu MR, tidak ada agregasi lintas seluruh perusahaan yang diusulkan di v1 (beda dengan Summary/dashboard reguler). Kalau nanti dibuat halaman monitoring company-wide untuk fitur ini, itu WAJIB baca `docs/PERFORMANCE.md` dulu sebelum ditulis (constraint index/N+1/pagination) — dicatat di sini sebagai pengingat untuk v2, bukan kebutuhan v1.
- **Tidak membawa field vestigial** (`SubStatusApprovalKft`, `tanggalSubmitKft`, dst. dari draft dokumen sumber sebelum v12) — lihat `01-business-rules.md` §2, ini fitur greenfield jadi tidak ada alasan menyimpan kolom yang sudah diketahui tidak dipakai sejak awal.
