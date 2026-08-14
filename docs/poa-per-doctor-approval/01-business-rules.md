# POA Approval Per Dokter — Business Rules

Requirement asli: lihat `README.md` §Sumber requirement.

## 1. Definisi "dokter" (unit approval baru)

Sama seperti yang sudah didefinisikan di `docs/form-poa/01-business-rules.md` §2: 1 "dokter" = 1 pasangan `(kodePI, namaCust)` (`doctorKey`, `DraftChecklist.tsx:53-55`). Semua `PoaLineItem` milik 1 dokter (1 baris per produk) bergerak sebagai SATU unit approval — approve/reject tidak bisa parsial per-produk dalam 1 dokter, hanya per-dokter (task eksplisit menyebut "reject dokter a", bukan "reject baris produk X milik dokter a").

⚠️ **Asumsi kerja** — task tidak secara eksplisit membahas kasus produk, hanya dokter. Kalau ternyata dibutuhkan approval per-produk (bukan per-dokter), ini scope tambahan yang perlu dikonfirmasi terpisah.

## 2. Apa yang TIDAK berubah

- Approver tetap ASM → SM → NSM, chain yang sama (`resolveNextHolder`, `docs/form-poa/01-business-rules.md` §1).
- Fast-track NSM, Cancel Approved NSM, Ajukan Edit — konsepnya tetap ada, tapi unitnya ikut bergeser ke per-dokter (lihat §4-§6 di bawah, semua BLOCKING).
- `PoaLineItem` tetap 1 baris per (dokter × outlet × produk) — tidak ada perubahan struktur baris.
- Kategori dokter (Dokter Baru/Pernah PSSP/Retensi), formula Estimasi/Nilai PSSP/Tercacah — tidak tersentuh sama sekali.

## 3. Apa yang berubah — state machine per-dokter (usulan kerja)

Setiap dokter di dalam 1 `PoaForm` punya status approval-nya SENDIRI, menggunakan enum yang sama (`PoaStatus`: SUBMITTED_TO_ASM → SUBMITTED_TO_SM → SUBMITTED_TO_NSM → APPROVED_BY_NSM, atau REVISI) dan `currentHolder`-nya sendiri. Contoh skenario yang harus didukung (dari task): draft POA MR X berisi Dokter A dan Dokter B, keduanya di-submit bersamaan → ASM me-review satu-satu → ASM approve Dokter A (lanjut ke SM) sambil reject Dokter B (balik ke REVISI, MR harus revisi Dokter B saja) — TANPA meng-hold Dokter A.

### 3a. Status level-draft (`PoaForm.status`) — BLOCKING, lihat OQ-1

Begitu approval jadi per-dokter, `PoaForm.status` tunggal tidak lagi bisa merepresentasikan draft yang isinya campuran (mis. Dokter A APPROVED_BY_NSM, Dokter B masih SUBMITTED_TO_ASM). Dua pertanyaan:
1. Apakah `PoaForm.status` masih dipertahankan sebagai kolom (untuk kompatibilitas mundur — banyak query/filter existing bergantung padanya, lihat `docs/form-poa/03-ui-and-access.md`)? Kalau ya, jadi APA nilainya saat dokter-dokternya campuran — rollup "status paling belum maju" (mis. masih ada 1 dokter REVISI → draft dianggap REVISI), atau field ini pensiun total dan diganti tampilan agregat baru (mis. "3/5 dokter approved")?
2. List/filter halaman yang bergantung pada `PoaForm.status` (approval inbox atasan, Summary, Monitoring — lihat `docs/form-poa/03-ui-and-access.md`) perlu didefinisikan ulang query-nya: "POA yang perlu di-review" sekarang berarti "POA yang punya ≥1 dokter dengan `currentHolderId` = user ini", bukan `PoaForm.currentHolderId` langsung.

## 4. Submit — BLOCKING, lihat OQ-2

MR submit draft — apakah submit tetap "sekali klik, semua dokter di draft ini maju bersamaan" (tiap dokter dapat status/currentHolder sendiri secara paralel, mulai dari status yang sama), atau MR bisa submit dokter satu-satu (mis. Dokter A sudah siap, Dokter B belum)? Task hanya membahas sisi approve/reject atasan, tidak membahas sisi submit MR — defaultnya kemungkinan besar "submit tetap bersamaan, approve/reject-nya yang dipisah", tapi perlu dikonfirmasi karena legitimately dua desain berbeda.

## 5. Lock Edit Logic per dokter — BLOCKING, lihat OQ-3

`getEditLockLevel` (`src/lib/authz.ts:245-261`) saat ini memindai `PoaAuditLog` LEVEL-DRAFT untuk menentukan level mana yang mengunci edit. Kalau approval jadi per-dokter: begitu Dokter A di-approve ASM, apakah HANYA baris-baris Dokter A yang terkunci dari edit MR (Dokter B, yang belum di-approve siapa pun, tetap bebas diedit)? Ini konsisten dengan semangat requirement ("dokter A dan dokter B independen"), tapi berarti Lock Edit Logic perlu di-scope ulang ke per-dokter, bukan per-draft — perubahan non-trivial di `authz.ts` dan `LineItemEditor.tsx` (form saat ini tidak punya konsep "sebagian baris di draft ini read-only, sebagian editable").

## 6. Fast-track approve, Cancel Approved NSM, Ajukan Edit — BLOCKING, lihat OQ-4

