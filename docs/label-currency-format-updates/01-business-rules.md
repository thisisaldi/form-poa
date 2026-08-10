# Format Currency & Rename Label — Business Rules

Requirement asli: lihat `README.md` §Sumber requirement.

## 1. Item #3 — Format Currency (1 Jt = 1 Rb → dikonfirmasi jadi ÷ 1.000.000 tanpa suffix)

**Rule dikonfirmasi pengguna (2026-08-10, via `AskUserQuestion`)**: nilai asli **dibagi 1.000.000**, ditampilkan **tanpa suffix apapun** (bukan "Rp", bukan "Rb", bukan "Jt"). Desimal pakai koma (format Indonesia).

**⚠️ Scope final BUKAN app-wide** — 2 pengecualian dikonfirmasi belakangan (2026-08-10, lihat OQ-2 dan OQ-7 di bawah), keduanya TETAP pakai angka asli (`Math.round(n).toLocaleString("id-ID")`, tanpa skala apapun):
1. **Export Excel** (`api/poa/[id]/export/route.ts`, `api/export/team/route.ts`) — "pakai angka asli aja" untuk keperluan pelaporan.
2. **Seluruh `LineItemEditor.tsx`** (halaman input: Tambah Rencana POA, Tambah Produk, Edit Dokter, estimasi real-time saat ngisi form) — "di tambah rencana, tetap pakai angka uang yang asli jangan dibagi 1 jt", scope dikonfirmasi ke SELURUH file, bukan cuma satu panel.

Rule ÷1.000.000 tanpa suffix di atas **hanya berlaku** untuk halaman Ringkasan/Summary (`summary/page.tsx`, `RingkasanMetricsTables.tsx`), Draft Checklist (`DraftChecklist.tsx`, dipakai ulang oleh `ApprovalsChecklist.tsx`/`PoaDetailTabs.tsx`), Monitoring (`MonitoringChecklist.tsx`, `monitoring/page.tsx`), dan halaman admin (`AdminTabs.tsx`, `TargetProdukForm.tsx`, `TargetHospitalValueForm.tsx`, `SalesAchievementTable.tsx`, `dashboard/page.tsx`, `pm-dashboard/page.tsx`) — semuanya via `formatCurrency` di `src/lib/format.ts`.

| Nilai asli (Rp) | Tampilan baru |
|---|---|
| 1.000.000 | `1` |
| 500.000 | `0,5` |
| 3.000.000 | `3` |
| 1.250.000 | `1,25` (atau dibulatkan — lihat OQ-1 soal jumlah desimal) |

Ini **menggantikan seluruh** logic `formatRp` yang ada sekarang, termasuk 2 varian scaling yang sudah ada di `DraftChecklist.tsx:21-31`:
- `formatRp(n)` — saat ini: ≥1M "X,X Jt", ≥1B "X,X M", di bawahnya raw. **Diganti total** dengan rule baru (÷1.000.000, tanpa suffix, untuk SEMUA rentang nilai — tidak ada lagi cabang M/Jt/raw).
- `formatRpPssp(n)` — saat ini: ≥1M "X Rb" (sebenarnya ÷1.000.000 tapi diberi label "Rb", inkonsistensi penamaan lama). **Diganti** jadi sama persis dengan `formatRp` baru (kedua fungsi jadi identik secara efektif — kandidat digabung jadi satu fungsi saja, lihat `03-ui-and-access.md`).

### Blast radius

`formatRp` didefinisikan ulang independen (bukan 1 shared util) di **14 file**:

| File | Jumlah pemakaian |
|---|---|
| `LineItemEditor.tsx` | 44 |
| `summary/page.tsx` | 37 |
| `RingkasanMetricsTables.tsx` | 25 |
| `DraftChecklist.tsx` (definisi asli, `:21-31`) | 20 |
| `MonitoringChecklist.tsx` | 10 |
| `api/poa/[id]/export/route.ts` | 5 (inline arrow fn beda, format `` `Rp ${...}` `` — export Excel, lihat OQ-2 soal scope) |
| `SalesAchievementTable.tsx` | 4 |
| `PoaDetailTabs.tsx` | 4 |
| `monitoring/page.tsx` | 4 |
| `admin/TargetProdukForm.tsx` | 3 |
| `admin/AdminTabs.tsx` | 3 |
| `pm-dashboard/page.tsx` | 3 |
| `dashboard/page.tsx` | 3 |
| `admin/TargetHospitalValueForm.tsx` | 2 |
| `ApprovalsChecklist.tsx` | 1 |

