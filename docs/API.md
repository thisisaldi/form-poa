# API Reference

## Cara pengujian (mulai dari sini)

Hampir seluruh endpoint membutuhkan session cookie (`poa_session`, di-set melalui login, dibaca oleh `getCurrentUser()` di `src/lib/session.ts`). Terdapat 2 cara untuk mendapatkan cookie tersebut:

### Cara 1 — login melalui API (paling mudah untuk Postman/curl)

Tersedia endpoint login khusus untuk pengujian di luar browser: **`POST /api/auth/login`**, body `{ "nip": "..." }`, tanpa membutuhkan password. Apabila NIP valid dan aktif, responsnya `Set-Cookie: poa_session=...` — simpan cookie tersebut (curl: gunakan `-c cookies.txt`, Postman: cookie jar-nya otomatis) dan gunakan untuk request-request berikutnya.

```bash
# Login, simpan cookie ke cookies.txt
curl -c cookies.txt -X POST https://staging-form-poa.chc.pharmalink.id/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"nip":"P260205"}'

# Gunakan cookie yang sama untuk memanggil endpoint lain
curl -b cookies.txt https://staging-form-poa.chc.pharmalink.id/api/users/P260205/subordinates
```

Di Postman: request pertama ke `/api/auth/login` (method POST, body raw JSON `{"nip": "..."}`) — Postman otomatis menyimpan cookie dari response ke cookie jar-nya, sehingga request berikutnya ke domain yang sama otomatis membawa cookie tersebut tanpa perlu disalin manual.

Logout (untuk clear session): `POST /api/auth/logout` atau `GET /api/auth/logout`.

### Cara 2 — menggunakan cookie dari browser yang sudah login

Apabila sedang login di browser (untuk pengujian yang membutuhkan role/data spesifik yang sudah memiliki session): DevTools → Application/Storage → Cookies → cari `poa_session` → salin value-nya → di Postman/curl, kirim sebagai header `Cookie: poa_session=<value>`.

⚠️ Cookie ini bersifat `httpOnly` — tidak dapat diambil melalui `document.cookie` di console, HARUS diambil dari DevTools tab Application/Storage. Cookie juga scoped per-domain — cookie dari production tidak dapat digunakan untuk pengujian ke staging/localhost, harus login ulang di masing-masing environment.

### Penyebab error 401

Apabila mendapatkan `{ "error": "Unauthorized" }` status 401, artinya request tersebut tidak membawa cookie session yang valid — periksa salah satu dari: cookie tidak terkirim sama sekali (request baru dari tool testing tidak otomatis membawa cookie browser), domain tidak cocok, atau session memang belum ada (belum login melalui Cara 1/2 di atas).

---

## Auth

### `POST /api/auth/login`
Login tanpa password, hanya menggunakan NIP — endpoint khusus testing/API-only (halaman login di browser menggunakan Server Action, bukan route ini).
- **Auth**: tidak diperlukan (ini adalah endpoint login itu sendiri).
- **Body** (JSON): `{ "nip": string }`
- **Response 200**: `{ "ok": true, "user": { "nip", "name", "role" } }`, plus `Set-Cookie: poa_session=...`.
- **Error**: `400` NIP kosong · `404` NIP tidak ditemukan · `403` akun inactive/dummy — bentuk `{ "ok": false, "error": string }`.

### `POST /api/auth/logout` / `GET /api/auth/logout`
Menghapus session.
- **Auth**: tidak diperlukan.
- **Response**: redirect (302/307) ke `/login`, cookie di-clear. Dua method disediakan karena Next.js layout tidak dapat mutate cookie langsung dari sana (membutuhkan GET-navigable route).

---

## Users

### `GET /api/users/{nip}/subordinates`
Flat list seluruh orang di level manapun di bawah `nip` (berjalan melalui `User.nipAtasan`, BFS, depth cap 10) — **semua role**, bukan hanya MR, termasuk user dengan `isActive: false`.
- **Auth**: wajib login, role apapun diperbolehkan.
- **Path param**: `nip`
- **Response 200**: `{ "nip", "name", "role", "subordinates": [{ "nip", "name", "role", "jabatan", "nipAtasan", "isActive" }] }`
- **Error**: `404` NIP tidak ditemukan.

