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

### `GET /api/poa-doctors?nip={nip}`
List dokter (1 baris per pasangan kodePI+namaCust, grouping sama dengan `PoaDoctorApproval`/`DraftChecklist.tsx`) di PoaForm milik satu NIP pada **kuartal kalender berjalan saja** (`PoaForm.period`, format `YYYY-QN`, dibandingkan dengan `currentQuarter()` — bukan kuartal lain, tidak ada override). Satu NIP biasanya cuma punya 1 PoaForm per kuartal, tapi response tetap flat array untuk jaga-jaga. NIP dikirim sebagai query param (bukan `/[nip]/` di path) — tetap GET karena ini murni operasi baca, tanpa side-effect.
- **Auth**: session login (role apapun) **ATAU** HTTP Basic Auth — dua-duanya cukup, tidak ada yang wajib di atas yang lain. Basic Auth ditambahkan 2026-08-19 supaya aplikasi eksternal bisa panggil endpoint ini tanpa session cookie. Kredensialnya DB-backed (`PoaDoctorsApiCredential`, satu baris singleton, password di-hash pakai scrypt — lihat `src/lib/apiBasicAuth.ts`/`secretHash.ts`), diatur ADMIN dari halaman Admin (`setPoaDoctorsApiCredentialAction`), bukan env var — supaya bisa dirotasi tanpa redeploy. Belum pernah diset (baris belum ada) → Basic Auth selalu gagal (fallback ke session-only).
- **Query param**: `nip` (wajib)
- **Response 200**: array `{ uidPoa, uidCustomer, path, approveUntil, dokter: { kodeCust, namaCust, spesialisasi, kodePI, namaOutlet }, estimasi, nilaiPssp, estimasiAktif, nilaiPsspAktif, produk: [{ kodeProduk, namaProduk, estimasi, nilaiPssp }] }`.
  - `uidPoa`: `PoaForm.id`.
  - `uidCustomer`: id salah satu `PoaLineItem` milik dokter ini (dipakai sebagai "anchor item" — sama seperti pola `/poa/[id]/doctor/[itemId]/edit`, yang query ulang semua baris dengan kodePI+namaCust yang sama begitu dibuka, jadi id baris manapun milik dokter ini valid).
  - `path`: path frontend `/poa/{uidPoa}/doctor/{uidCustomer}/edit` — halaman detail per-dokter yang sama persis dipakai UI in-app.
  - `estimasi`/`nilaiPssp` (level dokter, dan sekali lagi per baris di `produk`): sama formula dengan `computeItemValues()` di `/api/poa/{id}/export` — `estimasi = rencanaTotalBiaya`, `nilaiPssp = rencanaTotalBiaya × persenPsspDokter × pengaliNilaiR` (pengaliNilaiR default 1 kalau null). Angka rupiah mentah (belum dibagi 1.000.000 seperti tampilan in-app), dijumlah per periode pengajuan (bukan per bulan). Ini "estimasi rencana" — bersumber dari `PoaLineItem` (draft/pengajuan), BUKAN kontrak PSSP yang sedang berjalan.
  - `estimasiAktif`/`nilaiPsspAktif` (2026-08-19, docs/TODO.md #17): estimasi dari kontrak PSSP yang **masih aktif** (`PsspKontrak`, `prdAkhir >= bulan berjalan`) untuk dokter ini — terpisah dari `estimasi`/`nilaiPssp` rencana di atas. Matched berdasarkan `kdOutlet` (= `kodePI` dokter) + `kdCust` (= `kodeCust` dokter), diapportion (`computeActivePsspStats`/`apportion`, `src/lib/activePssp.ts`) ke kuartal kalender berjalan yang sama dengan `quarter` di atas — sama pola dengan `doctorPsspInfo` di `poa/[id]/page.tsx`. `0` apabila dokter tidak punya `kodeCust` (isManualCustomer) atau memang tidak ada kontrak PSSP aktif yang match.
  - `approveUntil`: nilai enum `PoaStatus` (`DRAFT`, `SUBMITTED_TO_ASM`, `APPROVED_BY_ASM`, `SUBMITTED_TO_SM`, `APPROVED_BY_SM`, `SUBMITTED_TO_NSM`, `APPROVED_BY_NSM`, `REVISI`) — dari `PoaDoctorApproval.status` kalau baris approval-nya sudah ada (submitted minimal sekali), fallback ke `PoaForm.status` kalau dokter itu masih di DRAFT/REVISI dan belum pernah disubmit (belum ada row `PoaDoctorApproval`).
  - `produk`: distinct produk per dokter dari `PoaLineItem`, urutan sesuai `createdAt` baris pertamanya.
- **Error**: `400` NIP kosong · `404` NIP tidak ditemukan. Response `[]` (bukan error) kalau NIP valid tapi tidak punya PoaForm di kuartal berjalan.

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

## Sync (auth berbeda — shared secret, bukan cookie)

3 endpoint berikut dipanggil dari luar (cron/job eksternal), BUKAN dari browser session — autentikasinya menggunakan header `X-Sync-Secret` yang harus cocok dengan env var `SYNC_SECRET`, bukan `getCurrentUser()`.

⚠️ **Apabila `SYNC_SECRET` tidak di-set pada environment, pengecekannya di-skip sepenuhnya (endpoint menjadi terbuka bebas)** — pastikan env var ini selalu ter-set di staging/production. Ketiganya juga membutuhkan `MSSQL_CONNECTION_STRING` ter-set (500 apabila kosong).

```bash
curl -X POST https://staging-form-poa.chc.pharmalink.id/api/sync/org-structure \
  -H "X-Sync-Secret: <SYNC_SECRET_value>"
```

### `POST /api/sync/org-structure`
Sinkronisasi struktur organisasi dari MSSQL ke Postgres.
- **Response 200**: `{ "ok": true, ...hasil dari runOrgSync }`. `500` apabila gagal atau `MSSQL_CONNECTION_STRING` tidak ter-set.

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
