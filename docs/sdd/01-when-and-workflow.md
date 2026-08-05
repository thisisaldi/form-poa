# SDD — Kapan Digunakan & Alur Kerja

## Kapan menggunakan SDD

Tidak semua pekerjaan membutuhkan spesifikasi formal — perbaikan bug, perubahan kecil, atau permintaan dengan requirement yang sudah jelas sejak awal dapat langsung dikerjakan tanpa proses ini.

**Gunakan SDD apabila minimal salah satu kondisi berikut terpenuhi:**
- Sumber requirement berasal dari dokumen eksternal (memo, kebijakan bisnis, aturan dari stakeholder) yang perlu diterjemahkan ke istilah teknis terlebih dahulu.
- Terdapat **ambiguitas nyata** — requirement dapat ditafsirkan lebih dari satu cara, dan kesalahan pilihan akan mahal untuk diperbaiki kemudian (skema database, formula scoring, role/akses).
- Membutuhkan **model data baru** (tabel/migration baru), bukan sekadar menambah field ke model yang sudah ada.
- Melibatkan **role/access matrix baru** yang belum memiliki pola di `src/lib/authz.ts`.
- Stakeholder secara eksplisit meminta "spesifikasi dahulu, baru implementasi".

Jika ragu, tanyakan kepada pengguna — jangan mengasumsikan salah satu arah begitu saja untuk pekerjaan yang jelas berdampak besar (lihat juga instruksi umum mengenai AskUserQuestion untuk keputusan yang bukan wewenang teknis).

## Alur kerja

1. **Tulis spesifikasi** (3 file — lihat `02-spec-template.md`) berdasarkan requirement yang tersedia. Jika requirement ambigu di beberapa titik, spesifikasi tetap ditulis dengan asumsi kerja yang dinyatakan secara eksplisit di section "Open questions" — tidak perlu menunggu klarifikasi untuk semua hal, cukup untuk yang benar-benar bersifat blocking.
2. **Convergence check** — sebelum implementasi dimulai, pastikan ambiguitas yang bersifat BLOCKING (bukan nice-to-have) sudah mendapat jawaban dari pengguna, baik secara eksplisit maupun melalui konfirmasi bergaya "lanjutkan, sesuaikan kemudian". Perbarui "Open questions" setiap kali ada jawaban baru.
3. **Implementasi v1** — ikuti spesifikasi yang sudah ditulis. Jika selama implementasi ditemukan hal yang mengharuskan spesifikasi berubah (bukan sekadar detail implementasi), **perbarui juga spesifikasinya** — jangan biarkan kode dan dokumen menyimpang satu sama lain.
4. **Perbarui status di README.md** setelah v1 selesai — apa yang sudah berjalan, apa yang sengaja belum dikerjakan (lihat section "Non-goals" di `02-spec-template.md`), dan tautan ke item tracking di `docs/TODO.md` jika ada nomornya.
5. **Cross-reference dua arah** — jika fitur ini menyentuh gap/isu yang sudah tercatat di `docs/TODO.md` (contoh nyata: KPI Monitoring menutup sebagian gap dari item #38), tulis cross-reference-nya di kedua dokumen, agar pembaca salah satu dokumen dapat menemukan yang lain.

## Jika ragu

Spesifikasi yang terlalu panjang untuk fitur kecil membuang waktu; spesifikasi yang tidak ada untuk fitur besar/ambigu mahal untuk diperbaiki kemudian (lihat alasan `docs/PERFORMANCE.md` dibuat — insiden performa nyata karena constraint tidak ditulis sejak awal). Sesuaikan effort penulisan spesifikasi dengan ukuran fiturnya, tetapi jika salah satu trigger di atas terpenuhi, jangan lewatkan section "Open questions" — bagian ini yang paling sering menyelamatkan dari kesalahan asumsi.

## Kasus khusus: spesifikasi retroaktif (mendokumentasikan sistem yang sudah berjalan)

Alur di atas ("spesifikasi dahulu, baru kode") berlaku untuk fitur BARU. `docs/form-poa/` merupakan jenis spesifikasi yang berbeda — dokumentasi RETROAKTIF dari sistem yang sudah berjalan di production, ditulis agar developer atau sesi kerja berikutnya tidak perlu menebak dari kode mentah. Ini bukan pelanggaran prinsip "spesifikasi sebelum kode", karena bukan merupakan proposal fitur — kodenya memang sudah ada terlebih dahulu, tujuan dokumennya hanya menangkap apa yang ADA saat ini (dengan referensi file:line sebagai bukti setiap klaim), bukan apa yang DIUSULKAN.

Konsekuensinya pada struktur (lihat `02-spec-template.md`): section yang dibingkai seputar "v1 yang sedang dibangun" (misalnya "Open questions — assumptions dipakai untuk v1", "Non-goals v1") boleh disesuaikan judul/framing-nya untuk spesifikasi retroaktif (contoh: `docs/form-poa/01-business-rules.md` menggunakan "Open questions / catatan yang belum settled" — fungsinya sama, hanya tidak menyebut "v1" karena tidak ada v1 yang sedang dibangun). Yang WAJIB tetap sama: setiap section tetap harus berisi konten (tidak boleh dilewati), dan setiap klaim tetap harus dapat ditelusuri ke sumbernya (referensi file:line untuk dokumen retroaktif, bukan asumsi dari nama variabel).
