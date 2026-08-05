# SDD — Struktur & Template Spec

Satu fitur = satu folder di `docs/<nama-fitur>/`, isi minimal 2 file (boleh gabung `01`+`02` kalau fiturnya kecil, tapi jangan gabung ke README):

```
docs/<nama-fitur>/
├── README.md              — index + status terkini (WAJIB, baca ini duluan)
├── 01-business-rules.md   — requirement, definisi istilah, formula, aturan bisnis
├── 02-data-model.md       — skema Prisma yang diusulkan, sumber data per field
└── 03-ui-and-access.md    — halaman, role/akses, pola UI yang di-reuse
```

Contoh nyata: `docs/kpi-monitoring/` (4 file di atas, semua terisi).

## `README.md` — index & status

Wajib ada di paling atas:
1. **Sumber requirement** — link/nomor memo, tanggal, siapa yang minta.
2. **Status** pakai emoji yang konsisten (lihat `03-conventions.md`):
   - 🟢 v1 diimplementasi (tanggal) — tulis juga apa yang TIDAK diimplementasi di v1.
   - ⚠️ kalau ada formula/keputusan yang masih **asumsi kerja** (bukan konfirmasi asli stakeholder) — WAJIB ditandai jelas, jangan campur sama yang udah dikonfirmasi. Lihat pola di `docs/kpi-monitoring/README.md` baris status.
   - Belum mulai / spec masih draft — tandain gitu aja, jangan biarin ambigu.
3. **Ringkasan cepat** — 3-5 kalimat, apa yang dibangun dan kenapa, buat orang yang gak mau baca 3 file lain.

## `01-business-rules.md`

- Kutip sumber requirement asli di baris pertama (mirip `docs/kpi-monitoring/01-business-rules.md:3`).
- Definisi istilah/formula dalam bentuk tabel kalau bisa (parameter, bobot, formula) — jangan prosa panjang buat sesuatu yang sebenernya tabel.
- **Section terakhir WAJIB: "Open questions — status & assumptions dipakai untuk v1"** (lihat `01-business-rules.md` §7 di kpi-monitoring buat formatnya). Tiap open question dicatat: pertanyaannya apa, asumsi yang dipakai buat lanjut (kalau ada), dan siapa yang perlu konfirmasi.

## `02-data-model.md`

- Pisahin jelas: data yang **udah ada** (reuse, gak ada perubahan skema) vs data **baru** (perlu migration).
- Prisma schema block asli (bukan pseudo-code) buat model baru, plus "Catatan desain" di bawahnya jelasin KENAPA field itu bentuknya begitu (snapshot vs live-derive, kenapa nullable, dst) — bukan cuma WHAT.
- Kalau ada model yang berpotensi company-wide/berat, cross-reference ke `docs/PERFORMANCE.md` (constraint performa itu berlaku dari tahap desain data model, bukan ditambal belakangan — lihat `PERFORMANCE.md` §2 poin 5).

## `03-ui-and-access.md`

- Role/access matrix dalam bentuk tabel (role → bisa lihat apa → bisa edit apa) — generalisasi dari `authz.ts`, JANGAN bikin RBAC baru yang gak nyambung ke `getSubordinateMRNips`/`getVisiblePoaFilter`/pola yang udah ada, kecuali emang sengaja beda konsep (dijelasin kenapa).
- Halaman yang diusulkan: route, siapa yang akses, pola UI yang di-reuse dari halaman existing (sebut nama komponennya).
- Section "Non-goals v1" — eksplisit sebut apa yang SENGAJA belum dibangun, biar gak dikira kelupaan.
