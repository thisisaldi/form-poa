# PSSP Trend Warning — Business Rules

Sumber requirement (WhatsApp Brian Lembong, 17/09/2026 18:06):

> Di PoA Q4 harusnya Total PS/SP Aktif + Rencana tiap bulannya naik. Kalau turun dengan alasan ada PS/SP berhenti pun harusnya justru diintervensi atasan kenapa tidak diperpanjang. Kalau tidak diperpanjang karena mesti dibuat peremajaan, mestinya peremajaannya juga dibuatkan PoA. Kalau dianggap tidak poten, maka harusnya diganti dokter lain juga. Karena kalau ini hanya naik turun, harapan kita untuk PS/SP aktif tiap MR naik akan lambat untuk kesampaian.
>
> Tim dari 2 poin ini di sistem PoA bisa dikembangkan:
> 1. Warning kalau tiap bulannya malah turun
> 2. Pastikan bisa membuat PoA peremajaan (tapi mestinya ini konsepnya PS sih, jadi di sistem sudah ada. Tapi apa untuk mendorong orang-orang nginput dengan baik, dibuat kategori PS dan PS peremajaan)

Dokumen ini cuma cover poin 1 (warning). Poin 2 (kategori PS Peremajaan) sudah punya jalur sendiri — enum `JenisPssp.PSSP_PEREMAJAAN` dan label-nya sudah ada di skema (`prisma/schema.prisma:88-91`, `LineItemEditor.tsx:99-104`), tapi field-nya sengaja didisable di UI (`{false && (...)}`, `LineItemEditor.tsx:1357`). Itu perbaikan kecil (re-enable field existing), tidak butuh SDD terpisah — bisa dikerjakan independen dari dokumen ini.

## §1 Definisi istilah

| Istilah | Definisi | Sumber |
|---|---|---|
| PSSP Rencana | Nilai rencana PSSP dari `PoaLineItem`, diapportion per bulan lewat `computeMonthlyBreakdown` (`src/lib/poaUtils.ts`) | Reuse dari Summary, sudah ada |
| PSSP Aktif | Kontrak `PsspKontrak` yang masih aktif (`prdAkhir >= periode berjalan`) di outlet-outlet yang di-cover MR terkait, via `getActivePsspByOutlets` (`src/app/actions/customer.ts:353-393`) | Reuse dari Summary, sudah ada |
| Total PS/SP Aktif + Rencana | Rencana + Aktif dijumlah, per MR, per bulan | Baru — belum ada di kode manapun sebagai satu angka gabungan |
| MR | Individual sales rep, role `MR`. Scoping visibilitas antar-level pakai `getSubordinateMRNips` (`src/lib/authz.ts:126-148`), sudah dipakai Summary | Reuse |
| Turun (MoM) | `total(bulan_ini) < total(bulan_lalu)`, per MR | Baru — threshold persentase/absolut belum diputuskan, lihat Open Questions |

## §2 Keterbatasan data existing (kenapa perlu snapshot baru)

Chart Summary punya "Aktif Q-Sebelumnya" (`summary/page.tsx:1029`, `tercacahAktifForQuarter`), tapi ini **bukan** snapshot historis asli — dihitung ulang dari `PsspKontrak` yang aktif **hari ini** (`prdAkhir >= currentPeriod` saat query jalan), lalu di-apportion ke bulan-bulan kuartal lalu. Kontrak yang SEMPAT aktif bulan lalu tapi sudah berakhir sebelum hari ini tidak akan terhitung di pembanding ini (lihat komentar `summary/page.tsx:1301-1309`, sudah diketahui/didokumentasikan sebagai known approximation di fitur existing).

Untuk warning bulan-ke-bulan yang mau dipakai buat intervensi atasan (bukan cuma tren kasar di chart), approximation ini kurang cocok — kalau PS/SP MR berhenti bulan lalu, warning harus tetap kebaca bulan itu turun, walau kontraknya sekarang sudah tidak ada sama sekali di `PsspKontrak`. Makanya butuh tabel snapshot yang ditulis di akhir tiap bulan (angka dibekukan saat itu), bukan re-query data live untuk bulan yang sudah lewat. Detail model di `02-data-model.md`.

## §3 Formula (v1, working assumption)

```
totalBulanIni  = sum(Rencana bulan ini, per MR) + sum(Aktif bulan ini, per MR)
totalBulanLalu = snapshot tersimpan bulan lalu (per MR)
turun = totalBulanIni < totalBulanLalu
```

Warning muncul kalau `turun == true`. Tidak ada threshold persentase minimum di v1 — penurunan berapa pun (termasuk 1 unit) memicu warning. Ini asumsi kerja, lihat Open Questions.

## §7 Open questions — status & assumptions dipakai untuk v1

| # | Pertanyaan | Asumsi v1 | Blocking? | Perlu konfirmasi dari |
|---|---|---|---|---|
| 1 | Threshold "turun" — sembarang penurunan (bahkan 1 unit), atau ada ambang persentase (mis. >5%)? | Sembarang penurunan (turun = turun, tidak ada ambang) | Tidak — bisa diubah tanpa migration, cuma ganti perbandingan di kode | Brian Lembong |
| 2 | Warning tampil di mana — badge personal per MR di halaman POA-nya sendiri, rollup ke dashboard atasan (ASM/SM/NSM), atau keduanya? | v1 = badge personal per MR saja (lihat `03-ui-and-access.md`) | **Ya** — nentuin halaman & role matrix yang dibangun | User (product owner internal), lalu konfirmasi ke Brian Lembong |
| 3 | Snapshot di-generate otomatis (cron/scheduled job akhir bulan) atau manual trigger (tombol, sama pola KPI Absensi sync)? | Manual trigger dulu (tombol ADMIN, sama pola `kpi-monitoring`'s "Sync Absensi dari SIPP") — cron nyusul kalau sudah stabil | Tidak — bisa nyusul tanpa ubah skema | Internal, bukan blocking eksternal |
| 4 | "PS/SP berhenti karena alasan sah" (habis kontrak wajar, bukan churn) vs "berhenti tanpa tindak lanjut" — apa warning perlu bedain ini, atau semua penurunan diperlakukan sama dan biar atasan yang nilai manual? | v1: tidak dibedakan — semua penurunan trigger warning yang sama, keputusan intervensi (perpanjang/peremajaan/ganti dokter) tetap di tangan atasan secara manual, sistem cuma kasih sinyal | Tidak — bisa ditambah nanti kalau kebutuhannya jelas | Brian Lembong (kalau butuh nuance ini) |
