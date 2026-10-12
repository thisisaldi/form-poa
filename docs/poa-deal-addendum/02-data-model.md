# Gelombang Baru untuk Dokter Deal — Data Model

## 1. Perubahan skema (usulan)
```prisma
model PoaLineItem {
  // ...
  batch Int @default(1) // gelombang approval; semua data lama = 1
  @@index([poaId, kodePI, namaCust, batch])
}

model PoaDoctorApproval {
  // ...
  batch Int @default(1)
  @@unique([poaId, kodePI, namaCust, batch]) // menggantikan @@unique([poaId, kodePI, namaCust])
}
```
Migrasi: tambah kolom `batch` default 1 (data lama otomatis gelombang 1), ganti unique index. Tidak ada data yang ditulis ulang.

## 2. Kode yang terdampak (diukur 2026-10-09)
- **Identitas dokter:** 13 pemakaian `poaId_kodePI_namaCust` (`poa.ts` ×9, `lineItem.ts` ×2, `poaWorkflow.ts`, `poa/[id]/doctor/[itemId]/edit/page.tsx`, `api/poa-doctors/[id]/route.ts`), semuanya menjadi `(…, batch)` atau helper "gelombang aktif".
- **Pengelompokan dokter di UI/laporan:** `DraftChecklist`, `ApprovalsChecklist`, `poa/[id]/page.tsx`, `dashboard/page.tsx`, `lib/poaDoctorsRows.ts`, `api/poa-doctors/route.ts`, export `poa/[id]` dan `export/team`, `authz.ts` (lock level per dokter), `pendingApprovalHolderSync.ts`.
- **Kontrak eksternal:** `/api/poa-doctors` dan PATCH `/api/poa-doctors/[id]` (Q1).
- **Rollup:** `resolvePoaRollup` (R5).

## 3. Invariant
Tiap `(poaId, kodePI, namaCust)` punya gelombang berurutan 1..N tanpa celah; hanya gelombang N yang boleh belum Deal; baris dan approval gelombang ber-`batch` sama; gelombang Deal tidak pernah diubah.

## 4. Fase usulan
| Fase | Isi |
|---|---|
| 1 | Migrasi + helper "gelombang aktif" + semua lookup membawa `batch` (perilaku tidak berubah, semua data = 1). |
| 2 | Pembuatan gelombang baru saat menambah baris ke dokter Deal (R2), lock/approval per gelombang. |
| 3 | UI: label gelombang, daftar dan approval per gelombang. |
| 4 | Laporan/export, `/api/poa-doctors` + koordinasi Exodus. |

## 5. Catatan implementasi (2026-10-09)
- **Gelombang aktif dibaca dari BARIS** (`max(PoaLineItem.batch)` per dokter), bukan dari approval, karena `PoaDoctorApproval` baru dibuat saat submit pertama gelombang itu. Helper: `src/lib/poaDoctorApproval.ts` (`getActiveBatch`, `findApprovalByBatch`, `findActiveApproval`).
- Karena hanya gelombang terbesar yang boleh belum Deal, semua aksi approval (submit/approve/reject/cancel/edit request/hapus dokter) tetap bersignature `(poaId, kodePI, namaCust)` dan bekerja pada gelombang aktif; hanya edit/hapus baris yang membaca gelombang barisnya.
- Kunci UI: `doctorKeyOf` (`src/lib/doctorKey.ts`) — gelombang 1 identik dengan kunci lama, gelombang >= 2 diberi `|N`.
- Menambah baris untuk dokter yang gelombang aktifnya Deal: baris dibuat dengan `batch = aktif + 1`, tanpa menyentuh approval gelombang Deal, lalu rollup POA dihitung ulang (gelombang baru = DRAFT).
- Hapus dokter hanya menghapus gelombang aktif; ditolak bila gelombang aktif sudah Deal.
