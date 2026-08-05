# SDD — Checklist Kualitas Spesifikasi

*(Ditulis 2026-08-05. Melengkapi `02-spec-template.md` — dokumen itu mengatur STRUKTUR file spesifikasi, dokumen ini mengatur KUALITAS isinya. Referensi: 15 prinsip penulisan spesifikasi yang baik untuk kolaborasi dengan AI coding assistant. Berlaku untuk spesifikasi baru (pre-code) maupun spesifikasi retroaktif — untuk spesifikasi retroaktif, "requirement" dibaca sebagai "perilaku sistem saat ini yang didokumentasikan", bukan sebagai usulan.)*

Sebelum spesifikasi dianggap selesai, tinjau terhadap 15 poin berikut. Tidak semua poin relevan untuk setiap fitur — sesuaikan kedalamannya dengan ukuran dan risiko fitur (lihat `01-when-and-workflow.md` §"Jika ragu").

## 1. Kejelasan di atas kelengkapan

Spesifikasi harus mustahil disalahartikan. Hindari kalimat generik ("mendukung banyak pengguna"); tulis perilaku konkret dan batasannya ("sistem mendukung banyak pengguna terautentikasi; tiap pengguna hanya bisa mengakses resource miliknya sendiri kecuali dibagikan secara eksplisit").

Pertanyaan verifikasi: *Apakah ada requirement yang ambigu atau dapat ditafsirkan lebih dari satu cara?*

## 2. Tidak ada asumsi tersembunyi

Setiap asumsi harus dinyatakan secara eksplisit — bukan "simpan percakapan", tetapi "percakapan disimpan tanpa batas waktu, soft-delete saja, ukuran pesan maksimum 64 KB". Di repositori ini, mekanisme untuk menandai asumsi yang belum dikonfirmasi adalah tanda ⚠️ di section "Open questions" (lihat `03-conventions.md`).

Pertanyaan verifikasi: *Asumsi apa yang harus ditebak sendiri oleh implementer jika tidak dituliskan?*

## 3. Requirement harus dapat diuji

Hindari kata sifat tanpa angka ("cepat", "efisien", "aman"). Gunakan ambang yang terukur ("p95 latency < 200ms", "password di-hash dengan Argon2id", "JWT kedaluwarsa setelah 15 menit"). Untuk formula bisnis (seperti di `docs/kpi-monitoring/01-business-rules.md` §3), contoh perhitungan dari sumber requirement asli WAJIB dicatat sebagai test case pertama.

Pertanyaan verifikasi: *Requirement mana yang saat ini tidak bisa diverifikasi?*

## 4. Definisikan non-goals

Salah satu prinsip yang paling sering terlewat. Tanpa daftar eksplisit "di luar scope", implementasi (termasuk oleh AI) cenderung "membantu" dengan menambahkan fitur yang tidak diminta. Section "Non-goals v1" di `03-ui-and-access.md` (lihat `02-spec-template.md`) adalah tempat wajib untuk ini.

Pertanyaan verifikasi: *Adakah area yang scope-nya bisa melebar tanpa disengaja?*

## 5. Pisahkan requirement dari implementasi

Requirement menjelaskan PERILAKU ("hasil pencarian diurutkan berdasarkan relevansi"), bukan cara teknis mencapainya ("gunakan PostgreSQL tsvector"). Detail implementasi masuk ke `02-data-model.md`/catatan desain, kecuali detail itu memang merupakan CONSTRAINT nyata (mis. harus reuse fungsi tertentu di `authz.ts` — lihat prinsip 11).

Pertanyaan verifikasi: *Apakah requirement ini menentukan implementasi padahal yang sebenarnya penting hanya perilakunya?*

## 6. Setiap input punya output yang lengkap

Untuk setiap aksi pengguna atau titik masuk data, daftar SEMUA kemungkinan hasil — bukan cuma jalur sukses. Contoh pola di repo ini: `01-business-rules.md` §1 form-poa mendaftar tiap transisi status POA (submit, approve, reject, fast-track, cancel) beserta gate dan efeknya masing-masing, bukan cuma jalur "submit lalu approve".

Pertanyaan verifikasi: *Jalur/hasil apa yang belum terdaftar untuk titik masuk ini (sukses, format tidak valid, terlalu besar, duplikat, timeout, kegagalan penyimpanan)?*

## 7. Tangani edge case secara eksplisit

Spesifikasi yang baik menghabiskan porsi signifikan untuk ini: data duplikat/konflik, data terhapus, sumber data tidak tersedia, race condition. Contoh nyata di repo ini: `docs/form-poa/03-ui-and-access.md` §6 mendokumentasikan degradasi Exodus Activity API ke `null` (bukan throw) saat tidak dikonfigurasi/gagal.

Pertanyaan verifikasi: *Edge case apa yang belum tercakup?*

