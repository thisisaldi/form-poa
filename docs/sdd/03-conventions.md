# SDD — Konvensi Status & Cross-Reference

## Status/emoji (dipakai konsisten di semua spec + `docs/TODO.md`)

| Tanda | Arti |
|---|---|
| 🟢 | v1 diimplementasi |
| 🟡 | on-proses / partial |
| ⚠️ | ada asumsi kerja yang BUKAN konfirmasi asli stakeholder — jangan diandalkan buat keputusan bisnis nyata tanpa klarifikasi ulang |
| ❓ | butuh konfirmasi, belum ada jawaban |
| ⬜ | belum dikerjain sama sekali |

## Cross-reference

- Kalau spec baru nyerempet/nutup gap yang udah tercatat di `docs/TODO.md`, tulis nomor item-nya di kedua arah — di spec (sebut nomor TODO-nya) dan di `docs/TODO.md` (sebut nama spec-nya). Contoh nyata: `docs/kpi-monitoring/README.md` cross-reference ke `docs/TODO.md` #38 dan #25.
- Kalau spec-nya nyentuh data model yang berpotensi company-wide/berat, cross-reference ke `docs/PERFORMANCE.md` dari `02-data-model.md`.
- Kalau ada keputusan yang ternyata cuma asumsi kerja (⚠️) dan belakangan dikonfirmasi/dikoreksi stakeholder, update statusnya jadi 🟢 atau catat perubahannya — jangan biarin tag ⚠️ nempel di keputusan yang udah final, itu bikin orang ragu ke hal yang sebenernya udah pasti.
