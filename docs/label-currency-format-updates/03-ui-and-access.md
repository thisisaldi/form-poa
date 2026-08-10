# Format Currency & Rename Label — UI & Access

## 1. Lokasi

Lintas ~14+ file (lihat daftar lengkap di `01-business-rules.md` §1) — bukan satu halaman spesifik, ini perubahan format/label yang menyebar ke hampir seluruh permukaan aplikasi yang menampilkan nominal Rupiah atau label Entertain/Discount/Rencana-Aktif.

## 2. Strategi implementasi yang direkomendasikan

1. **Item #3 (currency)**: buat `src/lib/format.ts` (atau lokasi `src/lib/` yang konsisten dengan util lain, mis. `poaUtils.ts` kalau memang currency formatting dianggap bagian dari domain POA) berisi satu fungsi `formatCurrency(n: number): string` yang mengimplementasikan rule §1 `01-business-rules.md`. Update ke-14 file untuk `import { formatCurrency } from "@/lib/format"` dan hapus definisi lokal `formatRp`/`formatRpPssp` masing-masing — **jangan** biarkan definisi lokal tetap ada dan cuma diubah isinya (defeats the purpose, duplikasi tetap ada untuk perubahan berikutnya).
2. **37 titik `.toLocaleString("id-ID")` mentah**: audit satu-satu (bukan grep-replace otomatis) — pisahkan mana yang genuinely currency (ikut format baru) vs qty/persentase/angka lain (jangan disentuh).
3. **Item #4, #5**: langsung ganti string literal di titik-titik yang sudah terdaftar di `01-business-rules.md` §2-§3 — jumlahnya kecil (4+4 titik), tidak perlu ekstraksi util.
4. **Item #6**: **tunggu jawaban OQ-3 di `01-business-rules.md` dulu** sebelum mulai — scope-nya terlalu besar (100+ titik) dan berisiko over-match untuk dikerjakan tanpa kepastian arah.

## 3. Role & akses

Tidak ada perubahan role/akses — ini murni perubahan tampilan, berlaku sama untuk semua role yang sudah bisa melihat halaman-halaman terkait (tidak mengubah `authz.ts`/gate manapun).

## 4. Non-goals v1

- **Tidak mengubah field/kolom database** — `persenEntertain`, `discountTotal`, dan field internal lain yang namanya kebetulan match label lama TIDAK di-rename di level data model, hanya label tampilannya.
- **Tidak mengerjakan item #6 sampai OQ-3 terjawab** — mengerjakan tanpa kejelasan scope berisiko rename sebagian/salah sasaran yang harus di-redo.
- **Export Excel** — scope-nya tunduk ke jawaban OQ-2 (`01-business-rules.md`), default diasumsikan ikut berubah tapi belum final.
- **Tidak menyentuh format currency di sistem eksternal** (Nexus/Exodus API request/response) — perubahan ini murni tampilan sisi aplikasi, tidak mengubah cara data dikirim/diterima dari API eksternal.
