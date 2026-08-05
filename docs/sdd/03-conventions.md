# SDD — Konvensi Status & Cross-Reference

## Status/simbol (digunakan konsisten di seluruh spesifikasi + `docs/TODO.md`)

| Simbol | Arti |
|---|---|
| 🟢 | v1 diimplementasikan |
| 🟡 | sedang berjalan / sebagian selesai |
| ⚠️ | catatan penting yang WAJIB dibaca sebelum mengandalkan bagian tersebut — memiliki dua pemakaian: (a) asumsi kerja yang BUKAN konfirmasi asli dari stakeholder (jangan digunakan untuk keputusan bisnis nyata tanpa klarifikasi ulang), atau (b) catatan/temuan verifikasi yang tidak sepenuhnya sesuai dengan klaim awal (bug sudah diperbaiki tetapi ada sisa, dua sistem serupa yang mudah tertukar, klaim "selesai" yang ternyata tidak sesuai kode, dst.). Makna spesifiknya (asumsi vs catatan verifikasi) dijelaskan pada kalimat setelah simbolnya — pada section "Open questions" di spesifikasi baru (lihat `02-spec-template.md`), gunakan makna (a); di luar konteks itu (dokumen retroaktif, `docs/TODO.md`), makna (b) juga berlaku. |
| ❓ | butuh konfirmasi, belum ada jawaban |
| ⬜ | belum dikerjakan sama sekali |

## Cross-reference

- Jika spesifikasi baru menyentuh atau menutup gap yang sudah tercatat di `docs/TODO.md`, tulis nomor item-nya di kedua arah — pada spesifikasi (sebutkan nomor TODO-nya) dan pada `docs/TODO.md` (sebutkan nama spesifikasinya). Contoh nyata: `docs/kpi-monitoring/README.md` melakukan cross-reference ke `docs/TODO.md` #38 dan #25.
- Jika spesifikasi menyentuh data model yang berpotensi company-wide/berat, cross-reference ke `docs/PERFORMANCE.md` dari `02-data-model.md`.
- Jika suatu keputusan yang semula hanya asumsi kerja (⚠️) kemudian dikonfirmasi atau dikoreksi oleh stakeholder, perbarui statusnya menjadi 🟢 atau catat perubahannya — jangan biarkan tanda ⚠️ tetap melekat pada keputusan yang sudah final, karena hal ini membuat pembaca ragu terhadap sesuatu yang sebenarnya sudah pasti.
