# POA Handover per GT (orang resign)

**Sumber requirement:** permintaan atasan via pengguna, 2026-10-09: "Untuk orang yang resign, tolong datanya di keep as GT code, supaya nanti ketika orang baru masuk, mereka datanya tidak hilang."

**Status:** 🟢 Diimplementasikan 2026-10-09 (`ownerHandoverSync.ts`, terjadwal di `orgAndOutletScheduler`; belum dijalankan `--apply` di DB manapun — dry-run: 15 POA pindah, 4 belum ada pemegang, 1 ambigu). Keputusan pengguna: POA/Standarisasi/SC pindah otomatis ke pemegang baru; KPI/absensi tidak. Pemegang ditentukan lewat assignment outlet (bukan `kodeGT`, alasan di `01-business-rules.md` §2).

## Ringkasan
GT (`Outlet.kodeGT`/`namaGT`) adalah unit penugasan: 1 GT = 1 MR/SPV (`prisma/schema.prisma` komentar `TargetHospitalValue`). Target sudah per GT tanpa field personil sejak 2026-09-14, jadi tidak hilang saat orang resign. `PoaForm` masih terikat ke NIP (`ownerId`); org sync menonaktifkan user yang resign (`User.isActive=false`), dan POA-nya tidak otomatis jatuh ke orang baru di GT yang sama. Spec ini menyimpan GT di POA dan memindahkan kepemilikan ke pemegang GT baru.

## Dokumen
1. [`01-business-rules.md`](./01-business-rules.md) — aturan, perilaku gagal, open questions.