Ketiga alur khusus di `docs/form-poa/01-business-rules.md` §1 ("Alur khusus") saat ini beroperasi di level `PoaForm`. Apakah masing-masing juga jadi per-dokter (NSM fast-track 1 dokter tertentu, bukan seluruh draft; MR ajukan edit untuk 1 dokter tertentu ke approver terakhir dokter itu)? Asumsi kerja: YA, konsisten dengan §3-§5 — tapi belum dikonfirmasi eksplisit karena task hanya menyebut approve/reject biasa.

## 7. Notifikasi — BLOCKING, lihat OQ-5

`sendPoaStatusEmail` (`src/lib/poaWorkflow.ts:165-167`) saat ini 1 email per transisi status draft. Kalau ASM me-review 5 dokter dalam 1 sesi (2 approve, 3 reject), apakah MR menerima 5 email terpisah, atau 1 email ringkasan ("2 dokter disetujui, 3 dokter perlu revisi")? Berpotensi jadi email-spam kalau tidak dibatch — perlu keputusan produk, bukan cuma teknis.

## 8. Export Excel & dashboard (Summary/Monitoring) — BLOCKING, lihat OQ-6

Export per-POA (`src/app/api/poa/[id]/export/route.ts`) dan export tim (`src/app/api/export/team/route.ts`) saat ini menampilkan 1 status untuk seluruh draft di header. Perlu didefinisikan: tampilkan status per-baris-dokter di export, atau tetap 1 badge ringkasan di level draft? Summary/Monitoring dashboard (`docs/form-poa/03-ui-and-access.md`) yang menghitung "berapa POA APPROVED_BY_NSM" dsb juga perlu formula baru — dihitung per dokter (lebih akurat tapi mengubah semua angka dashboard existing) atau tetap per draft dengan rollup dari §3a.

## Open questions — status & assumptions dipakai untuk v1

**Keputusan pengguna 2026-08-13: "all become per doctor"** — OQ-1 s/d OQ-6 semua dikonfirmasi ke arah per-dokter, RESOLVED di bawah.

| # | Pertanyaan | Keputusan | Sumber |
|---|---|---|---|
| OQ-1 (RESOLVED) | `PoaForm.status` dipertahankan sebagai rollup, atau pensiun total? | **Dipertahankan sebagai rollup live-derived** (bukan kolom yang ditulis manual) — dihitung dari status paling belum-maju di antara `PoaDoctorApproval` milik draft itu (REVISI mengalahkan SUBMITTED_TO_*, SUBMITTED_TO_ASM < SM < NSM < APPROVED_BY_NSM). Query "perlu direview" pindah ke `PoaDoctorApproval.currentHolderId`, `PoaForm.currentHolderId`/`.status` tetap disinkronkan sebagai bacaan cepat untuk kode lama yang belum di-generalisasi (export/dashboard, lihat Non-goals di `03-ui-and-access.md`). | Pengguna, 2026-08-13 |
| OQ-2 (RESOLVED) | Submit MR tetap bersamaan atau bisa per-dokter? | **Per-dokter** — MR bisa submit dokter satu-satu (tidak wajib submit seluruh draft bersamaan). Baris `PoaDoctorApproval` dibuat per-dokter saat dokter itu disubmit, bukan sekaligus untuk semua dokter di draft. | Pengguna, 2026-08-13 |
| OQ-3 (RESOLVED) | Lock Edit Logic di-scope ulang jadi per-dokter? | **Ya** — begitu 1 dokter di-approve/diedit pihak lain, HANYA baris-baris dokter itu yang terkunci; dokter lain di draft yang sama tetap bebas diedit MR. | Pengguna, 2026-08-13 |
| OQ-4 (RESOLVED) | Fast-track/Cancel-Approved/Ajukan-Edit ikut jadi per-dokter? | **Ya** — ketiganya sekarang menyasar 1 dokter tertentu, bukan seluruh draft. | Pengguna, 2026-08-13 |
| OQ-5 (RESOLVED) | Notifikasi email per-dokter atau dibatch? | **Per-dokter** — 1 email per keputusan approve/reject per dokter, konsisten dengan semua alur lain jadi per-dokter. | Pengguna, 2026-08-13 |
| OQ-6 (RESOLVED) | Export Excel & dashboard Summary/Monitoring — per-dokter atau rollup? | **Per-dokter** secara prinsip, TAPI diimplementasikan bertahap — lihat Non-goals v1 di `03-ui-and-access.md`: v1 ini menyelesaikan mekanisme state-machine + UI approval utama (halaman detail POA) per-dokter; rework kolom status di export Excel dan formula dashboard Summary/Monitoring (puluhan titik baca `PoaForm.status`) adalah follow-up terpisah supaya tidak mengubah dashboard company-wide tanpa verifikasi satu-satu (`docs/PERFORMANCE.md`). Selama follow-up itu belum jalan, export/dashboard baca rollup `PoaForm.status` dari OQ-1 (mendekati kondisi sebenarnya, tidak 100% presisi untuk draft campuran). | Pengguna, 2026-08-13 |
| OQ-7 (non-blocking) | Approval per-produk (bukan per-dokter) — di luar scope task ini (§1)? | Di luar scope — approval tetap per-dokter, semua produk milik 1 dokter bergerak bersama. | Pengguna, kalau muncul kebutuhan lebih granular nanti |
