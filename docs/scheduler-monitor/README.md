# Scheduler Monitor (Admin)

**Sumber requirement:** permintaan user, 2026-10-20 — "di admin bisakah ada page khusus untuk monitor scheduler? jadi kayak tools data pipeline gitu, jadi bisa lihat success atau ngga nya, running berapa lama, historinya, dan bisa run manual dll". Dipicu oleh scheduler baru `pssp-lunas` (`docs/pssp-live/`) yang satu kali jalan butuh ~1 jam, dan sejauh ini hasil semua scheduler hanya bisa dilihat dari log server.

**Status:** 🟢 v1 diimplementasikan 2026-10-20 (Q1–Q3 dikonfirmasi user), belum di-deploy/dites di staging. Kode: `src/lib/sync/jobs.ts` (registry + runner + scheduler, menggantikan lima `*Scheduler.ts`), `src/app/actions/scheduler.ts`, `src/components/admin/SchedulerPanel.tsx`, migration `20261020150000_sync_run`. Tidak diimplementasikan: lihat non-goals di `03-ui-and-access.md` §3.

## Ringkasan

Semua scheduler in-process (`src/lib/sync/*Scheduler.ts`, didaftarkan di `src/instrumentation.ts`) saat ini hanya menulis `console.log`; tidak ada catatan run yang bisa dilihat dari app. Fitur ini menambah tabel `SyncRun` (satu baris per eksekusi job), satu runner generik yang dipakai semua scheduler untuk mencatat status/durasi/ringkasan/error, dan tab baru **Admin → Scheduler** untuk melihat status terakhir, histori, jadwal berikutnya, serta tombol "Jalankan sekarang". Logika sync masing-masing job tidak berubah.

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — daftar job, lifecycle run, aturan run manual & konkurensi, retensi, open questions.
2. [`02-data-model.md`](./02-data-model.md) — model `SyncRun`, perubahan pemakaian `SyncLock`.
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — tab Admin → Scheduler, akses, non-goals.
