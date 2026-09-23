# SP Non Sales Memo — Business Rules

Sumber requirement: diskusi chat langsung 2026-09-23 (bukan dokumen/memo tertulis). Kutipan kunci:

> flownya jadinya generate memo saja. tim sales support (yang harusnya nanti akan ada akun untuk mereka) bisa akses memo ini untuk mereka proses. lalu kalau sudah di sign, tinggal centang aja (sama kayak yang approval dokter)

## §1 Flow (confirmed, FINAL 2026-09-23)

1. Data pengajuan Standarisasi (outlet, distributor, produk, jumlah box — sama data yang sudah ada di tab "Permintaan SP Non Sales" existing) dipakai buat **generate memo** oleh sistem — bukan user upload dokumen dari luar seperti flow lama.
2. Role baru **Sales Support** (akun baru, belum ada di sistem) bisa akses memo yang di-generate itu, download/lihat, dan proses tanda tangan **di luar sistem** (cetak, tanda tangan fisik ke 2 pihak tetap — lihat §4).
3. Setelah tanda tangan selesai, Sales Support **centang status "sudah di-sign"** di sistem — **TIDAK ADA upload ulang dokumen hasil scan** (dikonfirmasi eksplisit 2026-09-23: "ga perlu upload lagi"). Centang doang, reuse pola checkbox `sudahTtd` yang sudah ada di approval dokter (`DokterApproval.sudahTtd`, dipakai `poaStandarisasi.ts:1104`). Ini menyederhanakan banyak hal — tidak perlu storage untuk "versi final hasil scan", cukup 1 file (generated) + 1 boolean status.

## §2 Definisi Role: Sales Support

- Role baru di enum `Role` (`prisma/schema.prisma:12-33`), belum ada sekarang.
- **Scope: dibatasi ke POA Standarisasi saja** (dikonfirmasi user 2026-09-23) — TIDAK punya akses ke POA Estimasi atau modul lain.
- Dalam POA Standarisasi sendiri, apa scope-nya company-wide (semua MR) atau dibatasi lebih lanjut (per distributor/region) — **belum dikonfirmasi** (user jawab "scope nya cuma standarisasi aja" waktu ditanya soal hierarchy — menjawab axis fitur, bukan axis organisasi). Asumsi kerja v1: company-wide dalam POA Standarisasi (Sales Support kerja sebagai satu tim terpusat yang proses semua memo, tidak terikat hierarchy MR→ASM→SM→NSM), karena posisi mereka bukan bagian dari approval chain sales, murni operasional pemrosesan dokumen.
- Tidak punya kapasitas approve/reject seperti ASM/SM/NSM — cuma read memo + centang status sign.

## §3 Status keputusan (SEMUA RESOLVED 2026-09-23)

1. ~~**Format/isi memo**~~ — **RESOLVED**, lihat §4. User kirim foto memo fisik ("ASLI", sudah ditandatangan basah) yang jadi acuan template persis.
2. ~~**Mekanisme "atur dokumen"**~~ — **RESOLVED**: cuma generate, TIDAK ada upload ulang. Sales Support proses tanda tangan di luar sistem (cetak-tandatangan fisik), lalu balik ke sistem cuma buat **centang status** "sudah di-sign" — bukan upload file hasil scan. Sistem tidak pernah menyimpan versi "sudah ditandatangan", cuma versi generate + status boolean.
3. ~~**Nama penanda-tangan**~~ — **RESOLVED**: fixed 2 orang tertentu (bukan dinamis per akun yang login) — lihat §4.
4. ~~**Nomor "No SP memo" footer**~~ — **RESOLVED**: diisi manual oleh Sales Support sendiri (bukan auto-generate, bukan dari sistem lain).

Tidak ada lagi open question yang BLOCKING implementasi.

## §4 Template memo (dari foto fisik, 2026-09-23 — "ASLI", sudah ditandatangan)

Layout, field demi field:

**Header:**
```
MEMO
GA HO – Dept. Sales Support
DSS / IX / 189.26
```
Nomor memo format **RESOLVED 2026-09-23** (koreksi dari contoh awal): `DSS / [bulan romawi] / POA[seq 3-digit].[tahun 2 digit]` — contoh `DSS / IX / POA001.26`, lanjut `POA002.26`. Counter reset per **tahun**, bulan romawi tracks bulan kalender saat generate independen dari counter (implementasi: `formatMemoNomor`, `src/lib/spNonSalesMemo.ts`).

**Metadata block:**
```
Kepada   : Ibu Tuti Ambarwati
Dari     : Dept. Sales Support
Perihal  : Permintaan Produk SP Non Sales
Tanggal  : 04 September 2026
```

**Body (paragraf fixed, alasan variabel):**
```
Dengan hormat,
  Sehubungan dengan kebutuhan untuk Donasi Rumah Sakit, maka bersama dengan ini
kami mengajukan permintaan produk SP Non Sales dengan rincian sebagai berikut:
```
"Donasi Rumah Sakit" kemungkinan variabel (alasan pengajuan) — di data POA Standarisasi sekarang TIDAK ada field "alasan/tujuan SP Non Sales" tersimpan. Perlu field baru ATAU alasan ini fixed generic per semua memo — lihat §7 #6.

