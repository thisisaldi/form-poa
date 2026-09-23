# PSSP Trend Warning — UI & Access

## Role/access matrix (v1)

| Role | Lihat warning | Trigger snapshot job |
|---|---|---|
| MR | Badge di halaman POA/summary milik sendiri saja | Tidak |
| ASM/SM/NSM | Belum ada rollup v1 (lihat Non-goals) | Tidak |
| ADMIN | Sama seperti MR (bisa lihat semua kalau buka summary orang lain, ikut `getSubordinateMRNips`), plus tombol manual trigger snapshot | Ya (manual, tombol) |
| GM/SFE/VIEWER | Read-only, sama pola `getSubordinateMRNips` existing | Tidak |

Reuse `getSubordinateMRNips` (`src/lib/authz.ts:126-148`) buat scoping — TIDAK bikin RBAC baru terpisah.

## Halaman yang diusulkan

- **Badge di `/summary`** (halaman existing, `src/app/(app)/summary/page.tsx`) — di dekat chart "PSSP Rencana vs Aktif" yang sudah ada (`RingkasanCharts.tsx`), tambah baris kecil kalau `totalBulanIni < snapshot bulan lalu`. Reuse pola warning-badge yang sudah ada di app ini (lihat `PoaStandarisasiWizard.tsx`'s margin warning card, warna `var(--color-error)` kalau kondisi buruk).
- **Tombol manual "Ambil Snapshot Bulan Ini"** — ADMIN-only, sama pola `kpi-monitoring`'s "Sync Absensi dari SIPP" (`docs/kpi-monitoring/README.md` §Update 2026-08-24), sampai job otomatis (cron) dianggap perlu.

## Non-goals v1

- **Tidak ada rollup ke dashboard ASM/SM/NSM** — v1 cuma badge personal per MR. Kalau nanti dibutuhkan atasan bisa lihat semua bawahannya yang turun sekaligus (mis. list/tabel), itu perluasan terpisah, butuh keputusan UI baru (halaman baru atau tambahan di Monitoring existing).
- **Tidak ada notifikasi push/email/WhatsApp** — warning cuma visual (badge di halaman), user harus buka halaman untuk lihat. Tidak ada sistem notifikasi proaktif di v1.
- **Tidak ada cron/scheduled job otomatis** — snapshot bulanan di-generate manual (tombol ADMIN) dulu, bukan otomatis di akhir bulan. Lihat Open Question #3 di `01-business-rules.md`.
- **Tidak ada logic yang otomatis bedain "berhenti wajar" vs "berhenti tanpa tindak lanjut"** — keputusan intervensi (perpanjang/peremajaan/ganti dokter) sepenuhnya manual oleh atasan, sistem cuma kasih sinyal turun/tidak.
- **Tidak menyentuh kategori "PS Peremajaan"** — itu perbaikan terpisah (re-enable field existing di `LineItemEditor.tsx:1357`), lihat catatan di `01-business-rules.md` bagian pembuka.
