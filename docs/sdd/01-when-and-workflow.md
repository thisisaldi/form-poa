# SDD — Kapan Pakai & Alur Kerja

## Kapan pakai SDD

Gak semua kerjaan butuh spec formal — bug fix, perubahan kecil, atau permintaan yang requirement-nya udah jelas dari awal, langsung dikerjain aja, jangan overhead-in dengan proses ini.

**Pakai SDD kalau minimal salah satu ini kena:**
- Sumber requirement-nya dokumen eksternal (memo, kebijakan bisnis, aturan dari stakeholder) yang perlu diterjemahkan ke istilah teknis dulu.
- Ada **ambiguitas nyata** — requirement-nya bisa diartikan lebih dari satu cara, dan salah pilih artinya mahal buat diubah belakangan (skema DB, formula scoring, role/akses).
- Butuh **model data baru** (tabel/migration baru), bukan cuma nambah field ke yang udah ada.
- Melibatkan **role/access matrix baru** yang belum ada polanya di `src/lib/authz.ts`.
- Stakeholder sendiri minta "spec dulu baru kode" secara eksplisit.

Kalau ragu-ragu, tanya user — jangan asumsi salah satu arah begitu aja untuk kerjaan yang jelas-jelas berdampak besar (lihat juga instruksi umum soal AskUserQuestion buat keputusan yang bukan wewenang teknis).

## Alur kerja

1. **Tulis spec** (3 file — lihat `02-spec-template.md`) berdasarkan requirement yang ada. Kalau requirement-nya ambigu di beberapa titik, TETAP tulis spec-nya dengan asumsi kerja eksplisit di section "Open questions" — jangan berhenti nunggu klarifikasi buat semua hal, cukup buat yang beneran blocking.
2. **Convergence check** — sebelum mulai kode, pastikan ambiguitas yang BLOCKING (bukan nice-to-have) udah dapet jawaban dari user, entah eksplisit atau lewat "lanjut, adjust belakangan" style confirmation. Update "Open questions" begitu ada jawaban baru.
3. **Implementasi v1** — ikutin spec yang udah ditulis. Kalau pas ngoding ketemu sesuatu yang bikin spec-nya harus berubah (bukan cuma detail implementasi), **update spec-nya juga**, jangan biarin kode dan dokumen nyimpang.
4. **Update status di README.md** begitu v1 selesai — apa yang jalan, apa yang sengaja belum (lihat section "Non-goals" di `02-spec-template.md`), dan link ke tracking item di `docs/TODO.md` kalau ada nomornya.
5. **Cross-reference balik** — kalau fitur ini nyerempet ke gap/isu yang udah tercatat di `docs/TODO.md` (contoh nyata: KPI Monitoring nutup sebagian gap dari item #38), tulis cross-reference-nya di dua arah, biar orang yang baca salah satu ketemu yang lain.

## Kalau ragu

Spec yang kepanjangan buat fitur kecil itu buang waktu; spec yang gak ada buat fitur besar/ambigu itu mahal pas harus diubah belakangan (lihat kenapa `docs/PERFORMANCE.md` ada — insiden performa nyata karena constraint gak ditulis dari awal). Skala effort nulis spec-nya ke ukuran fiturnya, tapi kalau salah satu trigger di atas kena, jangan skip section "Open questions" — itu bagian yang paling sering nyelametin dari salah asumsi.
