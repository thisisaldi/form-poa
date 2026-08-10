# Kategori Rejection POA — Data Model

## Data yang sudah ada (tidak berubah)

- `PoaAuditLog` (`prisma/schema.prisma:362-378`) — `action AuditAction`, `fromStatus`/`toStatus PoaStatus?`, `snapshot Json @default("{}")`, `createdAt`, relasi ke `poaId`/`actorId`. Append-only (tidak pernah di-update/delete setelah dibuat — invariant yang sudah berlaku, bukan baru).
- `snapshot` sudah menyimpan `notes` (alasan bebas) sebagai key JSON biasa, ditulis lewat `applyTransition()`'s `snapshotExtra` param (`src/lib/poaWorkflow.ts:125,159`) — mekanisme merge sudah ada: `snapshot: { ...(notes ? { notes } : {}), ...snapshotExtra }`.

## Pilihan desain: kolom enum baru vs key JSON baru

**Rekomendasi: kolom enum baru `rejectCategory` pada `PoaAuditLog`, nullable.**

```prisma
enum PoaRejectCategory {
  PRODUK
  OUTLET
  USER
  PERIODE
  KALKULASI_PSSP
  ALASAN_LAIN
}

model PoaAuditLog {
  id         String      @id @default(uuid())
  action     AuditAction
  fromStatus PoaStatus?
  toStatus   PoaStatus?
  snapshot   Json        @default("{}")
  rejectCategory PoaRejectCategory?   // NEW — hanya diisi untuk action REJECT (dan CANCEL kalau OQ-1 dijawab "ketiganya")
  createdAt  DateTime    @default(now())

  poaId String
  poa   PoaForm @relation(fields: [poaId], references: [id])

  actorId String
  actor   User   @relation(fields: [actorId], references: [nip])

  @@index([poaId])
  @@index([actorId])
}
```

### Catatan desain — kenapa kolom, bukan key JSON

Dua opsi dipertimbangkan:

1. **Key JSON baru** (`snapshot.category`, tanpa migration) — paling cepat diimplementasikan (reuse `snapshotExtra` apa adanya, tidak sentuh schema), tapi **tidak bisa di-query/agregasi secara efisien** oleh Postgres (`snapshot` adalah `Json` biasa, bukan `Jsonb` dengan index) — kalau nanti dibutuhkan laporan "berapa reject per kategori per bulan" (lihat `01-business-rules.md` OQ-5), setiap query harus full-scan dan parse JSON di aplikasi.
2. **Kolom enum typed** (direkomendasikan) — butuh 1 migration kecil (tambah kolom nullable + enum baru, non-breaking untuk data lama karena nullable), tapi bisa langsung di-`groupBy`/filter di Prisma, dan validasinya otomatis dijamin oleh Postgres enum constraint (server tidak bisa "lupa" validasi whitelist seperti disebutkan di `01-business-rules.md` §5) — lebih robust dan sejalan dengan kemungkinan besar OQ-5 (kategori akan dipakai laporan).

Migration ini **non-breaking**: kolom baru nullable, seluruh `PoaAuditLog` lama (event sebelum fitur ini ada) otomatis `rejectCategory = null` — tidak perlu backfill, dan kode yang membaca `snapshot.notes` untuk render Riwayat Aktivitas tetap jalan apa adanya (lihat `03-ui-and-access.md`).

## Invariant

- `rejectCategory` HANYA diisi (non-null) untuk baris `PoaAuditLog` dengan `action = REJECT` (dan `CANCEL` jika OQ-1 di `01-business-rules.md` dijawab mencakup form Batalkan Approval) — untuk action lain (`CREATE`/`UPDATE`/`SUBMIT`/`APPROVE`/dst) selalu `null`. Constraint ini ditegakkan di level aplikasi (server action), bukan di skema — Prisma/Postgres tidak punya conditional-required-field native untuk kasus ini.
- `PoaAuditLog` tetap append-only — kolom baru ini tidak mengubah invariant itu, hanya menambah field yang diisi saat create.

## Cross-reference performa

Tabel `PoaAuditLog` sudah punya index `poaId`/`actorId`, dibaca per-POA (Riwayat Aktivitas satu POA) — bukan company-wide-unbounded. Kalau OQ-5 (laporan agregat "reject per kategori company-wide") jadi kebutuhan nyata di masa depan, itu query BARU yang perlu tunduk ke constraint `docs/PERFORMANCE.md` (tambah index `rejectCategory` kalau perlu, dan jangan scan company-wide tanpa filter periode) — di luar scope v1 spec ini.
