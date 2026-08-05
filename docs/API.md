# API Reference

## Cara testing (mulai dari sini)

Hampir semua endpoint butuh session cookie (`poa_session`, di-set via login, dibaca `getCurrentUser()` di `src/lib/session.ts`). Ada 2 cara dapetin cookie itu:

### Cara 1 — login lewat API (paling gampang buat Postman/curl)

Ada endpoint login khusus buat testing di luar browser: **`POST /api/auth/login`**, body `{ "nip": "..." }`, gak butuh password. Kalau NIP-nya valid & aktif, responsnya `Set-Cookie: poa_session=...` — tinggal simpan cookie itu (curl: pakai `-c cookies.txt`, Postman: cookie jar-nya otomatis) dan pakai buat request-request berikutnya.

```bash
# Login, simpan cookie ke cookies.txt
curl -c cookies.txt -X POST https://staging-form-poa.chc.pharmalink.id/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"nip":"P260205"}'

# Pakai cookie yang sama buat manggil endpoint lain
curl -b cookies.txt https://staging-form-poa.chc.pharmalink.id/api/users/P260205/subordinates
```

Di Postman: request pertama ke `/api/auth/login` (method POST, body raw JSON `{"nip": "..."}`) — Postman otomatis nyimpen cookie dari response ke cookie jar-nya, jadi request berikutnya ke domain yang sama otomatis kebawa cookie-nya, gak perlu di-copy manual.

Logout (buat clear session): `POST /api/auth/logout` atau `GET /api/auth/logout`.

### Cara 2 — pakai cookie dari browser yang udah login

Kalau lagi login di browser (buat testing yang butuh role/data spesifik yang udah ada session-nya): DevTools → Application/Storage → Cookies → cari `poa_session` → copy value-nya → di Postman/curl, kirim sebagai header `Cookie: poa_session=<value>`.

⚠️ Cookie ini `httpOnly` — gak bisa diambil lewat `document.cookie` di console, HARUS dari DevTools tab Application/Storage. Cookie juga scoped per-domain — cookie dari production gak kepake buat test ke staging/localhost, harus login ulang di masing-masing environment.

### Kenapa 401?

Kalau dapet `{ "error": "Unauthorized" }` status 401, artinya request-nya gak bawa cookie session yang valid — cek lagi salah satu dari: cookie gak kekirim sama sekali (request baru dari tool testing gak otomatis bawa cookie browser), domain gak cocok, atau session-nya emang belum ada (belum login lewat Cara 1/2 di atas).

---

## Auth

### `POST /api/auth/login`
Login tanpa password, cuma NIP — endpoint testing/API-only (halaman login di browser pakai Server Action, bukan route ini).
- **Auth**: tidak perlu (ini endpoint login-nya sendiri).
- **Body** (JSON): `{ "nip": string }`
- **Response 200**: `{ "ok": true, "user": { "nip", "name", "role" } }`, plus `Set-Cookie: poa_session=...`.
- **Error**: `400` NIP kosong · `404` NIP gak ketemu · `403` akun inactive/dummy — bentuk `{ "ok": false, "error": string }`.

### `POST /api/auth/logout` / `GET /api/auth/logout`
Hapus session.
- **Auth**: tidak perlu.
- **Response**: redirect (302/307) ke `/login`, cookie di-clear. Dua method disediain karena Next.js layout gak bisa mutate cookie langsung dari sana (butuh GET-navigable route).

---

## Users

### `GET /api/users/{nip}/subordinates`
Flat list semua orang di level manapun di bawah `nip` (jalan via `User.nipAtasan`, BFS, depth cap 10) — **semua role**, bukan cuma MR, termasuk user yang `isActive: false`.
- **Auth**: wajib login, role apapun boleh.
- **Path param**: `nip`
- **Response 200**: `{ "nip", "name", "role", "subordinates": [{ "nip", "name", "role", "jabatan", "nipAtasan", "isActive" }] }`
- **Error**: `404` NIP gak ketemu.

### `GET /api/users/{nip}/superiors`
Rantai atasan `nip`, urut dari yang terdekat, jalan via `User.nipAtasan` ke atas (depth cap 10, ada guard cycle).
- **Auth**: wajib login, role apapun boleh.
- **Path param**: `nip`
- **Response 200**: `{ "nip", "name", "role", "superiors": [{ "nip", "name", "role", "jabatan", "isActive" }] }`
- **Error**: `404` NIP gak ketemu.

### `GET /api/users/{nip}/outlets`
Outlet yang bisa dipegang/diaksesin NIP ini sekarang — MR: dari `MrOutletAssignment`; ASM/SM/NSM: fallback `Outlet.coveredByNip/coveredByRole`; akun dummy: semua outlet.
- **Auth**: wajib login, role apapun boleh.
- **Path param**: `nip`
- **Response 200**: array `{ kodePI, namaOutlet, groupRS, sector, subSektor }`.
- **Error**: `404` NIP gak ketemu.

---

## Outlets

