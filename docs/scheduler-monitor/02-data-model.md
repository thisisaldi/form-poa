# Scheduler Monitor — Data Model

## 1. Sudah ada (dipakai ulang)

| Model | Pemakaian |
|---|---|
| `SyncLock { key @id, lockedAt }` (`prisma/schema.prisma`, `src/lib/sync/syncLock.ts`) | Tanpa perubahan skema. Ditambah fungsi `releaseSyncLock(key)` (`DELETE`), dan dipakai dengan dua jenis key (`sched:<job>:<tanggal>` dan `<job>`) — lihat `01-business-rules.md` §4. |

## 2. Baru (butuh migration)

```prisma
model SyncRun {
  id          String    @id @default(uuid())
  job         String    // = key job, mis. "pssp-lunas"
  trigger     String    // "schedule" | "manual"
  triggeredBy String?   // nip admin untuk manual; null untuk schedule
  status      String    // "running" | "success" | "failed"
  startedAt   DateTime  @default(now())
  finishedAt  DateTime?
  durationMs  Int?
  summary     String?   // satu baris ringkas, sama dengan isi log [scheduler] ... done — ...
  error       String?   // pesan error (dipotong 4000 karakter)
  detail      Json?     // hasil terstruktur dari fungsi sync (angka per langkah untuk job rantai)

  @@index([job, startedAt(sort: Desc)])
}
```

## 3. Catatan desain

- **`status` String, bukan enum Prisma.** Konsisten dengan tabel lain yang menyimpan status bebas; menambah status nanti tidak butuh migration enum.
- **`abandoned` tidak disimpan.** Diturunkan saat dibaca (`running` + `startedAt` > 2 jam lalu), karena justru terjadi saat proses mati dan tidak bisa menulis apa pun.
- **`summary` + `detail`, bukan log lengkap.** Fungsi sync sudah mengembalikan objek hasil (mis. `{ upserted, periodeFrom, periodeTo }`); itu yang disimpan. Output `console.log` tidak ditangkap (non-goal).
- **`durationMs` disimpan**, walau bisa dihitung dari dua timestamp, supaya daftar histori tidak perlu menghitung ulang dan bisa diurutkan.
- **Invariant:** satu baris hanya berpindah `running → success|failed` sekali dan tidak pernah kembali; `finishedAt`/`durationMs` null ⇔ `status = running`. Baris tidak diubah setelah selesai, hanya dihapus oleh retensi (90 hari).
- **Performa** (`docs/PERFORMANCE.md`): tabel kecil (~500 baris), hanya dibaca ADMIN. Query halaman: status terakhir per job = satu `findMany` 5 job × `take 1` lewat index `[job, startedAt desc]`; histori = `take 50` per job. Tidak ada query company-wide ke tabel bisnis.