Plus **37 titik lain** yang pakai `.toLocaleString("id-ID")` mentah langsung tanpa lewat fungsi `formatRp` apapun — titik-titik ini juga perlu di-audit ulang satu-satu untuk menentukan apakah itu currency (perlu ikut format baru) atau angka non-currency (qty, persentase, dll — tidak boleh ikut ter-scale).

**Rekomendasi implementasi** (bukan requirement bisnis, tapi keputusan desain yang mempengaruhi cara kerja): ekstrak SATU fungsi `formatCurrency`/`formatRp` shared ke `src/lib/` (mis. `src/lib/format.ts`), lalu redirect ke-14 definisi lokal untuk `import` dari situ dan hapus definisi duplikatnya — BUKAN edit isi 14 fungsi lokal satu-satu (rawan salah satu file kelewat/salah edit, dan tetap meninggalkan duplikasi kode untuk perubahan format berikutnya di masa depan).

## 2. Item #4 — Entertain → ENT

Field internal `persenEntertain` **tidak berubah nama** (25 occurrence, sebagian besar adalah nama variabel/field, bukan label tampilan). Yang berubah cuma **label tampilan**, 4 titik:

| File | Baris | Konteks |
|---|---|---|
| `LineItemEditor.tsx` | `:1389` | `numInput("% Entertain", "persenEntertain")` — label input form |
| `DraftChecklist.tsx` | `:527` | `{ label: "Entertain", value: s.entertainTotal }` — label chart/tabel |
| `MonitoringChecklist.tsx` | `:324` | `{ label: "Entertain", value: entertainTotal, ... }` |
| `RingkasanMetricsTables.tsx` | `:538` | `label: "Entertain"` — label baris tabel |

Ganti keempatnya jadi `"ENT"` (atau `"% ENT"` untuk yang berupa input persentase, mengikuti konvensi label existing — lihat konteks masing-masing saat implementasi).

## 3. Item #5 — Discount → Campaign/DPL/DPF

Label compound `"Discount + DPL + DPF"` (selalu muncul sebagai satu string gabungan, tidak pernah "Discount" berdiri sendiri), 4 titik:

| File | Baris | Konteks |
|---|---|---|
| `FaqContent.tsx` | `:163` | `name: "Discount + DPL + DPF"` |
| `DraftChecklist.tsx` | `:526` | `{ label: "Discount + DPL + DPF", value: s.discountTotal }` |
| `MonitoringChecklist.tsx` | `:323` | `{ label: "Discount + DPL + DPF", value: discountTotal, color: WARNING }` |
| `summary/page.tsx` | perlu grep ulang saat implementasi — komentar riset menunjuk baris `~1223`, tapi belum diverifikasi persis string-nya | Label serupa di tab Ringkasan/Summary |

Ganti jadi `"Campaign / DPL / DPF"` (atau format tanpa spasi di sekitar `/`, ikuti konvensi visual existing string compound lain di app — perlu dicek saat implementasi, bukan diasumsikan).

## 4. Item #6 — "POA Rencana/Berjalan" → "PSSP Rencana/Aktif" — KOREKSI ISTILAH, BUTUH KONFIRMASI ULANG

**Temuan penting**: string literal "POA Rencana", "POA Berjalan", atau "Rencana/Berjalan" **tidak ada di manapun di kode**. Vokabuler yang benar-benar dipakai sekarang adalah pasangan **"Rencana" / "Aktif"** — sudah separuh jalan match dengan target rename ("PSSP Rencana"/"PSSP Aktif" di target, "Rencana"/"Aktif" di kode saat ini). "Berjalan" dipakai di kode untuk konsep BEDA (status kontrak PSSP yang masih berjalan/aktif, bukan pasangan istilah "Rencana vs Berjalan" seperti disebut task).

Sebaran "Rencana"/"Aktif" saat ini (bukan exhaustive, representatif skala):

| File | "Rencana" | "Aktif" |
|---|---|---|
| `summary/page.tsx` | ×103 | ×53 |
| `RingkasanCharts.tsx` | ×20 | ×31 |
| `RingkasanMetricsTables.tsx` | ×27 | ×17 |
| `LineItemEditor.tsx` | ×16 | ×3 |

Plus di `faq/FaqContent.tsx`, `poa/[id]/edit/page.tsx`, `poa/[id]/doctor/[itemId]/edit/page.tsx`, `poa/[id]/page.tsx`, `AdminTabs.tsx`, `MonitoringChecklist.tsx`, `PoaDetailTabs.tsx`.

**3 titik yang sudah eksplisit mencampur "PSSP" + "Berjalan"/"Aktif" sebagai sinonim** (referensi konsistensi kalau rename ini jalan) — `DraftChecklist.tsx:286` ("PSSP Aktif (Kontrak Berjalan)"), `:424` (`label: "PSSP Berjalan"`), `:583` ("Biaya Aktif (PSSP Berjalan)").

