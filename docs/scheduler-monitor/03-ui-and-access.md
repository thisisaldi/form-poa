# Scheduler Monitor — UI & Akses

## 1. Akses

| Role | Lihat | Jalankan manual |
|---|---|---|
| ADMIN | ✅ | ✅ |
| Role lain | ❌ (redirect `/dashboard`, sama dengan `/admin`) | ❌ |

Tidak ada RBAC baru: pakai cek yang sama dengan `src/app/(app)/admin/page.tsx:37` (`session.role !== "ADMIN"`) dan `requireAdmin()` di `src/app/actions/admin.ts:14` untuk server action. Dikonfirmasi user 2026-10-20 (Q2).

## 2. Halaman

Tab ketiga di `/admin`: `SECTIONS` di `src/app/(app)/admin/page.tsx:29` ditambah `{ key: "scheduler", label: "Scheduler" }` → `/admin?section=scheduler`. Bukan route baru, supaya ikut navigasi admin yang sudah ada.

### Tabel job

| Kolom | Isi |
|---|---|
| Job | Label + key, mis. "Pelunasan PSSP (Exodus)" · `pssp-lunas` |
| Jadwal | "Tiap hari HH:00 WIB" + jadwal berikutnya (dari `msUntilNextWib`) |
| Run terakhir | Badge status (Berhasil / Gagal / Berjalan / Terputus), waktu mulai, durasi |
| Ringkasan | `summary` run terakhir, atau `error` (merah) kalau gagal |
| Aksi | "Jalankan sekarang" (disabled + "Berjalan…" kalau ada run `running` yang belum basi), "Histori" |

### Histori (expand per job)

50 run terakhir: waktu mulai, trigger (Jadwal / Manual oleh <nama>), durasi, status, ringkasan/error. `detail` ditampilkan sebagai daftar key–value bila diklik (untuk job rantai: hasil tiap langkah).

### Refresh

Kalau ada job berstatus `running`, halaman polling ulang tiap 10 detik (server action read-only); kalau tidak ada, tidak polling.

### Komponen yang dipakai ulang

`Card` (`src/components/ui/Card`), pola panel di tab "Pengaturan Sistem" (`AppSettingsPanel`, `MaintenanceModeToggle`) untuk layout dan tombol, warna status dari token yang sudah dipakai (`--color-success`, `--color-red`, `--color-warning`).

## 3. Non-goals v1

- Tidak ada pause/nonaktifkan job dan tidak ada ubah jadwal dari UI (jadwal tetap di kode).
- Tidak ada dry-run dari UI (dry-run `pssp-lunas` tetap lewat `scripts/syncPsspLunasFromExodus.ts`).
- Tidak ada tombol batalkan run yang sedang berjalan.
- Tidak ada penangkapan log `console` lengkap per run — hanya `summary`, `error`, `detail`.
- Tidak ada notifikasi (email/Slack) saat run gagal.
- Endpoint cron eksternal `/api/sync/*` tidak dicatat (Q4).