### `GET /api/users/{nip}/superiors`
Rantai atasan `nip`, diurutkan dari yang terdekat, berjalan melalui `User.nipAtasan` ke atas (depth cap 10, terdapat guard cycle).
- **Auth**: wajib login, role apapun diperbolehkan.
- **Path param**: `nip`
- **Response 200**: `{ "nip", "name", "role", "superiors": [{ "nip", "name", "role", "jabatan", "isActive" }] }`
- **Error**: `404` NIP tidak ditemukan.

### `GET /api/users/{nip}/outlets`
Outlet yang dapat dipegang/diakses oleh NIP ini saat ini — MR: dari `MrOutletAssignment`; ASM/SM/NSM: fallback `Outlet.coveredByNip/coveredByRole`; akun dummy: seluruh outlet.
- **Auth**: wajib login, role apapun diperbolehkan.
- **Path param**: `nip`
- **Response 200**: array `{ kodePI, namaOutlet, groupRS, sector, subSektor }`.
- **Error**: `404` NIP tidak ditemukan.

---

## Outlets

### `GET /api/outlets`
List seluruh outlet aktif (`statusOutlet: "A"`), diurutkan berdasarkan nama.
- **Auth**: ⚠️ **tidak ada** — satu-satunya endpoint baca yang tidak membutuhkan login sama sekali (di luar sync dan login/logout).
- **Response 200**: array `{ kodePI, namaOutlet }`.

### `GET /api/outlets/{kodePI}/customers`
Customer/dokter yang terhubung ke outlet ini (gabungan data lokal dan live Nexus), dengan fokus PM ditampilkan lebih dulu.
- **Auth**: wajib login, role apapun diperbolehkan.
- **Path param**: `kodePI`
- **Query param** (opsional): `spesialisasi` — memfilter hasil berdasarkan spesialisasi.
- **Response 200**: array customer (bentuk dari `getCustomersByOutlet`).
- **Error**: `404` outlet tidak ditemukan.

---

## POA / Export

### `GET /api/poa-doctors?nip={nip}&startDate={startDate}`
List dokter (1 baris per pasangan kodePI+namaCust, grouping sama dengan `PoaDoctorApproval`/`DraftChecklist.tsx`) di PoaForm milik satu NIP pada **satu kuartal kalender** (`PoaForm.period`, format `YYYY-QN`). Default kuartal berjalan (`currentQuarter()`); `?startDate=` (opsional, `YYYY-MM-DD`) berlaku 2 tingkat: (1) pilih kuartal yang MENGANDUNG tanggal itu (`quarterFromDate()`), (2) lalu buang `PoaLineItem` yang `periodeAwal`-nya BUKAN persis bulan itu — jadi cuma dokter yang punya minimal 1 line item mulai di bulan itu yang muncul (dokter dengan produk campuran periodeAwal beda bulan tetap muncul, tapi `produk` di response cuma yang match). `startDate=2026-08-01` dan `startDate=2026-08-15` sama-sama resolve ke bulan `202608`.
- **Auth**: session login (role apapun) **ATAU** HTTP Basic Auth — dua-duanya cukup, tidak ada yang wajib di atas yang lain. Basic Auth ditambahkan 2026-08-19 supaya aplikasi eksternal bisa panggil endpoint ini tanpa session cookie. Kredensialnya DB-backed (`PoaDoctorsApiCredential`, satu baris singleton, password di-hash pakai scrypt — lihat `src/lib/apiBasicAuth.ts`/`secretHash.ts`), diatur ADMIN dari halaman Admin (`setPoaDoctorsApiCredentialAction`), bukan env var — supaya bisa dirotasi tanpa redeploy. Belum pernah diset (baris belum ada) → Basic Auth selalu gagal (fallback ke session-only).
  - **Cara set/rotate kredensial**: login sebagai ADMIN → halaman Admin → panel "API Basic Auth — /api/poa-doctors" (`PoaDoctorsApiCredentialPanel.tsx`) → isi Username + Password baru → Simpan/Ganti Kredensial. Password **tidak pernah ditampilkan lagi** setelah disimpan (cuma hash yang disimpan di DB) — untuk mengganti, isi ulang kedua field, bukan edit yang lama. Kredensial ini SENGAJA tidak didokumentasikan nilainya di sini (atau di file mana pun yang ter-commit ke repo) — kalau butuh tahu nilainya, cek langsung ke yang men-set/rotate terakhir kali (lihat "diperbarui oleh" di panel Admin), jangan disimpan sebagai plaintext di dokumen.
  - **Contoh pemanggilan** (ganti `<username>`/`<password>` dengan kredensial yang sudah diset di atas):
    ```bash
    curl -u '<username>:<password>' \
      "https://staging-form-poa.chc.pharmalink.id/api/poa-doctors?nip=12345"
    ```