### `GET /api/outlets`
List semua outlet aktif (`statusOutlet: "A"`), urut nama.
- **Auth**: ⚠️ **tidak ada** — satu-satunya endpoint baca yang gak butuh login sama sekali (di luar sync & login/logout).
- **Response 200**: array `{ kodePI, namaOutlet }`.

### `GET /api/outlets/{kodePI}/customers`
Customer/dokter yang terhubung ke outlet ini (gabungan data lokal + live Nexus), yang fokus PM duluan.
- **Auth**: wajib login, role apapun boleh.
- **Path param**: `kodePI`
- **Query param** (opsional): `spesialisasi` — filter hasil by spesialisasi.
- **Response 200**: array customer (bentuk dari `getCustomersByOutlet`).
- **Error**: `404` outlet gak ketemu.

---

## POA / Export

Dua-duanya balikin file **`.xlsx` binary** (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`), bukan JSON — kalau ditest via curl pakai `-o namafile.xlsx` biar gak ke-print raw binary ke terminal, kalau via Postman biasanya otomatis nawarin "Save Response" / preview.

### `GET /api/poa/{id}/export`
Export Excel 1 POA (single MR/SPV, sesuai isi POA itu sendiri).
- **Auth**: wajib login, plus `canView(actor, poa)` — 403 kalau POA-nya gak visible buat user yang login.
- **Path param**: `id` (POA id, bukan NIP)
- **Response 200**: file `.xlsx`, filename `POA_{period}_{nip}.xlsx`. Sheets: **Summary**, **Estimasi PSSP per Bulan**, **Pengisian** (detail per-baris, 50+ kolom), **PSSP Aktif**, **Audit Log**.
- **Error**: `404` POA gak ketemu · `403` gak punya akses.

### `GET /api/export/team`
Export Excel gabungan — semua POA dari subordinate MR di bawah user yang login (buat ASM/SM/NSM).
- **Auth**: wajib login; role `MR`/`SFE` diblok (403); butuh punya subordinate MR (404 kalau kosong).
- **Query param** (opsional): `period` — format `YYYY-QN` (mis. `2026-Q3`), filter ke 1 periode. Kosongkan buat semua periode.
- **Response 200**: file `.xlsx`, filename `Rekap_POA_{period?}_{nama}.xlsx`. Sheets: **Ringkasan Tim**, **Per MR**, **Estimasi PSSP per Bulan**, **Semua Pengajuan** (header-nya sama struktur kayak sheet "Pengisian" di export per-POA, lihat `docs/PERFORMANCE.md`/commit 2026-08-05), **PSSP Aktif**, **Summary Per Outlet**, **Summary by Produk**.
- **Error**: `403` role diblok · `404` gak ada subordinate MR.

---

## Sync (auth beda — shared secret, bukan cookie)

3 endpoint ini dipanggil dari luar (cron/job eksternal), BUKAN dari browser session — auth-nya pakai header `X-Sync-Secret` yang harus cocok sama env var `SYNC_SECRET`, bukan `getCurrentUser()`.

⚠️ **Kalau `SYNC_SECRET` gak di-set di environment, pengecekannya di-skip total (endpoint jadi kebuka bebas)** — pastikan env var ini selalu ke-set di staging/production. Ketiganya juga butuh `MSSQL_CONNECTION_STRING` ke-set (500 kalau kosong).

```bash
curl -X POST https://staging-form-poa.chc.pharmalink.id/api/sync/org-structure \
  -H "X-Sync-Secret: <SYNC_SECRET_value>"
```

### `POST /api/sync/org-structure`
Sync struktur organisasi dari MSSQL ke Postgres.
- **Response 200**: `{ "ok": true, ...hasil dari runOrgSync }`. `500` kalau gagal atau `MSSQL_CONNECTION_STRING` gak ke-set.

### `POST /api/sync/sales-history`
Sync histori sales outlet (`OutletSalesHistory`, 12 bulan terakhir per kodePI × itemKode) dari `mkt_insight.dbo.DIR10001B`.
- **Response 200**: `{ "ok": true, ...hasil dari runSalesHistorySync }`. Sama error shape kayak di atas.

### `POST /api/sync/sales-value-monthly`
Sync value sales bulanan per outlet (`OutletSalesValueMonthly`, dari tahun lalu penuh s/d bulan terakhir yang selesai tahun ini).
- **Response 200**: `{ "ok": true, ...hasil dari runOutletSalesValueMonthlySync }`. Sama error shape kayak di atas.

---

## Catatan buat yang mau nambah endpoint baru

- Route baru yang butuh login: panggil `getCurrentUser()` dari `@/lib/session` di baris pertama handler, `401` kalau `null` — pola yang sama persis dipakai di semua route auth-cookie di atas, jangan bikin varian baru.
- Kalau butuh role-gating, ikuti pola `authz.ts` (lihat `docs/PERFORMANCE.md`/`CLAUDE.md`) — jangan taro logic permission ad-hoc di route handler.
- Update dokumen ini kalau nambah/ubah route — biar gak makin nyimpang dari kode aktual (sama prinsipnya kayak `docs/PERFORMANCE.md` §6).
