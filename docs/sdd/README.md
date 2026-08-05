# Spec-Driven Development (SDD) — Index

*(Ditulis 2026-08-05. Ini dokumen PROSES, bukan spec fitur — tujuannya biar tiap fitur baru yang cukup besar/ambigu ditulis speknya dulu dan disetujui SEBELUM ada kode, bukan diimplementasi sambil nebak-nebak. Pola ini diambil dari `docs/kpi-monitoring/` — spec pertama di repo ini yang beneran ditulis duluan, lihat `README.md` di situ buat contoh nyata yang udah jalan.)*

## Dokumen

1. [`01-when-and-workflow.md`](./01-when-and-workflow.md) — kapan SDD wajib dipakai vs kapan boleh skip, dan alur kerjanya langkah demi langkah.
2. [`02-spec-template.md`](./02-spec-template.md) — struktur folder + isi wajib tiap file spec (`README.md`, `01-business-rules.md`, `02-data-model.md`, `03-ui-and-access.md`).
3. [`03-conventions.md`](./03-conventions.md) — konvensi status/emoji yang dipakai konsisten di semua spec + `docs/TODO.md`, dan aturan cross-reference.

## Ringkasan cepat

Satu fitur besar/ambigu = satu folder `docs/<nama-fitur>/`, spec ditulis & (kalau ada ambiguitas blocking) disetujui dulu sebelum kode implementasi ditulis. Contoh nyata yang udah jalan: `docs/kpi-monitoring/`. Kalau kerjaannya kecil/requirement udah jelas, skip proses ini — jangan overhead-in kerjaan simpel.