- **Query param**: `nip` (wajib), `startDate` (opsional, `YYYY-MM-DD` — pilih kuartal, lihat di atas), `keyword` (opsional — filter substring case-insensitive ke `idPoa`/`dokter.namaCust`/`dokter.namaOutlet`/`dokter.kodeCust`/`dokter.kodePI`)
- **Response 200**: array `{ uidPoa, uidCustomer, idPoa, nip, path, periode: { startDate, endDate }, kuartal, approveUntil, usedInExodus, dokter: { kodeCust, namaCust, spesialisasi, kodePI, namaOutlet, outletId, customerId, customerCodeExodus }, estimasi, nilaiPssp, estimasiAktif, nilaiPsspAktif, produk: [{ kodeProduk, namaProduk, estimasi, nilaiPssp, pengaliNilaiR, nilaiR, hna, qtyPerBulan, qtyTotal, productId, principalId, principalName, principalCode, categoryProduct }] }`.
  - `nip` (2026-09-04, request tim Exodus): `PoaForm.ownerId` — NIP MR/pemilik POA ini (yang BIKIN pengajuannya), bukan NIP dokter (dokter gak punya NIP, itu `dokter.kodeCust`).
  - `uidPoa` = `PoaForm.id`, `uidCustomer` = anchor `PoaLineItem.id` (any row belonging to this doctor — same "anchor item" concept `/poa/[id]/doctor/[itemId]/edit` uses, which re-queries every row sharing kodePI+namaCust once opened). Restored as a pair 2026-09-03 after Exodus asked for both back (was briefly collapsed into one `uidPoa` = line-item id on 2026-09-02).
  - `path`: path frontend `/poa/{uidPoa}/doctor/{uidCustomer}/edit` — halaman detail per-dokter yang sama persis dipakai UI in-app.
  - `periode` (2026-09-04, iterasi ke-3 field ini — history: `periode` awal ambigu (ternyata kuartal-level) → di-rename `periodeKuartal` → dihapus karena percuma (sama utk semua row) → sekarang balik pakai nama `periode` tapi ARTINYA BEDA): calendar `startDate`/`endDate` milik DOKTER ini sendiri, dihitung dari `PoaLineItem.periodeAwal`/`lamaPeriode` (`monthsDateRange(expandPeriodeMonths(...))`, lihat `src/lib/poaDoctorsRows.ts`). Field ini DOCTOR-level, bukan per-produk — `periodeAwal`/`lamaPeriode` adalah input dokter (`LineItemEditor.tsx`'s `DokterFieldsSection`, satu kontrol per submission dokter) yang diduplikasi ke semua `PoaLineItem` row dokter itu (pola sama dengan `jenisPsSp`/`bentukPssp` per komentar `schema.prisma`), diambil dari anchor item. TIDAK ADA `periode` per-produk — semua produk 1 dokter selalu punya periode yang sama.
  - `kuartal` (2026-09-04, ditambah balik setelah `periodeKuartal` dihapus): `PoaForm.period` apa adanya (`"2026-Q3"`) — SAMA untuk semua row dalam 1 response (beda dengan `periode` di atas yang per-dokter). Sengaja dipertahankan sebagai string tunggal murah, bukan `{ startDate, endDate }` lagi seperti `periodeKuartal` dulu — itu yang dianggap redundant/percuma, string "Q-berapa" doang gak masalah.
  - `dokter.outletId`/`customerId` (2026-09-02, request tim Exodus): sama persis dengan `dokter.kodePI`/`kodeCust` — bukan id numerik terpisah dari Exodus, cuma alias nama field sesuai yang diminta tim Exodus (`Outlet.kodePI` memang di-upsert langsung dari Exodus's own `OutletCode` di `outletSync.ts`, jadi identifier-nya sudah sama).
  - `dokter.customerCodeExodus` (2026-09-02, request tim Exodus): kode Exodus sendiri buat customer ini (`Customer.customerCodeExodus`, contoh `"C14"` — beda dari `customerId`/`kodeCust` di atas). **DB-only**, TIDAK live-fetch per request: sumbernya (`core/v1/customers/users/{nip}`) di-scope per-NIP, jadi live-fetch per baris dokter bakal jadi satu external call per PoaForm owner pada path company-wide (`?nip=` kosong) — dilarang `docs/PERFORMANCE.md` §2.4. Di-backfill lewat job batch terpisah (`scripts/syncCustomerCodeExodus.ts`, per-active-MR loop sama seperti `outletSync.ts`), bukan ditulis dari request path ini. `null` kalau belum pernah ke-backfill.
  - `estimasi`/`nilaiPssp` (level dokter, dan sekali lagi per baris di `produk`): sama formula dengan `computeItemValues()` di `/api/poa/{id}/export` — `estimasi = rencanaTotalBiaya`, `nilaiPssp = rencanaTotalBiaya × persenPsspDokter × pengaliNilaiR` (pengaliNilaiR default 1 kalau null). Angka rupiah mentah (belum dibagi 1.000.000 seperti tampilan in-app), dijumlah per periode pengajuan (bukan per bulan). Ini "estimasi rencana" — bersumber dari `PoaLineItem` (draft/pengajuan), BUKAN kontrak PSSP yang sedang berjalan.
  - `estimasiAktif`/`nilaiPsspAktif` (2026-08-19, docs/TODO.md #17): estimasi dari kontrak PSSP yang **masih aktif** (`PsspKontrak`, `prdAkhir >= bulan berjalan`) untuk dokter ini — terpisah dari `estimasi`/`nilaiPssp` rencana di atas. Matched berdasarkan `kdOutlet` (= `kodePI` dokter) + `kdCust` (= `kodeCust` dokter), diapportion (`computeActivePsspStats`/`apportion`, `src/lib/activePssp.ts`) ke kuartal kalender berjalan yang sama dengan `quarter` di atas — sama pola dengan `doctorPsspInfo` di `poa/[id]/page.tsx`. `0` apabila dokter tidak punya `kodeCust` (isManualCustomer) atau memang tidak ada kontrak PSSP aktif yang match.
  - `approveUntil`: nilai enum `PoaStatus` (`DRAFT`, `SUBMITTED_TO_ASM`, `APPROVED_BY_ASM`, `SUBMITTED_TO_SM`, `APPROVED_BY_SM`, `SUBMITTED_TO_NSM`, `APPROVED_BY_NSM`, `REVISI`) — dari `PoaDoctorApproval.status` kalau baris approval-nya sudah ada (submitted minimal sekali), fallback ke `PoaForm.status` kalau dokter itu masih di DRAFT/REVISI dan belum pernah disubmit (belum ada row `PoaDoctorApproval`).
  - `produk`: distinct produk per dokter dari `PoaLineItem`, urutan sesuai `createdAt` baris pertamanya.
  - `produk[].qtyPerBulan` (2026-09-04, ubah dari clipped-ke-kuartal jadi full range): array `{ bulan, qty }` untuk SETIAP bulan dalam `periodeAwal..periodeAwal+lamaPeriode-1` produk ini — bisa lebih dari 3 entri, bisa melewati batas kuartal yang di-query, TIDAK ada lagi entri `qty: 0` untuk bulan di luar rentang (dulu selalu 3 entri sesuai kuartal, dengan bulan sebelum `periodeAwal` di-set 0 — itu yang bikin salah paham "kok bulan pertama 0" berulang kali; sekarang setiap entri yang muncul pasti > 0, kalau HNA valid).
  - `produk[].hna`/`nilaiR` (2026-09-08, ganti dari live ke FROZEN — laporan Exodus: `qty × nilaiR` gak match `nilaiPssp` kalau harga produk berubah setelah baris POA-nya diisi): `hna` = `PoaLineItem.hargaSatuanTerkecil` (HNA ÷ konversiPembagi, snapshot SAAT baris dibuat — field yang sama dipakai ngitung `rencanaTotalBiaya`), `nilaiR` = `hna × persenPsspDokter` (`persenPsspDokter` sendiri sudah snapshot rasio nilai R produk saat itu — field read-only "% PSSP User" di form). Bukan lagi live Exodus per request. Berlaku buat baris lama maupun baru (kedua kolom sumbernya sudah ada dari awal, gak perlu backfill). Dengan ini, `qty × nilaiR × pengaliNilaiR` = `nilaiPssp` (`pengaliNilaiR` sengaja gak ikut dikalikan ke dalam `nilaiR` — sudah field terpisah).
  - `produk[].productId`/`principalId`/`principalName`/`principalCode`/`categoryProduct` (2026-09-02, request tim Exodus): dari Exodus core products API (`api.pharos.id/exodus/core/v1/products` — `id`/`product_principal.{id,name,code}`/`product_category.name`), live-first (lihat `getProductMasterByKodeProduk` di `src/lib/poaDoctorsRows.ts` — beda dari `hna`/`nilaiR` di atas yang sudah frozen), fallback ke kolom `Product.exodusProductId`/`principalId`/`principalName`/`principalCode`/`categoryProduct` di DB kalau live API sedang tidak tersedia. Kolom DB ini diisi write-through — bukan lewat script import terjadwal, tapi otomatis ter-upsert setiap kali live fetch berhasil untuk kodeProduk yang dipanggil endpoint ini. `null` untuk semuanya kalau live API belum pernah berhasil ambil produk itu DAN DB juga belum pernah ke-backfill.
- **Error**: `400` NIP kosong atau `startDate` bukan format `YYYY-MM-DD` · `404` NIP tidak ditemukan. Response `[]` (bukan error) kalau NIP valid tapi tidak punya PoaForm di kuartal yang dimaksud.

---

## Target Value

### `GET /api/target-value`
Target Rupiah bulanan dari `TargetHospitalValue` — bentuk response tergantung `?nip=` (lihat di bawah). Diubah 2026-09-02: breakdown default per-GT (bukan per-MR, `namaGT` stabil walau MR-nya pindah/di-vacant-kan, nip tidak), DAN `?nip=` sekarang resolve GT-nya secara LIVE (`MrOutletAssignment` + `Outlet.namaGT`, periode sync terbaru — lihat `getCurrentGTsForMrNips` di `src/lib/targetHospitalValue.ts`), bukan dari kolom nipMR/nipASM/nipSM/nipNSM di `TargetHospitalValue` sendiri — kolom itu snapshot dari saat Excel target terakhir di-import, jadi kalau GT pindah tangan setelah import, `?nip=` tetap ikut ke pemegang GT SAAT INI tanpa nunggu re-import.
- **Auth**: session login (role **NSM atau ADMIN saja**, role lain 403; NSM selalu dipaksa ke NIP dirinya sendiri — `?nip=` yang dikirim NSM diabaikan) **ATAU** HTTP Basic Auth — kredensial **sama** dengan yang dipakai `/api/poa-doctors` (`PoaDoctorsApiCredential`, diatur ADMIN dari halaman Admin, lihat entri di atas), tidak ada kredensial terpisah untuk endpoint ini. Basic Auth dan session ADMIN bisa query nip manapun.
- **Query param** (semua opsional): `nip` — menentukan rollup siapa yang dikembalikan; role NIP tersebut (`User.role`, harus MR/ASM/SM/NSM) menentukan subtree MR yang di-resolve (MR → dirinya sendiri, ASM/SM/NSM → `getSubordinateMRNips`), lalu GT yang dipegang subtree itu di-SUM. `periode` (`YYYYMM`, misalnya `202608`) mempersempit ke 1 bulan, DAN (2026-09-03) menentukan struktur org bulan APA yang dipakai buat resolve GT-nya — `MrOutletAssignment` disync per bulan, jadi target bulan lama pakai GT assignment bulan itu juga, bukan struktur org hari ini (kalau GT-nya udah pindah tangan sejak itu, jawabannya tetap akurat buat bulan yang ditanya). Fallback ke periode sync TERBARU kalau `periode` kosong (gak ada 1 bulan acuan) atau `periode` itu sendiri belum pernah disync buat nip ini (mis. bulan depan). Tanpa `periode` sama sekali = selalu pakai struktur terkini. `breakdown` (any value, cuma ngaruh kalau `?nip=` diisi) — return per-GT rows di bawah nip itu instead of 1 angka total (lihat Response ketiga di bawah). `namaGT` (2026-09-07, diabaikan kalau `?nip=` ada/dipaksa session NSM — nip menang) — filter ke SATU GT tertentu, shape sama kayak "get target all", cocok dicocokkan lewat `normalizeGTName` jadi bisa pakai ejaan `Outlet.namaGT` (live, mis. "JEMBER + BONDOWOSO") ATAU ejaan `TargetHospitalValue`/Excel (mis. "JEMBER BONDOWOSO") — dua-duanya balikin row yang sama.
- **Response 200 (`?nip=` diisi, tanpa `breakdown`)**: array `{ nip, nama, jabatan, target, periode }` — `target` = SUM seluruh GT yang dipegang subtree nip itu (lihat resolusi periode-aware di atas), 1 baris per periode yang punya data. Kosong kalau nip itu (atau subtree-nya) belum punya `MrOutletAssignment` sama sekali. Matching GT `Outlet.namaGT` ke `TargetHospitalValue.namaGT` (Excel target) dilakukan setelah dibuang semua karakter non-alfanumerik dan prefix "DUMMY " (`normalizeGTName`, `src/lib/targetHospitalValue.ts`) — dua sumber itu sesekali beda tanda baca/spasi buat GT gabungan (mis. "JEMBER + BONDOWOSO" vs "JEMBER BONDOWOSO", "BANDUNG A.YANI" vs "BANDUNG A YANI"), dan beberapa row Excel masih pake prefix "DUMMY " lama walau udah keisi target beneran. GT yang beda nama TOTAL (bukan cuma format) di-reconcile manual lewat `GT_NAME_ALIASES` di `scripts/importTargetHospitalValue.ts` (per konfirmasi tim target 2026-09-03) — kalau ada GT baru yang masih gak ke-SUM, cek dulu apa itu beda nama total sebelum nganggep bug matching.
- **Response 200 (`?nip=` + `?breakdown=1`)**: array `{ namaGT, nipMR, namaMR, target, periode }` — shape SAMA kayak "get target all" di bawah, tapi cuma GT yang LIVE ada di subtree nip itu (bukan company-wide). Jumlah `target` di sini = angka `?nip=` tanpa `breakdown` (verified 2026-09-03).
- **Response 200 (`?nip=` kosong + `?namaGT=` diisi, "get target by GT")**: array `{ namaGT, nipMR, namaMR, target, periode }` — shape SAMA kayak "get target all" di bawah, tapi cuma 1 GT (`namaGT` di response = ejaan asli `TargetHospitalValue`, bukan ejaan yang kamu kirim di query). Kosong array kalau GT itu gak ketemu.
- **Response 200 (`?nip=` dan `?namaGT=` kosong dua-duanya, "get target all")**: array `{ namaGT, nipMR, namaMR, target, periode }` — 1 baris per (GT, periode) COMPANY-WIDE, `namaGT` adalah unit assignment (1 GT = 1 MR/SPV saat ini). `namaMR`/`nipMR` di sini MASIH snapshot import (siapa yang tercatat pegang GT itu saat Excel terakhir di-import), bukan live seperti jalur `?nip=` — `nipMR` null kalau namanya belum ter-resolve ke User asli (placeholder "VACANT MR ..."/"... (SHADOW)" — lihat catatan resolusi nip di script import).
- **Error**: `403` role bukan NSM/ADMIN saat pakai session · `401` Basic Auth gagal/kredensial belum diset · `404` `?nip=` tidak ditemukan · `400` role NIP tersebut bukan MR/ASM/SM/NSM (target value tidak berlaku, misalnya ADMIN/GM).

---

Kedua endpoint berikut mengembalikan file **`.xlsx` binary** (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`), bukan JSON — apabila diuji melalui curl gunakan `-o namafile.xlsx` agar tidak ter-print sebagai raw binary ke terminal; melalui Postman biasanya otomatis menawarkan "Save Response" / preview.

### `GET /api/poa/{id}/export`
Export Excel untuk 1 POA (single MR/SPV, sesuai isi POA itu sendiri).
- **Auth**: wajib login, plus `canView(actor, poa)` — 403 apabila POA tersebut tidak visible bagi user yang login.
- **Path param**: `id` (POA id, bukan NIP)
- **Response 200**: file `.xlsx`, filename `POA_{period}_{nip}.xlsx`. Sheets: **Summary**, **Estimasi PSSP per Bulan**, **Pengisian** (detail per-baris, 50+ kolom), **PSSP Aktif**, **Audit Log**.
- **Error**: `404` POA tidak ditemukan · `403` tidak memiliki akses.

### `GET /api/export/team`
Export Excel gabungan — seluruh POA dari subordinate MR di bawah user yang login (untuk ASM/SM/NSM).
- **Auth**: wajib login; role `MR`/`SFE` diblokir (403); membutuhkan minimal satu subordinate MR (404 apabila kosong).
- **Query param** (opsional): `period` — format `YYYY-QN` (misalnya `2026-Q3`), memfilter ke 1 periode. Kosongkan untuk seluruh periode.
- **Response 200**: file `.xlsx`, filename `Rekap_POA_{period?}_{nama}.xlsx`. Sheets: **Ringkasan Tim**, **Per MR**, **Estimasi PSSP per Bulan**, **Semua Pengajuan** (header-nya memiliki struktur yang sama dengan sheet "Pengisian" pada export per-POA, lihat `docs/PERFORMANCE.md`/commit 2026-08-05), **PSSP Aktif**, **Summary Per Outlet**, **Summary by Produk**.
- **Error**: `403` role diblokir · `404` tidak ada subordinate MR.

---

## POA Standarisasi

### `GET /api/poa-standarisasi/dokumen/{driveFileId}`
Proxy download **terautentikasi** untuk dokumen confidential POA Standarisasi (NIE/COA/CPOB/Flyer, Permintaan SP Non Sales, Form Approval Standarisasi, Surat Approval Standarisasi KFT, Bukti TTD — 2026-08-27, ditandai confidential oleh user). Setiap link dokumen di wizard `/poa-standarisasi/[id]` mengarah ke sini, BUKAN link Google Drive mentah — link Drive mentah visibility-nya ikut setting sharing folder Drive, bukan authz app, dan tidak bisa dicatat siapa yang buka.
- **Auth**: session login, plus `canViewPoaStandarisasi(actor, pengajuan)` — `driveFileId` di-resolve dulu ke pengajuan/produk/dokter pemiliknya di server (4 kemungkinan tabel: `PoaStandarisasiDokumen`, `PoaStandarisasiProduk.formApprovalDriveFileId`, `PoaStandarisasi.suratApprovalStandarisasiKftDriveFileId`, `PoaStandarisasiDokterApproval.buktiTtdDriveFileId`), request tidak pernah trust `pengajuanId`/label dari client.
- **Path param**: `driveFileId` (Google Drive file id, bukan id lokal).
- **Efek samping**: setiap request yang berhasil lolos authz dicatat 1 baris ke `PoaStandarisasiFileAccessLog` (siapa/kapan/dokumen mana) — powering panel "Riwayat Akses Dokumen" di wizard.
- **Response 200**: file binary, `Content-Type` & filename mengikuti metadata asli di Drive, `Content-Disposition: inline` (browser coba tampilkan langsung, bukan force-download), `Cache-Control: private, no-store`.
- **Error**: `401` sesi tidak valid · `404` `driveFileId` tidak ditemukan di keempat tabel di atas · `403` ditemukan tapi user tidak berhak (bukan owner/ASM/SM/NSM chain-nya/ADMIN-GM-SFE-VIEWER) · `500` gagal fetch dari Drive (mis. Drive belum dikonfigurasi).

---

## Sync (auth berbeda — shared secret, bukan cookie)

3 endpoint berikut dipanggil dari luar (cron/job eksternal), BUKAN dari browser session — autentikasinya menggunakan header `X-Sync-Secret` yang harus cocok dengan env var `SYNC_SECRET`, bukan `getCurrentUser()`.

⚠️ **Apabila `SYNC_SECRET` tidak di-set pada environment, pengecekannya di-skip sepenuhnya (endpoint menjadi terbuka bebas)** — pastikan env var ini selalu ter-set di staging/production. `sales-history` dan `sales-value-monthly` juga membutuhkan `MSSQL_CONNECTION_STRING` ter-set (500 apabila kosong); `org-structure` **tidak lagi** — sudah cutover ke Nexus API 2026-08-20 (docs/org-nexus-migration/), auth-nya lewat `nexusAuthHeaders()`.

```bash
curl -X POST https://staging-form-poa.chc.pharmalink.id/api/sync/org-structure \
  -H "X-Sync-Secret: <SYNC_SECRET_value>"
```

### `POST /api/sync/org-structure`
Sinkronisasi struktur organisasi dari Nexus API (`get_employees`/`get_subordinates`) ke Postgres — cutover 2026-08-20, sebelumnya dari MSSQL (lihat `docs/org-nexus-migration/`). `nipAtasan` diinferensi lewat closest-enclosing-ancestor algorithm (`src/lib/sync/orgNexusInference.ts`), bukan field eksplisit dari API. GM di luar scope (tetap manual via `scripts/importStrukturVerifiedKAM.ts`).
- **Response 200**: `{ "ok": true, ...hasil dari runOrgSync }`. `500` apabila gagal.

### `POST /api/sync/sales-history`
Sinkronisasi histori sales outlet (`OutletSalesHistory`, 12 bulan terakhir per kodePI × itemKode) dari `mkt_insight.dbo.DIR10001B`.
- **Response 200**: `{ "ok": true, ...hasil dari runSalesHistorySync }`. Bentuk error sama seperti di atas.

### `POST /api/sync/sales-value-monthly`
Sinkronisasi value sales bulanan per outlet (`OutletSalesValueMonthly`, dari tahun lalu penuh sampai dengan bulan terakhir yang selesai tahun ini).
- **Response 200**: `{ "ok": true, ...hasil dari runOutletSalesValueMonthlySync }`. Bentuk error sama seperti di atas.

---

## Catatan untuk penambahan endpoint baru

- Route baru yang membutuhkan login: panggil `getCurrentUser()` dari `@/lib/session` di baris pertama handler, kembalikan `401` apabila `null` — pola yang sama persis digunakan di seluruh route auth-cookie di atas, jangan membuat varian baru.
- Apabila membutuhkan role-gating, ikuti pola `authz.ts` (lihat `docs/PERFORMANCE.md`/`CLAUDE.md`) — jangan menempatkan logic permission ad-hoc di route handler.
- Perbarui dokumen ini apabila menambah/mengubah route — agar tidak semakin menyimpang dari kode aktual (prinsip yang sama dengan `docs/PERFORMANCE.md` §6).
