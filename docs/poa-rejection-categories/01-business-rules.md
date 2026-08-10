# Kategori Rejection POA — Business Rules

Requirement asli: lihat `README.md` §Sumber requirement — daftar 13 task, item #1, judul singkat tanpa detail lanjutan. Dokumen ini menstrukturkan judul itu menjadi requirement konkret + open questions.

## 1. Kategori yang diminta

Enam kategori, urutan sesuai permintaan pengguna:

| Kategori | Kemungkinan makna (interpretasi kerja) |
|---|---|
| Produk | Reject karena data/pilihan produk di line item bermasalah (mis. produk salah, kombinasi produk tidak sesuai kriteria). |
| Outlet | Reject karena outlet yang dipilih bermasalah (mis. outlet tidak sesuai coverage MR, salah outlet). |
| User | Reject karena data dokter/user (customer) bermasalah (mis. dokter salah, data dokter tidak valid). |
| Periode | Reject karena periode/durasi pengajuan bermasalah (mis. `periodeAwal`/`lamaPeriode` tidak sesuai kebijakan). |
| Kalkulasi PSSP | Reject karena perhitungan Nilai PSSP/Estimasi/persentase bermasalah (mis. `%PSSP`, `pengaliNilaiR`, formula budget — lihat `docs/form-poa/01-business-rules.md` §3). |
| Alasan Lain | Kategori fallback untuk kasus di luar 5 kategori di atas. |

❓ Definisi persis tiap kategori (kapan dipakai) **belum dikonfirmasi eksplisit oleh pengguna** — tabel di atas adalah interpretasi kerja berdasarkan nama kategori dan domain data POA yang ada, bukan hasil konfirmasi kata-demi-kata. Tidak blocking untuk mulai implementasi (kategori cuma label pilihan, bukan logic bercabang), tapi sebaiknya dikonfirmasi supaya user (approver) tidak salah pilih kategori saat reject.

## 2. Cakupan form yang terpengaruh

Riset kode (`src/app/(app)/poa/[id]/page.tsx`) menemukan **3 form terpisah** yang punya pola sama (textarea alasan wajib diisi) dan bermuara ke `applyTransition()` di `src/lib/poaWorkflow.ts`:

| Form | Lokasi | Fungsi lib | Action name di audit log |
|---|---|---|---|
| Tolak (kembali ke Revisi) | `page.tsx:411-425`, label "Alasan Reject" | `rejectPoa()` (`poaWorkflow.ts:268-288`) | `REJECT` |
| Tolak Permintaan Edit | `page.tsx:349-361`, label "Alasan Menolak" | fungsi `decline`-edit-request (nama pasti perlu dicek ulang saat implementasi) | `DECLINE_EDIT` |
| Batalkan Approval (NSM cancel-approved) | `page.tsx:442-449`, label "Alasan Pembatalan" | `cancelApprovedByNsmAction` → fungsi cancel di `poaWorkflow.ts` | kemungkinan `CANCEL` atau `REJECT` — perlu dicek ulang persis saat implementasi |

**❓ Open question BLOCKING #1**: apakah kategori ini berlaku ke KETIGA form di atas, atau cuma form "Tolak" utama (yang paling sering dipakai approver ASM/SM/NSM dan paling relevan dengan judul task "Rejection POA")? Task hanya menyebut "Rejection POA", secara literal paling mengarah ke form "Tolak" saja — tapi "Tolak Permintaan Edit" dan "Batalkan Approval" secara konsep juga jenis penolakan.

## 3. Bentuk pilihan kategori

**❓ Open question BLOCKING #2**: single-select (approver pilih 1 kategori paling relevan) atau multi-select (bisa pilih beberapa, mis. reject karena Produk DAN Periode sekaligus)? Task menyebut "Label/Kategori" (singular framing) — asumsi kerja sementara: **single-select** (radio button/`<select>`), karena lebih sederhana untuk dianalisis/dilaporkan (1 rejection = 1 kategori dominan) dan konsisten dengan pola form existing yang simpel.

