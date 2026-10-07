# POA Standarisasi Pusat — UI & Access

## §1. Access matrix

| Siapa | Lihat pengajuan pusat | Buat/edit | Approve |
|---|---|---|---|
| `User.isHka` (Ahsanul, Widodo, Masril) | semua | ya | hanya level yang cocok perannya dan belum auto-lolos (Ahsanul → ASD) |
| SD (Brian P200134) | semua | tidak | level SD |
| GM, VIEWER, ADMIN | semua (read-only oversight, pola `POA_STANDARISASI_VIEW_ROLES` di `src/lib/role.ts`) | ADMIN saja untuk koreksi | ADMIN seperti pola cabang untuk level kosong |
| MR/ASM/SM/NSM non-HKA | tidak (hanya melihat pesan gateway di Planning cabang) | tidak | tidak |

Helper di `src/lib/hka.ts` (bukan `authz.ts`, murni tanpa DB): `canViewPusat`, `canApprovePusatLevel`, `hkaCreatorLevel`, `isAutoApprovedLevel`. Edit = owner/ADMIN sebelum submit (`canEditPusat` di actions).

## §2. Halaman
- `/poa-standarisasi/pusat` — daftar pengajuan pusat (tabel sederhana), tombol "Buat Pengajuan Pusat" (HKA saja). Link lewat tombol "Standarisasi Pusat (HKA)" di halaman `/poa-standarisasi` (untuk HKA + GM/SD/VIEWER/ADMIN), bukan item Sidebar (session tidak membawa `isHka`).
- `/poa-standarisasi/pusat/[id]` — wizard 4 fase; komponen sendiri (`PusatCreateForm`, `PusatDetail`): chip level per produk, "setujui semua produk yang menunggu saya", dan checklist dokter Approval User/Dokter dengan pemilih dua langkah (outlet di grup → dokter); tanpa KPDM.
- **Planning cabang** (`PoaStandarisasiWizard.tsx`): pre-check `checkHkaGatewayAction` sebelum create/save menampilkan pesan blokir (§2); penegakan tetap di server (create/savePlanning). Penanda per produk di pemilih belum ada.
- Label jabatan Ahsanul "DIR" lewat `User.jabatan` (display-only, sudah ada).

## §3. Non-goals v1
Lihat `01-business-rules.md` §6.