**Tabel produk:**

| NO | PT NIE | KODE PRODUK | NAMA PRODUK | QTY (BOX) | NAMA PENGUSUL | NAMA OUTLET |
|---|---|---|---|---|---|---|
| 1 | PT. PRIMA MEDIKA LABORATORIES | 0209078 | BECANTEX 100 MG FC TABLET | 1 | DARMA GUNAWAN | RS PRIMAYA BEKASI BARAT / FG001327 |

Pemetaan ke data existing:
- **PT NIE** — kemungkinan `Product.principalName` (`prisma/schema.prisma:658`, sudah ada, dari Exodus core products API) — BELUM dikonfirmasi ini field yang sama persis (perlu cek isi datanya cocok format "PT. ...").
- **Kode Produk / Nama Produk** — `Product.kodeProduk`/`namaProduk`, sudah ada.
- **Qty (Box)** — `PoaStandarisasiProduk.spNonSalesJumlahBox`, sudah ada.
- **Nama Pengusul** — nama MR pemilik pengajuan (`PoaStandarisasi.ownerId` → `User.name`), sudah ada.
- **Nama Outlet** — `Outlet.namaOutlet` + `/ kodePI` (format "RS PRIMAYA BEKASI BARAT / FG001327" = nama + kode outlet), sudah ada.

**Closing:**
```
Demikian informasi ini kami sampaikan. Atas bantuan dan kerjasamanya kami ucapkan terima kasih.
```

**Tanda tangan (2 blok, DITANDATANGANI TANGAN di contoh — bukan digital):**
```
Hormat kami,                          Menyetujui,
[tanda tangan basah]                  [kosong di contoh — belum di-ttd pihak ini]
(Christiana Meyta)                    (M.Nugraha)
```
**FIXED** — 2 nama tertentu, sama di semua memo, TIDAK dinamis per siapa yang generate/login (dikonfirmasi 2026-09-23: "ya itu fixed 2 orang itu yang ttd"). Centang status "sudah di-sign" di sistem tetap dilakukan siapapun akun Sales Support yang login (self-report per §1.3), tapi NAMA tercetak di memo selalu 2 nama config ini, tidak ikut siapa yang login/centang. Disimpan sebagai config (mis. `GoogleDriveConfig`-style, ADMIN-settable), bukan hardcode di kode.

**Footer:**
```
Note : No SP memo ini 2026000179 (PML)
```
Nomor terpisah dari nomor memo di header (`DSS/IX/189.26` vs `2026000179`). **Diisi manual oleh Sales Support sendiri** (dikonfirmasi 2026-09-23: "no sp memo itu isi sendiri dari sales support nya") — bukan auto-generate, bukan dari sistem lain. Field bebas teks, boleh kosong.

## §7 Open questions — status & assumptions dipakai untuk v1

| # | Pertanyaan | Status | Blocking? |
|---|---|---|---|
| 1 | Format/template memo | **RESOLVED** — lihat §4 | Tidak |
| 2 | Mekanisme edit (upload ulang atau tidak) | **RESOLVED** — tidak ada upload ulang, cuma centang status (§1.3) | Tidak |
| 3 | Nama penanda-tangan (fixed atau dinamis) | **RESOLVED** — fixed 2 orang, config ADMIN-settable (§4) | Tidak |
| 4 | Sumber "No SP memo" footer | **RESOLVED** — manual, diisi Sales Support sendiri (§4) | Tidak |
| 5 | Scope Sales Support dalam POA Standarisasi (company-wide vs per-distributor/region) | Asumsi kerja: company-wide (lihat §2) — belum dikonfirmasi eksplisit | Tidak — bisa dipersempit belakangan tanpa migration besar |
| 6 | Apa Sales Support login pakai NIP asli (sinkron dari `Struktur_Marketing_PI`), atau akun manual dibikin ADMIN? | Asumsi: akun manual dibuat ADMIN, NIP bebas format asal unik — TIDAK sinkron dari struktur sales | Tidak — default masuk akal |
| 7 | Bisa lebih dari satu akun Sales Support sekaligus? | Asumsi: ya, banyak akun, akses sama rata (company-wide, lihat #5) | Tidak |
| 8 | Alasan pengajuan ("Donasi Rumah Sakit" di §4) — field baru diisi manual per pengajuan, atau fixed? | Asumsi: field baru bebas teks, MR isi saat generate — TIDAK fixed | Tidak — nullable, aman kalau salah asumsi |
| 9 | Nomor urut memo — counter reset per bulan atau per tahun? | **RESOLVED 2026-09-23** — per tahun, format `POA[seq 3-digit].[YY]`, lihat §4 | Tidak lagi |

Tidak ada lagi item blocking — implementasi bisa mulai. Sisa item di atas (5-9) aman dikerjakan dengan asumsi tertulis, tinggal disesuaikan kalau ternyata meleset.
