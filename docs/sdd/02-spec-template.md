# SDD — Struktur & Template Spesifikasi

Satu fitur = satu folder di `docs/<nama-fitur>/`, berisi minimal 2 file (`01` dan `02` boleh digabung untuk fitur kecil, tetapi jangan digabung ke dalam README):

```
docs/<nama-fitur>/
├── README.md              — indeks + status terkini (WAJIB, dibaca terlebih dahulu)
├── 01-business-rules.md   — requirement, definisi istilah, formula, aturan bisnis
├── 02-data-model.md       — skema Prisma yang diusulkan, sumber data per field
└── 03-ui-and-access.md    — halaman, role/akses, pola UI yang digunakan ulang
```

Contoh penerapan nyata: `docs/kpi-monitoring/` (keempat file di atas, semua terisi).

Untuk dokumen retroaktif (mendokumentasikan sistem yang sudah berjalan, bukan fitur baru yang sedang diusulkan — lihat `01-when-and-workflow.md` §"Kasus khusus"), judul dan framing section boleh disesuaikan (mis. tidak menyebut "v1"), tetapi isi wajib pada tiap section tetap harus ada.

Struktur di dokumen ini mengatur bentuk file. Untuk standar isi/kualitas tiap section (requirement dapat diuji, invariant, perilaku kegagalan, non-goals, dst.), lihat `04-quality-checklist.md` — ditinjau sebelum spesifikasi dianggap selesai.

## `README.md` — indeks & status

Wajib memuat, di bagian paling atas:
1. **Sumber requirement** — tautan/nomor memo, tanggal, dan siapa yang meminta.
2. **Status**, menggunakan simbol yang konsisten (lihat `03-conventions.md`):
   - 🟢 v1 diimplementasikan (tanggal) — sertakan juga apa yang TIDAK diimplementasikan di v1.
   - ⚠️ jika ada formula/keputusan yang masih berupa **asumsi kerja** (bukan konfirmasi asli dari stakeholder) — WAJIB ditandai secara jelas, jangan dicampur dengan yang sudah dikonfirmasi. Lihat pola di `docs/kpi-monitoring/README.md` pada baris status.
   - Belum dimulai / spesifikasi masih draft — tandai secara eksplisit, jangan biarkan statusnya ambigu.
3. **Ringkasan** — 3-5 kalimat, menjelaskan apa yang dibangun dan alasannya, untuk pembaca yang tidak sempat membaca ketiga file lainnya.

## `01-business-rules.md`

- Kutip sumber requirement asli pada baris pertama (contoh: `docs/kpi-monitoring/01-business-rules.md:3`).
- Susun definisi istilah/formula dalam bentuk tabel jika memungkinkan (parameter, bobot, formula) — hindari prosa panjang untuk sesuatu yang sebenarnya lebih tepat berupa tabel.
- **Section terakhir WAJIB: "Open questions — status & assumptions dipakai untuk v1"** (lihat format di `01-business-rules.md` §7 pada kpi-monitoring). Setiap open question dicatat dengan: pertanyaannya apa, asumsi yang digunakan untuk melanjutkan (jika ada), dan siapa yang perlu memberikan konfirmasi.
- Setiap requirement harus dapat diuji (angka/ambang konkret, bukan kata sifat seperti "cepat"/"aman") dan setiap transisi state (jika ada lifecycle/status) harus terdefinisi lengkap termasuk jalur kegagalan — lihat `04-quality-checklist.md` §3 dan §8.

## `02-data-model.md`

- Pisahkan dengan jelas antara data yang **sudah ada** (digunakan ulang, tanpa perubahan skema) dan data **baru** (memerlukan migration).
- Sertakan blok skema Prisma asli (bukan pseudo-code) untuk model baru, ditambah "Catatan desain" di bawahnya yang menjelaskan MENGAPA field tersebut berbentuk demikian (snapshot vs live-derive, alasan nullable, dst.) — bukan sekadar APA-nya.
- Jika ada model yang berpotensi diakses company-wide/berat, cross-reference ke `docs/PERFORMANCE.md` (constraint performa berlaku sejak tahap desain data model, bukan ditambal belakangan — lihat `PERFORMANCE.md` §2 poin 5).
- Tuliskan invariant yang berlaku pada model (apa yang SELALU benar, mis. keunikan, field yang tidak pernah berubah, tabel append-only) sebagai bagian dari "Catatan desain" — lihat `04-quality-checklist.md` §12.

## `03-ui-and-access.md`

- Susun role/access matrix dalam bentuk tabel (role → dapat melihat apa → dapat mengedit apa) — generalisasi dari `authz.ts`, JANGAN membuat RBAC baru yang tidak terhubung ke `getSubordinateMRNips`/`getVisiblePoaFilter`/pola yang sudah ada, kecuali memang sengaja berbeda konsep (dan alasannya dijelaskan).
- Cantumkan halaman yang diusulkan: route, siapa yang mengakses, pola UI yang digunakan ulang dari halaman yang sudah ada (sebutkan nama komponennya).
- Section "Non-goals v1" — sebutkan secara eksplisit apa yang SENGAJA belum dibangun, agar tidak dikira terlewat.
