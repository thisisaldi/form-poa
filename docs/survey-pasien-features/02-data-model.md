# Fitur Survey Pasien — Data Model

## Data yang sudah ada (tidak berubah)

- `PoaLineItem.surveyPasienHarian` — field existing, tidak disentuh spec ini (lihat `01-business-rules.md` §1a).
- `SurveyRekomendasi` — model existing, tidak disentuh spec ini (lihat `01-business-rules.md` §1b).
- `Outlet` — dipakai sebagai sumber dropdown "Nama RS" di form upload (§3a, `01-business-rules.md`), tidak ada perubahan skema.

## Data baru — `SurveyUploadLog`

Dikonfirmasi pengguna (2026-08-10): audit trail WAJIB ada, bukan fire-and-forget. Model baru, append-only (sama invariant dengan `PoaAuditLog` — tidak pernah di-update/delete setelah dibuat, kecuali kebutuhan moderasi/hapus-salah-upload yang eksplisit diminta belakangan).

```prisma
model SurveyUploadLog {
  id           String   @id @default(uuid())
  uploaderNip  String
  uploader     User     @relation(fields: [uploaderNip], references: [nip])
  kodePI       String
  outlet       Outlet   @relation(fields: [kodePI], references: [kodePI])
  periode      String   // format YYYYMM, lihat 01-business-rules.md §3a OQ-5
  namaFile     String   // nama final yang dipakai di Drive, format §3a — bukan nama file asli dari komputer MR
  driveFileId  String   // ID file dari response Google Drive API (files.create), untuk link balik/verifikasi
  uploadedAt   DateTime @default(now()) // sumber timestamp yang sama dipakai untuk [YYYYMMDDHHMM] di namaFile

  @@index([uploaderNip])
  @@index([kodePI])
  @@index([periode])
}
```

### Catatan desain

- **`uploaderNip`, bukan snapshot nama** — ikut pola `PoaAuditLog.actorId`/`PoaForm.ownerId` yang sudah ada di seluruh app (FK ke `User.nip`, nama di-resolve lewat join saat render, bukan disimpan sebagai string lepas) — supaya kalau nama user berubah (ganti nama tampilan), riwayat tetap konsisten dengan sumber kebenaran `User`.
- **`kodePI` sebagai FK ke `Outlet`, bukan free-text "Nama RS"** — konsisten dengan keputusan §3a bahwa "Nama RS" di form adalah dropdown/combobox dari `Outlet` yang sudah ada, bukan input bebas. Nama outlet untuk ditampilkan di nama file (`namaFile`) di-resolve dari `Outlet.namaOutlet` saat submit, bukan disimpan duplikat di kolom terpisah.
- **`driveFileId` disimpan, bukan URL penuh** — Google Drive file ID stabil dan bisa dipakai untuk konstruksi URL kapan saja (`https://drive.google.com/file/d/{id}/view`) tanpa perlu update kalau skema URL Drive berubah; menyimpan ID mentah lebih tahan lama daripada menyimpan URL jadi.
- **`namaFile` disimpan sebagai snapshot**, bukan di-reconstruct ulang dari `uploadedAt`+`outlet`+`periode`+`uploader` setiap kali ditampilkan — kalau ada perubahan format nama file di masa depan (v2), riwayat lama tetap menunjukkan nama file yang GENUINELY dipakai saat itu di Drive, bukan format baru yang belum berlaku saat upload itu terjadi.
- **Tidak ada relasi ke `PoaForm`/`PoaLineItem`** — upload survey ini independen dari siklus POA manapun (bukan bagian dari satu POA tertentu), murni tercatat per-outlet-per-periode.
- **Invariant**: satu `SurveyUploadLog` row = satu upload yang BERHASIL tersimpan di Drive (lihat `01-business-rules.md` §4 "Perilaku kegagalan" — upload gagal tidak menghasilkan row).

## Konfigurasi env var baru (bukan skema Prisma, tapi bagian dari data/config baru)

Mengikuti pola `EXODUS_AUTH_*` yang sudah ada (dari Vault, path `env/data/century/form-poa`, tidak pernah hardcode) — nama env var final ditentukan saat implementasi, kandidat:

| Env var | Isi | Catatan |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON credential service account, RAW (bukan base64) | Keputusan final (2026-08-27, koreksi dari draft awal yang lebih condong ke base64): raw JSON — base64 sempat dipakai lalu kena insiden mis-encode di staging (nilai env-nya bukan base64 valid, `Buffer.from(..., "base64").toString()` menghasilkan garbage lalu `JSON.parse` gagal dengan error yang membingungkan). Satu langkah encode/decode lebih sedikit untuk salah. |
| `GOOGLE_DRIVE_SURVEY_FOLDER_ID` | ID folder shared drive tujuan upload | Disiapkan pengguna/tim ops (lihat `01-business-rules.md` §2, OQ-3 soal struktur folder). |

Sampai kedua env var ini terisi di suatu environment, endpoint upload harus gagal dengan pesan jelas (`01-business-rules.md` §4), bukan crash — sama pola degradasi yang dipakai Exodus Activity API (`docs/form-poa/03-ui-and-access.md` §6).
