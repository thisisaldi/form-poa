# Scheduler Monitor — Business Rules

*Sumber requirement: lihat `README.md` (permintaan user 2026-10-20).*

## 1. Istilah

| Istilah | Arti |
|---|---|
| **Job** | Satu scheduler terdaftar, dengan `key` stabil (= `LOCK_KEY` yang sudah ada). |
| **Run** | Satu eksekusi job, tercatat sebagai satu baris `SyncRun`. |
| **Trigger** | `schedule` (timer harian) atau `manual` (tombol di Admin). |

## 2. Daftar job v1 (yang sudah ada di kode)

| Key | Jadwal | Isi | Prasyarat env |
|---|---|---|---|
| `org-and-outlet-daily` | 00:00 WIB | Rantai 6 langkah: org-structure → outlet → outlet-coverage → vacant-territory-coverage → pending-approval-holder → owner-handover | MSSQL hanya untuk langkah vacant-territory (opsional) |
| `outlet-sales-value-monthly` | 01:00 WIB | `runOutletSalesValueMonthlySync` | `MSSQL_CONNECTION_STRING` |
| `omega-sales-value-monthly` | 02:00 WIB | `runOmegaSalesValueMonthlySync` | `MSSQL_CONNECTION_STRING` |
| `sales-history-monthly` | 08:00 WIB | `salesHistoryMonthlyScheduler.ts` | `MSSQL_CONNECTION_STRING` |
| `pssp-lunas` | 03:00 WIB | `runPsspLunasSync` (~30–45 menit) | `EXODUS_*` |

Jam dibuat bertahap (user, 2026-10-21) supaya job tidak berebut pool koneksi DB / MSSQL; org chain duluan karena sync sales membaca outlet yang di-refresh-nya. Semua didefinisikan di `src/lib/sync/jobs.ts`.

Job rantai (`org-and-outlet-daily`) dicatat sebagai **satu run**; hasil tiap langkah masuk `detail` (lihat Q1).

## 3. Lifecycle run

```
(trigger) ──► running ──► success
                  │
                  ├─────► failed      (exception dari fungsi sync, pesan disimpan di `error`)
                  │
                  └─────► abandoned   (masih `running` lewat batas basi job — proses mati di tengah jalan)
```

| Status | Kapan | `finishedAt` / `durationMs` |
|---|---|---|
| `running` | Baris dibuat tepat sebelum fungsi sync dipanggil. | null |
| `success` | Fungsi sync selesai tanpa exception. Job rantai: semua langkah wajib sukses (langkah opsional yang di-skip karena env tidak ada tetap dihitung sukses). | diisi |
| `failed` | Exception, atau env wajib tidak ada (mis. `MSSQL_CONNECTION_STRING`) — dicatat sebagai failed dengan `error` = "MSSQL_CONNECTION_STRING not configured", supaya kelihatan di UI, bukan diam di log. | diisi |
| `abandoned` | Tidak ditulis oleh runner; diturunkan saat dibaca: `status = running` dan `startedAt` lebih tua dari batas basi job (2 jam, sama dengan `LOCK_STALE_AFTER_MS` sekarang). Ditampilkan sebagai "Terputus". | null |

**Tidak dicatat:** replica yang kalah berebut lock jadwal (lihat §4). Kalau dicatat, tiap replica menambah satu baris "skipped" per hari — noise tanpa informasi.

## 4. Konkurensi & dedupe

Masalah di kode sekarang: `acquireSyncLock` tidak pernah melepas lock, hanya basi setelah 2 jam. Run manual dalam 2 jam setelah run terjadwal akan selalu ditolak. Aturan baru, dua lock terpisah:

| Lock key | Gunanya | Dilepas? |
|---|---|---|
| `sched:<job>:<YYYY-MM-DD WIB>` | Dedupe jadwal: hanya satu replica yang menjalankan jadwal hari itu. | Tidak (satu baris per job per hari, ikut dibersihkan retensi §6). |
| `<job>` | Mutual-exclusion: tidak boleh dua run job yang sama berjalan bersamaan (jadwal vs manual, manual vs manual). | Ya, di akhir run (`finally`). Basi setelah 2 jam kalau proses mati. |

Run terjadwal: ambil `sched:` dulu, lalu `<job>`. Kalau `<job>` sedang dipegang run manual → run terjadwal hari itu **dilewati** dan dicatat sebagai `failed` dengan `error` = "dilewati: run lain masih berjalan".

## 5. Run manual

- Tombol "Jalankan sekarang" per job. Klik → server action mengambil lock `<job>`; kalau gagal → tombol menampilkan "Masih berjalan", tidak membuat run.
- Kalau berhasil, run dimulai **di background di proses server yang menerima request** (tidak ditunggu oleh request — `pssp-lunas` butuh ~1 jam), action langsung mengembalikan `runId`.
- `trigger = manual`, `triggeredBy = nip` admin.
- Run manual memakai fungsi yang persis sama dengan run terjadwal (tidak ada mode dry-run di v1).
- Kalau server restart di tengah run → run jadi `abandoned` (§3); lock basi setelah 2 jam.

## 6. Retensi

Baris `SyncRun` dengan `startedAt` lebih tua dari **90 hari** dihapus, beserta lock `sched:` yang lebih tua dari 90 hari. Dijalankan oleh runner di akhir setiap run terjadwal (bukan job terpisah). Volume: 5 job × 1 run/hari × 90 hari ≈ 450 baris + run manual.

## 7. Open questions — status & assumptions dipakai untuk v1

| # | Pertanyaan | Asumsi untuk v1 | Siapa |
|---|---|---|---|
| Q1 | Job rantai `org-and-outlet-daily` — dimonitor sebagai 1 job (6 langkah di detail) atau 6 job terpisah yang bisa di-run manual satu per satu? | ✅ 1 job, langkah di `detail` (user, 2026-10-20). | — |
| Q2 | Siapa yang boleh melihat & menjalankan manual? | ✅ Hanya ADMIN (user, 2026-10-20). | — |
| Q3 | Retensi? | ✅ 90 hari (user, 2026-10-20). | — |
| Q4 | Endpoint cron eksternal (`/api/sync/sales-history`, `sales-value-monthly`, `org-structure`, `outlet`) ikut dicatat? | Tidak di v1 — jadwalnya di luar repo dan sebagian sudah digantikan scheduler in-process. Runner dibuat generik supaya mudah ditambah. | — |
| Q5 | Perlu tombol pause/nonaktifkan job? | Tidak di v1 (lihat non-goals `03-ui-and-access.md`). | User, kalau perlu |
| Q6 | Berapa replica app di staging/prod? | Tidak diketahui; desain §4 aman untuk 1 maupun banyak replica. | — |
