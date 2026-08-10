# Format Currency & Rename Label (ENT / Campaign-DPL-DPF / PSSP Rencana-Aktif) — Spec Index

*(Ditulis 2026-08-10, mengikuti proses di `docs/sdd/`. Sumber requirement: daftar 13 task baru dari pengguna, item #3-#6. Item #3 (format currency) dikonfirmasi detail via `AskUserQuestion` 2026-08-10.)*

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — rule konversi currency, 3 rename label, blast radius per item, open questions.
2. [`03-ui-and-access.md`](./03-ui-and-access.md) — daftar file/komponen yang tersentuh, strategi implementasi (ekstrak shared util vs edit manual), non-goals.

Tidak ada `02-data-model.md` — seluruh 4 item ini murni perubahan format tampilan/label, tidak ada perubahan skema Prisma atau makna data.

## Status

⬜ **Belum dimulai — draft spec.** Item #3 (currency) punya keputusan bisnis terkonfirmasi; item #6 (rename POA Rencana/Berjalan) punya **koreksi istilah penting** yang perlu dikonfirmasi ulang ke pengguna sebelum implementasi — lihat `01-business-rules.md` §4.

## Ringkasan

Empat item digabung jadi satu spec karena sama-sama perubahan tampilan lintas banyak file, bukan logic baru:

- **#3 Currency** — dikonfirmasi pengguna: nilai asli ÷ 1.000.000, **tanpa suffix apapun** (bukan "Rp", bukan "Rb"). Contoh: Rp 1.000.000 → `1`, Rp 500.000 → `0,5`. Blast radius besar — `formatRp` didefinisikan ulang independen di 14 file, plus 37 titik lain pakai `.toLocaleString` mentah.
- **#4 Entertain → ENT** — cuma 4 titik label tampilan (`persenEntertain` sebagai field internal tidak berubah nama).
- **#5 Discount → Campaign/DPL/DPF** — label compound `"Discount + DPL + DPF"` di 4 titik.
- **#6 POA Rencana/Berjalan → PSSP Rencana/Aktif** — **koreksi penting**: istilah "POA Rencana/Berjalan" secara literal tidak ada di kode. Vokabuler yang berjalan sekarang sudah "Rencana"/"Aktif" (bukan "Berjalan" — istilah itu dipakai untuk konsep lain, status kontrak PSSP), dipakai 100+ kali lintas banyak file, dan "Aktif" juga dipakai untuk hal tidak terkait (`User.isActive`). Perlu konfirmasi ulang scope rename yang dimaksud sebelum implementasi — lihat `01-business-rules.md` §4.