**❓ Open question BLOCKING #3**: untuk kategori "Alasan Lain" — apakah wajib mengisi teks tambahan yang menjelaskan (supaya "Alasan Lain" tidak jadi kategori tanpa penjelasan yang berguna untuk laporan), atau textarea "Alasan Reject" existing yang sudah wajib itu otomatis dianggap sebagai penjelasannya (tidak perlu field tambahan lagi)? Asumsi kerja sementara: **tidak perlu field tambahan** — textarea alasan bebas yang sudah ada dan sudah wajib (`required`) sudah cukup jadi penjelasan untuk kategori apa pun, termasuk "Alasan Lain". Kategori cuma jadi tag tambahan di atas alasan bebas yang sudah ada, bukan pengganti.

## 4. Requirement konkret (v1, dengan asumsi kerja di atas)

1. Form "Tolak" (`page.tsx:411-425`) menambahkan satu `<select name="rejectCategory" required>` di atas textarea `reason` yang sudah ada, dengan 6 opsi kategori di §1. **Wajib dipilih** — approver tidak bisa submit reject tanpa memilih kategori (sama pola wajib seperti `reason` yang sudah `required`).
2. Textarea alasan bebas (`reason`) **tetap ada dan tetap wajib** — kategori adalah tambahan, bukan pengganti.
3. Kategori tersimpan bersama `notes` di `PoaAuditLog.snapshot` (lihat `02-data-model.md` untuk keputusan struktur data) melalui `snapshotExtra` yang sudah tersedia di `applyTransition()` (`poaWorkflow.ts:125`, belum dipakai `rejectPoa()`).
4. Kategori ditampilkan di Riwayat Aktivitas (`page.tsx:495-499`) berdampingan dengan alasan bebas yang sudah tampil di situ — lihat `03-ui-and-access.md`.
5. Kategori TIDAK mengubah alur status/transisi POA manapun — murni metadata tambahan pada event `REJECT` yang sudah ada, tidak ada state/transition baru (lihat `docs/form-poa/01-business-rules.md` §1 untuk state machine POA yang sudah ada dan tidak disentuh spec ini).

## 5. Perilaku kegagalan

- Kalau kategori tidak dipilih (dan wajib per §4.1) → submit form ditolak di sisi client (`required` HTML) DAN di server action (validasi ulang di `rejectPoaAction`, sama pola `reason.trim()` yang sudah ada di `src/app/actions/poa.ts:144-158` — jangan percaya validasi client saja).
- Kalau kategori yang dikirim bukan salah satu dari 6 nilai valid (mis. request dipalsukan lewat DevTools) → server action harus reject dengan error jelas, bukan menyimpan nilai sembarang ke `snapshot` — validasi terhadap enum/whitelist, bukan string bebas.

## Open questions — status & assumptions dipakai untuk v1

| # | Pertanyaan | Asumsi yang dipakai untuk v1 | Perlu konfirmasi dari |
|---|---|---|---|
| OQ-1 (BLOCKING) | Kategori berlaku ke ketiga form (Tolak/Tolak-edit/Batalkan) atau cuma "Tolak" utama? | Asumsi sementara: cuma form "Tolak" utama (§2). | Pengguna |
| OQ-2 (BLOCKING) | Single-select atau multi-select? | Single-select (§3). | Pengguna |
| OQ-3 (BLOCKING) | "Alasan Lain" butuh field teks tambahan wajib, atau textarea alasan existing sudah cukup? | Tidak perlu field tambahan — textarea existing sudah cukup (§3). | Pengguna |
| OQ-4 (non-blocking) | Definisi persis tiap kategori (kapan approver harus pilih yang mana) — lihat §1. | Interpretasi kerja di tabel §1, cukup untuk mulai implementasi karena kategori murni label pilihan tanpa logic bercabang. | Pengguna, idealnya sebelum training approver memakai fitur ini |
| OQ-5 (non-blocking) | Apakah kategori ini akan dipakai untuk pelaporan/analitik (mis. "berapa reject karena Kalkulasi PSSP bulan ini") — kalau ya, ini memperkuat alasan pilih kolom enum typed di `02-data-model.md` alih-alih key JSON biasa. | Diasumsikan YA (kategori tanpa rencana pelaporan tidak banyak gunanya) — lihat rekomendasi di `02-data-model.md`. | Pengguna |