**❓ Open question BLOCKING**: task literal minta rename dari "POA Rencana/Berjalan" — istilah yang tidak ada di kode. Ada 2 kemungkinan yang dimaksud pengguna:
1. **Tambah prefix "PSSP" di depan "Rencana"/"Aktif" yang sudah ada** — jadi "PSSP Rencana" dan "PSSP Aktif" di tempat-tempat yang sekarang cuma "Rencana"/"Aktif" polos. Ini konsisten dengan pola rename yang SUDAH terjadi sebagian di `docs/summary-ringkasan/` (istilah "Pengajuan" → "PSSP Rencana" sudah dilakukan di tab Ringkasan, lihat `docs/summary-ringkasan/01-business-rules.md` §1) — kemungkinan besar task ini minta pola yang sama diperluas ke tempat lain yang belum ikut ganti.
2. **Task sebenarnya salah ingat/salah tulis nama istilah lama** (mengira nama lamanya "POA Rencana/Berjalan" padahal sebenarnya sudah "Rencana"/"Aktif") — kalau begitu, mungkin task ini sebenarnya sudah (sebagian) terpenuhi oleh perubahan `docs/summary-ringkasan/`, dan yang perlu dikerjakan cuma memperluas cakupannya (di luar tab Ringkasan yang sudah selesai) ke tempat lain yang masih polos "Rencana"/"Aktif" tanpa prefix "PSSP".

**⚠️ Risiko over-match**: "Aktif" dipakai untuk konsep tidak terkait di banyak tempat (mis. `User.isActive`, filter "Aktif"/"Non-aktif" untuk status entity lain). **Jangan blind find-replace string "Aktif" → "PSSP Aktif"** — setiap titik harus diverifikasi manual dulu bahwa konteksnya benar tentang PSSP/POA sebelum diganti.

## Open questions — status & assumptions dipakai untuk v1

| # | Pertanyaan | Asumsi yang dipakai untuk v1 | Perlu konfirmasi dari |
|---|---|---|---|
| OQ-1 (non-blocking) | Item #3 — jumlah desimal saat hasil bagi tidak bulat (mis. 1.250.000 → `1,25` atau dibulatkan ke `1,3`)? | 2 desimal, dibuang trailing zero (mis. `1,25`, `1` bukan `1,00`) — pola umum tapi belum dikonfirmasi. | Pengguna |
| OQ-2 (✅ RESOLVED 2026-08-10) | Item #3 — apakah export Excel (`export/route.ts`, format `Rp ${...}` terpisah) ikut berubah, atau sengaja dipertahankan format lama untuk keperluan pelaporan resmi/audit? | **Dikonfirmasi: TIDAK ikut berubah.** Export Excel (`api/poa/[id]/export/route.ts` dan `api/export/team/route.ts`) tetap pakai angka asli (`Math.round(n).toLocaleString("id-ID")`, tanpa skala ÷1.000.000) — sempat diimplementasikan ikut berubah, dikoreksi balik setelah pengguna menegaskan "pakai angka asli aja". | Pengguna |
| OQ-7 (✅ RESOLVED 2026-08-10) | Item #3 — apakah seluruh `LineItemEditor.tsx` (Tambah Rencana POA, Tambah Produk, Edit Dokter, estimasi real-time saat mengisi form) ikut skala baru, atau tetap angka asli seperti halaman input pada umumnya? | **Dikonfirmasi: TETAP angka asli** — dikonfirmasi via `AskUserQuestion`: scope-nya seluruh file `LineItemEditor.tsx` (bukan cuma panel "Tambah Rencana POA"), bukan cuma satu panel. `formatRp` di file ini dikembalikan jadi fungsi lokal raw-number (`Math.round(n).toLocaleString("id-ID")`, tanpa skala/suffix), TIDAK lagi import `formatCurrency` dari `@/lib/format`. Hanya halaman Ringkasan/Summary/Draft Checklist yang pakai skala ÷1.000.000. | Pengguna |
| OQ-3 (BLOCKING) | Item #6 — scope rename yang dimaksud (lihat 2 interpretasi di §4). | Tidak ada asumsi kerja default dipilih — terlalu berisiko over-match kalau ditebak, perlu dikonfirmasi eksplisit sebelum mulai grep-replace 100+ titik. | Pengguna |
| OQ-4 (non-blocking) | Item #5 — exact string di `summary/page.tsx` yang menyebut "Discount" (belum diverifikasi baris pastinya, cuma perkiraan dari komentar riset). | Akan di-grep ulang saat implementasi, bukan diasumsikan dari riset awal. | — (verifikasi teknis, bukan keputusan bisnis) |
