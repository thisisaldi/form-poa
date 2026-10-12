# Pengaturan Fitur (AppSetting)

Fitur on/off yang dulu berupa konstanta di kode (`exportFlags.ts`, `poaStandarisasiUploadFlag.ts`, `poaStandarisasiDplDpfFlag.ts`, semuanya sudah dihapus) sekarang diatur ADMIN dari **Admin → Pengaturan Sistem → Pengaturan Fitur**, tanpa deploy. Perubahan berlaku dalam ≤ 10 detik (cache per proses).

| Key | Default | Efek bila MATI |
|---|---|---|
| `export.poa.disabled` | aktif | `/api/poa/[id]/export`, `/api/export/team`, dan tombol export POA Hospital → 503 |
| `export.sc.disabled` | **mati** | `/api/sc/export`, `/api/sc/[id]/export`, dan tombol export POA Sales Counter → 503 |
| `export.team.periodAllDisabled` | aktif | `/api/export/team?period=all` → 400 |
| `standarisasi.upload.disabled` | aktif | upload dokumen POA Standarisasi ditolak |
| `standarisasi.dplDpfSubmit.disabled` | aktif | pengajuan DPL/DPF ke Exodus ditolak |

## Cara kerja
- **Registry:** `src/lib/appSettingsRegistry.ts` — daftar key, label, deskripsi, default, dan pesan. Panel Admin dibangun dari daftar ini.
- **Penyimpanan:** tabel `AppSetting` (key → "true"/"false"), hanya baris override; key tanpa baris memakai default registry.
- **Server:** `getAppSetting(key)` di `src/lib/appSettings.ts` (route, server action, server component). Gagal baca DB → pakai default, tidak error.
- **Client:** `useFeatureFlag(key)` dari `src/components/providers/FeatureFlags.tsx`; nilainya diisi `(app)/layout.tsx`.
- Konvensi kill switch: akhiran `.disabled` / `Disabled`, `true` = fitur MATI; panel menampilkannya sebagai FITUR AKTIF / FITUR MATI.

## Menambah pengaturan baru
1. Tambah satu entri di `APP_SETTINGS` (registry).
2. Pakai `await getAppSetting("key")` di server atau `useFeatureFlag("key")` di client.
Tidak perlu migrasi data atau perubahan panel Admin.
