# POA Approval Per Dokter — Data Model (usulan, belum diimplementasikan)

## Data yang sudah ada (reused tanpa perubahan skema)

- `PoaLineItem` — tetap 1 baris per (dokter × outlet × produk), tidak berubah. `doctorKey` (`kodePI` + `namaCust`) tetap cara yang sama untuk mengelompokkan baris jadi 1 "dokter" (`docs/form-poa/01-business-rules.md` §2).
- `PoaStatus` enum — direuse untuk status per-dokter (lihat model baru di bawah), TIDAK diusulkan menambah value baru di enum ini.
- `AuditAction` enum — direuse untuk mencatat aksi per-dokter, dengan penambahan referensi ke record dokter (lihat `PoaAuditLog` di bawah).
- `User`/`reportsTo` hierarchy, `resolveNextHolder` — logic resolusi approver berikutnya tetap sama persis, cuma dipanggil per-dokter alih-alih per-draft.

## Data baru (memerlukan migration) — USULAN, belum final

```prisma
// Status approval per-dokter di dalam 1 PoaForm — unit approval yang baru,
// menggantikan PoaForm.status sebagai sumber kebenaran untuk "di level mana
// dokter ini sedang direview" (lihat 01-business-rules.md §3 untuk kenapa
// PoaForm.status sendirian tidak lagi cukup begitu 1 draft bisa berisi
// dokter dengan status campuran).
model PoaDoctorApproval {
  id      String  @id @default(uuid())
  poaId   String
  poa     PoaForm @relation(fields: [poaId], references: [id], onDelete: Cascade)

  // Identitas dokter dalam draft ini — sama namespace dengan PoaLineItem
  // (kodePI + namaCust = doctorKey, docs/form-poa/01-business-rules.md §2).
  // Didenormalisasi di sini (bukan FK ke 1 PoaLineItem tertentu) karena 1
  // dokter punya BANYAK PoaLineItem (1 per produk) — record approval ini
  // merepresentasikan grup baris tsb, bukan 1 baris spesifik.
  kodePI   String
  namaCust String

  status          PoaStatus @default(SUBMITTED_TO_ASM)
  // Sama pola dengan PoaForm.version — naik tiap kembali ke REVISI.
  version         Int       @default(1)
  currentHolderId String?
  currentHolder   User?     @relation(fields: [currentHolderId], references: [nip])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([poaId, kodePI, namaCust])
  @@index([poaId])
  @@index([currentHolderId])
  @@index([status])
}
```

```prisma
// PoaAuditLog — tambahan field opsional (BUKAN model baru) supaya event
// per-dokter (approve/reject dokter tertentu) tetap tercatat di riwayat
// aktivitas yang sama, dibedakan dari event level-draft (CREATE, UPDATE
// bebas-dokter) lewat field ini bernilai null.
model PoaAuditLog {
  // ...existing fields tidak berubah...
  doctorApprovalId String?
  doctorApproval    PoaDoctorApproval? @relation(fields: [doctorApprovalId], references: [id], onDelete: SetNull)

  @@index([doctorApprovalId])
}
```

## Catatan desain (draft, tunduk pada jawaban open questions §01-business-rules.md)

- **Kenapa model terpisah, bukan field di `PoaLineItem`**: 1 dokter = banyak `PoaLineItem` (1 per produk) yang harus bergerak sebagai 1 unit (§1). Menyimpan status di tiap baris produk akan mendupliksi nilai yang sama N kali dan berisiko drift (baris produk A dan B milik dokter yang sama punya status beda karena bug) — pola yang sama dengan alasan field level-dokter (`labelCustomer`, `hariKerjaBulan`, dst.) sudah didesain "diduplikasi tapi disinkronkan lewat state editor", BUKAN pola yang aman untuk status approval yang harus strictly konsisten. Model terpisah dengan `@@unique([poaId, kodePI, namaCust])` menjamin 1 sumber kebenaran per dokter per draft.
- **`PoaForm.status`**: TIDAK dihapus di usulan ini (kompatibilitas mundur, prinsip #14 quality checklist) — tapi maknanya perlu didefinisikan ulang jadi rollup (OQ-1, `01-business-rules.md` §3a) begitu ada ≥1 `PoaDoctorApproval` untuk POA tsb. Draft yang belum pernah displit (belum ada row `PoaDoctorApproval` sama sekali — status masih DRAFT) tetap pakai `PoaForm.status` apa adanya; row `PoaDoctorApproval` baru dibuat SAAT submit pertama (1 row per dokter yang ada di draft itu saat itu).
- **Dokter baru ditambahkan setelah submit**: kalau MR menambah dokter baru ke draft yang sebagian dokternya sudah in-review/approved, dokter baru itu perlu row `PoaDoctorApproval` sendiri yang mulai dari DRAFT/belum-submit — invariant `@@unique([poaId, kodePI, namaCust])` menjamin ini tidak bentrok dengan dokter existing. Perilaku submit-nya sendiri termasuk OQ-2 (belum settled).
- **Invariant yang berlaku** (draft, akan diperbarui begitu blocking OQ terjawab):
  - Setiap `PoaLineItem` yang sudah pernah displit-approval WAJIB punya tepat 1 `PoaDoctorApproval` yang matching `(poaId, kodePI, namaCust)`-nya — tidak boleh ada baris produk tanpa record approval dokter begitu draft sudah pernah disubmit.
  - `PoaDoctorApproval.version` naik SETIAP kali kembali ke REVISI, sama pola dengan `PoaForm.version` — tapi sekarang per-dokter, bukan per-draft (draft yang campuran punya dokter-dokter di "Version" berbeda-beda).
  - `PoaAuditLog` append-only tetap berlaku, cuma sekarang sebagian log punya `doctorApprovalId` (event per-dokter) dan sebagian tidak (event level-draft seperti CREATE).

⚠️ Skema di atas adalah TITIK AWAL untuk didiskusikan, bukan final — beberapa keputusan (§3a OQ-1 terutama) bisa mengubah bentuknya signifikan, mis. kalau `PoaForm.status` diputuskan pensiun total, field itu bisa jadi nullable/dihapus di migration terpisah setelah masa transisi.

## Constraint performa

`PoaDoctorApproval` berpotensi di-query company-wide (approval inbox atasan, dashboard Summary/Monitoring — lihat `docs/form-poa/03-ui-and-access.md`, `docs/PERFORMANCE.md`). Index `currentHolderId` dan `status` di atas WAJIB dipakai secara konsisten oleh query inbox, bukan filter di memory setelah `findMany` tanpa `where` — ikuti checklist `docs/PERFORMANCE.md` §2 saat implementasi.
