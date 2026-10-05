# UI & Access — Approval Level Dinamis

## Approver per level

Sama dengan `getPoaStandarisasiApprovers` (`authz.ts:853`, rantai `nipAtasan` dari MR pembuat pengajuan, fallback `Outlet.coveredByNip/coveredByRole`), diperluas dua level ke atas mengikuti pola POA Estimasi (`poaWorkflow.ts` APPROVAL_CHAIN):

| Level | Role di DB | Cara resolve |
|---|---|---|
| ASM | `ASM` | atasan langsung MR (sudah ada) |
| SM | `SM` | atasan ASM (sudah ada) |
| NSM | `NSM` | atasan SM (sudah ada) |
| ASD | `GM` (nama "ASD" hanya label, lihat komentar `Role.SD` di schema) | atasan NSM, hanya dipercaya kalau role-nya `GM` (pola "vacant level" yang sama seperti ASM/SM). Kosong → SD menyetujui level ASD langsung (Q1) |
| SD | `SD` | atasan ASD, atau atasan NSM langsung kalau ASD kosong dan role-nya `SD` (kasus nyata NSM 995338 → P200134) |

`ADMIN` tetap bisa bertindak di semua level (pola `canApprovePoaStandarisasiAtasan` sekarang).

## Aturan akses aksi approve

`canApprovePoaStandarisasiAtasan` diganti versi per produk-level: user boleh menyetujui baris (produk, level) kalau (1) role + NIP-nya = approver level itu, (2) semua level di bawahnya untuk produk itu `DISETUJUI`/`DILEWATI`, (3) pengajuan di fase `APPROVAL_ATASAN`. Melihat pengajuan: `canViewPoaStandarisasi` diperluas supaya ASD/SD approver bisa melihat (sekarang cuma owner, ASM/SM/NSM, dan role read-only company-wide).

> **Catatan implementasi (2026-09-30)**: dikerjakan. Approver juga punya `/approvals` (`PoaStandarisasiApprovalSection`, "tampilan atasan" 2026-09-10), yang sekarang mendukung level ASM..SD. Daftar/detail `/poa-standarisasi` dibuka ke MR, ASM, SM, NSM, GM, SD, SFE, VIEWER, ADMIN (konstanta `POA_STANDARISASI_VIEW_ROLES`, `lib/role.ts`), membalik keputusan 2026-09-10 yang MR/ADMIN saja. Daftar: `listVisiblePoaStandarisasiAction` — satu query `ownerId in getSubordinateOwnerNips` (+ milik sendiri), 300 terbaru; tombol Buat/Export/Hapus hanya untuk MR/ADMIN/owner. Detail dijaga `canViewPoaStandarisasi` (ditambah role SD); edit tetap owner-only. Export Excel tetap milik sendiri (belum diperluas).

## Akses halaman (jawaban user 2026-09-29: "ikuti POA PSSP")

Sekarang daftar `/poa-standarisasi` dan detail `/poa-standarisasi/[id]` redirect semua role selain `MR`/`ADMIN` ke `/dashboard` (`page.tsx:24`, `[id]/page.tsx:16`), padahal `canViewPoaStandarisasi` (`authz.ts:886`) sudah mengizinkan lebih banyak role. Fitur ini membuka halaman itu mengikuti pola visibilitas POA PSSP (`getVisiblePoaFilter`, `authz.ts:191`):

| Role | Melihat di daftar/detail | Bisa apa |
|---|---|---|
| MR | pengajuan sendiri | edit fase 1/3/4/Step 5 (seperti sekarang) |
| ASM / SM / NSM | milik sendiri + bawahan (depth 1/2/3 via `nipAtasan`) | approve level-nya sendiri |
| GM (ASD) | company-wide (tanpa akun dummy) | approve level ASD kalau resolved approver; selain itu read-only |
| SD | asumsi sama dengan GM (belum dikonfirmasi) | approve level SD |
| SFE / VIEWER | company-wide, read-only | tidak ada aksi |
| ADMIN | semua | semua (seperti sekarang) |
| SALES_SUPPORT | tetap hanya halaman memo | — |

Perubahan: (1) Sidebar item "POA Standarisasi" roles diperluas; (2) redirect di kedua `page.tsx` dilonggarkan; (3) action daftar baru (bukan `listMyPoaStandarisasiAction`, yang owner-only) memakai filter visibilitas per role; (4) `canViewPoaStandarisasi` menambah ASD/SD approver. Daftar untuk role company-wide WAJIB mengikuti `docs/PERFORMANCE.md` (satu query berpaginasi, approver di-resolve batch, bukan `getPoaStandarisasiApprovers` per baris).

## UI Fase 2 (`PoaStandarisasiApprovalSection`)

- Tabel produk × level: tiap baris produk menampilkan chip level yang dibutuhkan (ASM…SD) dengan status per chip (Menunggu / Disetujui oleh X tgl / Ditolak / Dilewati) dan Disc PI yang jadi dasarnya.
- Approver melihat produk yang giliran level-nya, dengan tombol Setujui/Tolak per produk plus "Setujui semua yang menunggu saya".
- Ringkasan atas: "Butuh approval sampai: X" (level tertinggi antar produk) dan progres (n dari m baris disetujui).
- Komponen yang dipakai ulang: `PoaStandarisasiApprovalSection`, `discountApprovalLevel` untuk chip.

## Non-goals v1

- Tidak ada eskalasi manual (Q5) dan tidak ada notifikasi ke approver berikutnya (sama dengan non-goal induk).
- Tidak ada antrean "menunggu approval saya" company-wide untuk ASD/SD (approver membuka pengajuannya sendiri, seperti ASM/SM sekarang).
- Tidak memanggil Exodus `approval-level` (PSSP) — tabel level dihitung lokal.
- Tidak mengubah approval DPL/DPF Step 5 di Exodus (kolom "Level Approval" di form Ajukan tetap info saja).
- Jalur reject/revisi tidak dirancang di sini (Q2, sama dengan induk).
