# Spec-Driven Development (SDD) — Indeks

*(Ditulis 2026-08-05. Ini adalah dokumen PROSES, bukan spesifikasi fitur — tujuannya agar setiap fitur baru yang cukup besar atau ambigu memiliki spesifikasi yang ditulis dan disetujui SEBELUM implementasi dimulai, bukan dikerjakan berdasarkan tebakan. Pola ini diadopsi dari `docs/kpi-monitoring/` — spesifikasi pertama di repositori ini yang benar-benar ditulis lebih dahulu; lihat `README.md` di folder tersebut untuk contoh penerapan nyata.)*

## Dokumen

1. [`01-when-and-workflow.md`](./01-when-and-workflow.md) — kapan SDD wajib digunakan, kapan boleh dilewati, dan alur kerjanya langkah demi langkah.
2. [`02-spec-template.md`](./02-spec-template.md) — struktur folder dan isi wajib tiap file spesifikasi (`README.md`, `01-business-rules.md`, `02-data-model.md`, `03-ui-and-access.md`).
3. [`03-conventions.md`](./03-conventions.md) — konvensi status/simbol yang digunakan secara konsisten di seluruh spesifikasi dan `docs/TODO.md`, beserta aturan cross-reference.
4. [`04-quality-checklist.md`](./04-quality-checklist.md) — 15 prinsip kualitas spesifikasi (kejelasan, non-goals, invariant, perilaku kegagalan, dll.) untuk ditinjau sebelum spesifikasi dianggap selesai.

## Ringkasan

Satu fitur besar atau ambigu = satu folder `docs/<nama-fitur>/`. Spesifikasi ditulis, dan bila ada ambiguitas yang bersifat blocking, disetujui terlebih dahulu sebelum kode implementasi ditulis. Contoh penerapan nyata: `docs/kpi-monitoring/`. Untuk pekerjaan kecil dengan requirement yang sudah jelas, proses ini boleh dilewati — jangan menambah overhead untuk pekerjaan sederhana.
