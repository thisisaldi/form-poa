# POA Handover per GT — Business Rules

*Sumber requirement: lihat `README.md`.*

## 1. Fakta di kode saat ini (diverifikasi 2026-10-09)
| Hal | Kondisi |
|---|---|
| Target | `TargetHospitalValue`/`TargetNonHospitalValue` per `(namaGT, periode)`, tanpa personil; pemegang dicari live (`resolveLiveGTHolderChain`). **Sudah memenuhi requirement**, hanya perlu diverifikasi. |
| POA | `PoaForm.ownerId` → `User.nip`. Tidak ada kolom GT. Satu MR = satu POA per kuartal (guard dilonggarkan 2026-10-07). |
| Resign | `runOrgSync` pass 3: `isActive=false` untuk user yang hilang dari Nexus (hanya `project: null`; Omega manual). Data tidak dihapus. |
| Approval | `PoaDoctorApproval` per (POA, outlet, dokter), `currentHolderId` menunjuk approver, bukan owner. |

## 2. Aturan (diimplementasikan 2026-10-09, `src/lib/sync/ownerHandoverSync.ts`)
**Perubahan dari draft awal:** "GT" ditentukan lewat **assignment outlet**, bukan kolom `kodeGT`. Alasan (diukur 2026-10-09): `Outlet.kodeGT` hanya terisi 605 dari 36.339 outlet (1,7%) dan 0 dari outlet milik 32 POA user nonaktif; `User.kodeWilayah` hanya terisi untuk Omega dan kosong untuk user nonaktif. Lewat assignment, 15 dari 32 POA yatim langsung punya pemegang baru.

| # | Aturan |
|---|---|
| R1 | Tiap hari setelah org+outlet sync (langkah terakhir `orgAndOutletScheduler`): untuk `PoaForm`, `PoaStandarisasi`, dan `PoaScForm` yang `owner.isActive=false`, cari MR aktif (non-dummy) yang punya `MrOutletAssignment` periode terbaru pada outlet dokumen itu (untuk `PoaForm`: gabungan outlet line item). |
| R2 | Tepat satu MR kandidat → `ownerId` dipindah. Nol (GT masih kosong) atau lebih dari satu (ambigu) → dilewati dan dihitung di log. POA tanpa line item tidak disentuh. |
| R3 | `PoaForm`: dicatat di `PoaAuditLog` (`action=UPDATE`, `snapshot={event:"HANDOVER_GT", fromOwner, toOwner}`, actor = owner baru). |
| R4 | Status, versi, approval per dokter, `dealAt`, `usedInExodus` tidak berubah; dokter Deal tetap terkunci. Berlaku untuk semua kuartal, termasuk yang berjalan (keputusan pengguna 2026-10-09: "pindah semua"). |
| R5 | Selama GT kosong, dokumen tetap utuh dan terlihat atasan seperti sekarang. |
| R6 | KPI/absensi (KPI Personil) **tidak** dipindah (keputusan pengguna). Target sudah per GT. |
| R7 | `PoaScForm` punya `@@unique([kodePI, periodeAwal, ownerId])`; bentrok dengan form milik owner baru → baris tetap, error dilaporkan. |

Skrip: `npx tsx --env-file=.env scripts/runOwnerHandover.ts [--apply]` (dry-run default).

## 3. Perilaku gagal
Sync gagal atau Nexus kosong: tidak ada pengalihan (guard "implausible drop" `orgStructureSync.ts` tetap berlaku). Pengalihan idempoten: dijalankan ulang tidak mengubah apa pun jika owner sudah aktif.

## 4. Open questions — status & asumsi
| # | Pertanyaan | Status |
|---|---|---|
| Q1 | Satu MR memegang lebih dari satu GT? | Tidak relevan: aturan memakai assignment outlet, tepat satu kandidat. Kasus ambigu (1 dari 32) dilewati. |
| Q2 | Orang baru di tengah kuartal | ✅ Mewarisi (keputusan pengguna). |
| Q3 | KPI/absensi ikut? | ✅ Tidak (keputusan pengguna). |
| Q4 | Deal ikut dipindah? | ✅ Ya, tetap terkunci ("pindah semua"). |
| Q5 | Notifikasi ke owner baru | Tidak di v1. |
| Q6 | MR baru ditugaskan di sebagian outlet saja | ⚠️ Asumsi: kandidat tunggal cukup, walau tidak menutup semua outlet POA (14 dari 15 kasus menutup semuanya). |

## 5. Non-goals
Mengubah `ownerId` untuk owner yang masih aktif; menggabungkan dua POA; memindahkan data KPI; `PoaStandarisasiPusat` (milik HKA, bukan per GT).