## 8. Setiap transisi state harus terdefinisi

Untuk sistem dengan status/lifecycle (seperti `PoaStatus`), setiap transisi — termasuk jalur kegagalan/pembatalan, bukan cuma jalur maju — harus eksplisit. `docs/form-poa/01-business-rules.md` §1 sudah memiliki tabel status + narasi state machine; pastikan pola ini diikuti untuk lifecycle baru (mis. siklus evaluasi kontrak di `docs/kpi-monitoring/`).

Pertanyaan verifikasi: *State atau transisi apa yang belum didefinisikan (termasuk kegagalan dan pembatalan)?*

## 9. Satu tanggung jawab per section

Jangan mencampur autentikasi, database, UI, API, dan caching dalam satu paragraf. Struktur 4-file di `02-spec-template.md` (business-rules / data-model / ui-and-access / README) sudah menerapkan prinsip ini di level file; terapkan hal yang sama di level heading dalam tiap file.

Pertanyaan verifikasi: *Apakah section ini mencampur lebih dari satu tanggung jawab, sehingga sulit ditinjau secara terpisah?*

## 10. Acceptance criteria mendefinisikan "selesai"

Hindari klaim kabur ("fitur X sudah berjalan"). Gunakan daftar checklist konkret dan dapat diverifikasi — pola yang sama seperti checklist di `docs/PERFORMANCE.md` §4.

Pertanyaan verifikasi: *Bagaimana cara memverifikasi bahwa fitur ini benar-benar "selesai", langkah demi langkah?*

## 11. Utamakan constraint eksplisit

Constraint mempersempit ruang implementasi dan mengurangi variasi hasil (termasuk dari AI coding assistant). Contoh di repo ini: "jangan bikin RBAC ad-hoc, generalisasi dari `authz.ts`" (`02-spec-template.md` §"03-ui-and-access.md"), atau checklist performa wajib di `docs/PERFORMANCE.md` §2 untuk apa pun yang company-wide.

Pertanyaan verifikasi: *Constraint apa yang belum dinyatakan padahal implementer akan menebaknya?*

## 12. Berpikir dalam invariant

Invariant adalah pernyataan yang SELALU benar, terlepas dari state sistem. Contoh yang sudah implisit di skema repo ini: `PoaLineItem.poaId` selalu merujuk POA yang valid, `nip` adalah primary key `User` yang tidak pernah berubah, `PoaAuditLog` bersifat append-only (tidak pernah diedit/dihapus). Invariant yang belum eksplisit sebaiknya dituliskan di `02-data-model.md` sebagai "Catatan desain", bukan dibiarkan implisit.

Pertanyaan verifikasi: *Invariant apa yang belum dituliskan?*

## 13. Nyatakan perilaku kegagalan

Kebanyakan spesifikasi hanya mendeskripsikan jalur sukses. Jalur kegagalan (retry, logging, degradasi, atau pembatalan operasi) layak mendapat perhatian yang sama. Pola yang sudah benar di repo ini: integrasi Exodus Activity (`docs/form-poa/03-ui-and-access.md` §6) — kegagalan/konfigurasi kosong selalu berujung ke `null`, tidak pernah `throw`, dengan alasan eksplisit dituliskan di dokumen.

Pertanyaan verifikasi: *Bagaimana perilaku sistem saat komponen ini gagal — apakah retry, logging, degradasi, atau pembatalan?*

## 14. Kompatibilitas mundur (untuk proyek yang sudah berjalan)

Untuk perubahan pada sistem yang sudah production (seperti app ini): API yang sudah ada tidak boleh berubah tanpa alasan eksplisit, migration database harus dinyatakan, dan perubahan skema yang breaking harus ditandai jelas. Contoh pola yang benar di repo ini: `ProductTargetInput` (legacy) sengaja dipertahankan untuk view referensi meski sudah digantikan `ProductTargetAllocation` (`docs/form-poa/02-data-model.md` §"Target") — bukan dihapus langsung.

Pertanyaan verifikasi: *Apakah perubahan ini memutus kompatibilitas dengan sesuatu yang sudah berjalan di production?*

## 15. Cross-reference ke spesifikasi terkait, jangan duplikasi

Jika suatu spesifikasi bergantung pada spesifikasi lain, tautkan — jangan menyalin ulang requirement-nya. Lihat aturan cross-reference di `03-conventions.md` dan contoh nyatanya: `docs/form-poa/02-data-model.md` merujuk `docs/kpi-monitoring/02-data-model.md` untuk model `KpiMonthlyEntry`/`KpiContractEvaluation` alih-alih mendeskripsikannya ulang.

Pertanyaan verifikasi: *Apakah ada bagian di sini yang sebenarnya menduplikasi isi spesifikasi lain, alih-alih menautkannya?*
