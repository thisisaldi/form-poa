# Evaluasi Kontrak Non-Hospital — UI & Access

*(Skeleton: prototipe di `internal/Evaluasi Kontrak Non-Hospital.html` — dipakai sebagai patokan **struktur dan fitur**, bukan styling. Styling mengikuti komponen dan token yang sudah ada di aplikasi, seperti `/kpi-perpanjangan`.)*

## 1. Role / access matrix (v1)

| Role | Melihat daftar & Detail Skor | Memutuskan / menyetujui | Import data kontrak | Export Excel |
|---|---|---|---|---|
| ADMIN | ✅ semua personil | ✅ | ✅ | ✅ |
| Lainnya | ❌ (redirect ke `/summary`) | ❌ | ❌ | ❌ |

⚠️ ADMIN-only untuk v1, sama seperti `/kpi-perpanjangan` (`src/app/actions/kpi.ts` `requireAdmin`). Memo Hospital menyebut atasan (SM untuk ASM/SPV/MR, NSM untuk SM) sebagai pemutus; role matrix final ikut OQ-8 dan **harus** terhubung ke `getSubordinateMRNips`/pola `authz.ts` yang ada, bukan RBAC baru. Semua server action tulis wajib melewati `assertWritable` (`src/lib/maintenance.ts`).

## 2. Halaman

| Route | Isi | Komponen yang dipakai ulang |
|---|---|---|
| `/evaluasi-kontrak-non-hospital` | Header + pemilih periode akhir kontrak, kartu ringkasan, toolbar filter, tabel evaluasi, tombol Export | `Card`, `Button`, `SortableTh`, pola `KpiTable`/`KpiDashboardStats`/`KpiPeriodPicker`/`kpiUi.ts` (`scoreTone`, `TONE_STYLE`, `periodLabel`) |

### Kartu ringkasan (dari prototipe)
Total Personil (rincian per jabatan) · Rata-rata Total Score (dengan bar) · Data Lengkap · Data Bermasalah · **Kontrak Berakhir bulan terpilih** ("perlu keputusan bulan ini"; nilai = jumlah kontrak dengan `akhirKontrak` di bulan itu **dan** belum ada keputusan).

### Tabel
Kolom: **Personil** (nama + NIP, kolom beku) · **Jabatan** · **Cabang** · **Periode Kontrak** (`N bln`) · **Akhir Kontrak** (`8 Okt 2026`, "—" jika kosong) · **Total Score** (angka + bar berwarna tier) · **Rekomendasi** (badge `N bln`, warna tier) · **Aksi** (Detail Skor, Setujui / badge "Disetujui" bersama tanda ⚠️ jika ada catatan data). Semua kolom bisa diurutkan (default: Total Score menurun). Filter: cari nama/NIP/cabang · chip Jabatan · chip Status (Semua / Lengkap / Bermasalah) · penghitung "x dari y personil" · reset filter saat kosong.

### Detail Skor (drawer)
- Kepala: nama, NIP · jabatan · cabang; grid data kontrak (Periode Kontrak, Akhir Kontrak, Total Score, Rekomendasi).
- Empat blok indikator, masing-masing tabel bulanan + footer *Real · Nilai · Bobot · Point Final*:
  Achievement Target (Bulan · Target · Sales · ACH) · Jumlah Kunjungan (Bulan · Jml Visit · Hari Kerja · ACH; catatan "target N visit/hari") · Jumlah SC Menang (Bulan · SC Menang) · Absensi (Bulan · Absen Telat).
- Tabel **Ringkasan Perhitungan KPI** (Indikator · Real · Nilai · Bobot · Score + baris Total Score 100%).
- Kotak kesimpulan tier ("**Sangat Baik — diperpanjang** — Total Score X berada pada rentang …") dan kotak **Catatan data** (§6 business rules).
- Footer keputusan: belum diputuskan → tampilkan rekomendasi + form keputusan; sudah diputuskan → tampilkan keputusan, alasan, rencana pengembangan, pemutus, dan waktu.
- Tutup dengan tombol ×, klik overlay, atau `Esc`; fokus dikembalikan ke tombol pemicu; drawer punya `role="dialog"` dan label.

### Form keputusan
Pilihan bulan (0/6/9/12, default = rekomendasi sistem) · Alasan (wajib & terlihat hanya kalau pilihan ≠ rekomendasi) · Rencana pengembangan (wajib) · tombol "Setujui Perpanjangan" / "Simpan Keputusan" dengan konfirmasi dua klik (pakai `ConfirmDialog` yang sudah ada, bukan timer ad-hoc seperti prototipe). Gagal validasi → pesan di bawah field, tidak menyimpan apa pun.

### Export Excel
Satu berkas untuk **semua baris yang lolos filter aktif**, sheet "Evaluasi Non-Hospital", kolom: No · Nama · NIP · Jabatan · Cabang · Periode Kontrak (bulan) · Awal Kontrak · Akhir Kontrak · Total Score · Rekomendasi Sistem (bulan) · **Keputusan (bulan)** · **Status** (Belum Diputuskan / Disetujui / Diubah) · **Alasan** · **Diputuskan Oleh** · **Waktu** · Catatan Data. (Prototipe hanya "Status Approval" dan tanpa alasan/pemutus — ditambah sesuai memo §4-§6.) Dibuat di server (route API atau server action), memakai `exceljs` yang sudah ada di dependency; ikuti pola export yang ada di `src/app/api/export/`.

### Import data kontrak (ADMIN)
Selama sumber otomatis akhir kontrak/cabang belum ada (OQ-5), ADMIN mengimpor Excel (kolom: NIP · Jabatan · Cabang · Periode Kontrak · Awal · Akhir) lewat skrip atau layar unggah; baris dengan NIP yang tidak ditemukan dilaporkan, bukan dilewati diam-diam.

## 3. Hal yang sengaja berbeda dari prototipe

| Prototipe | Di aplikasi | Alasan |
|---|---|---|
| Data statis di dalam file | Dihitung dari sumber nyata (§1 `02-data-model.md`) | Prototipe direkonstruksi manual dari Excel |
| Rincian bulanan hanya untuk 1 personil | Rincian untuk semua personil | Data sumber tersedia untuk semua |
| "Setujui" tanpa alasan/rencana | Keputusan + alasan wajib + rencana pengembangan | Memo §4-§6 |
| Persetujuan disimpan sebagai `{status, at}` per NIP (menimpa) | Baris append-only dengan pemutus dan waktu | Jejak audit |
| Styling sendiri (warna/tema prototipe) | Token dan komponen aplikasi | Permintaan pengguna 2026-09-25 |

## 4. Non-goals v1

- Skema **Hospital** (tetap di `/kpi-perpanjangan`) — keputusan pengguna 2026-09-25.
- Role matrix atasan (SM/NSM) — ADMIN-only dulu.
- Notifikasi/pengingat kontrak yang akan berakhir, dan alur persetujuan bertingkat.
- Sinkron otomatis akhir kontrak/cabang dari HR — sampai sumbernya ada, import manual.
- Mengubah/menghapus keputusan yang sudah tersimpan (koreksi = keputusan baru).
