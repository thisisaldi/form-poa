# API: GET /api/poa-doctors

Referensi khusus endpoint ini (dan detail-nya, `GET /api/poa-doctors/{id}`) untuk integrasi eksternal. Untuk endpoint lain lihat [`docs/API.md`](./API.md).

## GET /api/poa-doctors — list

## Ringkasan

List dokter (1 baris per pasangan `kodePI` + `namaCust`) dari POA milik satu NIP, **kuartal kalender berjalan saja** (dibandingkan dengan tanggal saat request dijalankan — tidak ada override periode). Satu NIP biasanya cuma punya 1 POA per kuartal, tapi response tetap array untuk jaga-jaga.

Hanya dokter yang **sudah FINAL diapprove (APPROVED_BY_NSM) di siklus berjalan, dan belum ditandai "dipakai" di Exodus** yang muncul (revisi 2026-08-27, permintaan tim Exodus — lihat `docs/exodus-poa-usage/`). Dokter yang baru diapprove ASM/SM (belum sampai NSM), belum pernah diapprove sama sekali, atau sudah `usedInExodus: true`, tidak dikembalikan sama sekali.

```
GET /api/poa-doctors?nip={nip}&keyword={keyword}
```

Contoh: `https://form-poa.chc.pharmalink.id/api/poa-doctors?nip=P250007&keyword=hermina`

## Autentikasi

Dua cara, salah satu cukup:

### 1. HTTP Basic Auth (dipakai aplikasi eksternal)

```bash
curl -u '<username>:<password>' \
  "https://form-poa.chc.pharmalink.id/api/poa-doctors?nip=P250007"
```

Kredensial di-manage ADMIN dari halaman Admin di app (panel "API Basic Auth — /api/poa-doctors"), tersimpan di DB dalam bentuk hash (bisa dirotasi kapan saja tanpa redeploy). Kalau kredensial belum pernah diset oleh ADMIN, Basic Auth akan selalu gagal — minta ADMIN set dulu lewat halaman Admin. Nilai username/password tidak didokumentasikan di file ini (dan sengaja tidak disimpan di repo) — tanyakan ke ADMIN yang terakhir set/rotate.

### 2. Session cookie (dipakai app sendiri / testing manual)

```bash
curl -c cookies.txt -X POST https://form-poa.chc.pharmalink.id/api/auth/login \
  -H "Content-Type: application/json" -d '{"nip":"<nip login>"}'

curl -b cookies.txt "https://form-poa.chc.pharmalink.id/api/poa-doctors?nip=P250007"
```

Role apapun boleh, asal sudah login.

**Staging**: endpoint yang sama tersedia di `https://staging-form-poa.chc.pharmalink.id` — kredensial/session staging TERPISAH dari production, tidak bisa dipakai silang.

## Request

| Param | Wajib | Keterangan |
|---|---|---|
| `nip` | ya | NIP MR yang datanya mau diambil (query param, bukan `/[nip]/` di path) |
| `keyword` | tidak | Filter tambahan DALAM hasil `nip` di atas (bukan search company-wide) — case-insensitive substring match terhadap `idPoa`, nama dokter, nama outlet, `kodeCust`, atau `kodePI` |

## Response 200

Array of:

```jsonc
{
  "uidPoa": "string",        // PoaForm.id (uuid) — dipakai untuk konstruksi path, BUKAN untuk ditampilkan ke user
  "idPoa": "POA0001",        // id human-readable — nomor urut GLOBAL, tidak pernah reset per periode
  "uidCustomer": "string",   // id salah satu PoaLineItem milik dokter ini ("anchor item")
  "path": "/poa/{uidPoa}/doctor/{uidCustomer}/edit", // path halaman detail per-dokter di app
  "periode": { "startDate": "2026-07-01", "endDate": "2026-09-30" },  // tanggal awal/akhir kuartal berjalan (PoaForm.period)
  "approveUntil": "NSM",     // SELALU "NSM" sejak revisi 2026-08-27 (lihat Catatan) — field dipertahankan untuk kompatibilitas
  "usedInExodus": false,     // SELALU false di response ini (baris usedInExodus:true sudah difilter keluar) — lihat Catatan
  "dokter": {
    "kodeCust": "string | null",
    "namaCust": "string",
    "spesialisasi": "string",
    "kodePI": "string | null",
    "namaOutlet": "string"
  },
  "estimasi": 0,        // rencanaTotalBiaya, dijumlah per dokter (rupiah mentah, belum dibagi 1.000.000)
  "nilaiPssp": 0,        // rencanaTotalBiaya × persenPsspDokter × pengaliNilaiR (default 1 kalau null)
  "estimasiAktif": 0,    // estimasi dari kontrak PSSP yang masih aktif (PsspKontrak), terpisah dari estimasi di atas
  "nilaiPsspAktif": 0,
  "produk": [
    {
      "kodeProduk": "string",
      "namaProduk": "string",
      "estimasi": 0,          // rencanaTotalBiaya produk ini (rupiah, full periode item — bukan diapportion ke kuartal)
      "nilaiPssp": 0,
      "pengaliNilaiR": 1,     // multiplier formula nilaiPssp (PoaLineItem.pengaliNilaiR, default 1 kalau null)
      "nilaiR": 2700,         // Rupiah — Exodus core products API's r_value (live), BEDA dari pengaliNilaiR di atas. null kalau kodeProduk tidak ketemu di manapun
      "hna": 50000,           // Product.hna (sell price per SJ — Satuan Jual), null kalau kodeProduk tidak match Product manapun
      "qtyPerBulan": [
        { "bulan": "202607", "qty": 8 },
        { "bulan": "202608", "qty": 8 },
        { "bulan": "202609", "qty": 8 }
      ],
      "qtyTotal": 24          // jumlah qty di atas untuk kuartal berjalan (= sum qtyPerBulan), satuan SJ — lihat catatan qtyPerBulan di bawah
    }
  ]
}
```

Catatan:
- `estimasi`/`nilaiPssp` bersumber dari `PoaLineItem` (draft/pengajuan) — "estimasi rencana", BUKAN kontrak PSSP yang sedang berjalan.
- `estimasiAktif`/`nilaiPsspAktif` bersumber dari kontrak PSSP aktif (`prdAkhir >= bulan berjalan`), matched by `kodePI`+`kodeCust`, diapportion ke kuartal kalender berjalan. `0` kalau dokter tidak punya `kodeCust` atau tidak ada kontrak aktif yang match.
- Array kosong `[]` (bukan error) kalau NIP valid tapi tidak punya POA di kuartal berjalan, semua dokternya belum final-approved, atau `keyword` tidak match apapun.
- **`approveUntil` (revisi 2026-08-27)**: hanya dokter dengan `PoaDoctorApproval.status` (atau `PoaForm.status` fallback) `APPROVED_BY_NSM` yang muncul di response ini — permintaan eksplisit tim Exodus ("data yg di show perlu yg sudah final approved saja"), lebih ketat dari behavior sebelumnya (yang menampilkan ASM/SM/NSM level manapun). Field ini karena itu selalu bernilai `"NSM"` di endpoint list/detail ini; dipertahankan (bukan dihapus) untuk stabilitas kontrak kalau nanti ada consumer lain yang butuh level lebih longgar.
- **`usedInExodus` (revisi 2026-08-27)**: dokter yang `usedInExodus: true` (sudah ditandai lewat `PATCH /api/poa-doctors/{id}`) TIDAK muncul di response `GET /api/poa-doctors` (list) ini — permintaan eksplisit tim Exodus. Field tetap ada di shape (selalu `false` di sini) untuk konsistensi dengan `GET /api/poa-doctors/{id}` (detail by id), yang TIDAK memfilternya (lihat section detail di bawah — endpoint itu masih bisa mengembalikan baris yang sudah dipakai, supaya `PATCH` tetap idempotent).
- `idPoa` — nomor urut global (`PoaForm.seq`, autoincrement, tidak pernah reset per periode/kuartal), format `"POA" + 4 digit` (`"POA0001"`). Lebih dari 9999 POA otomatis jadi 5 digit dst (`"POA10000"`), bukan hard cap.
- `periode.startDate`/`periode.endDate` — tanggal kalender awal/akhir kuartal (`PoaForm.period`, format `"YYYY-QN"`), bukan tanggal buat/submit POA-nya.
- `pengaliNilaiR` vs `nilaiR` — **DUA field yang berbeda**, jangan disamakan: `pengaliNilaiR` adalah multiplier yang dipakai dalam formula `nilaiPssp` (`estimasi × persenPsspDokter × pengaliNilaiR`, default `1` kalau null); `nilaiR` adalah **angka Rupiah** (bukan rasio/persen) — nilai `r_value` mentah dari API produk Exodus (`api.pharos.id/exodus/core/v1/products`), diambil live saat request (dengan fallback ke rekonstruksi dari data DB kalau API-nya sedang tidak bisa diakses — lihat catatan implementasi). Tidak dipakai dalam formula manapun di response ini, murni data referensi. Keduanya bisa null secara independen. **Catatan implementasi**: `PoaLineItem` punya kolom bernama `nilaiR` sendiri di database, tapi kolom itu tidak pernah diisi oleh kode manapun di aplikasi (selalu `null` di seluruh data production) — field `nilaiR` di response ini TIDAK berasal dari kolom itu. Nilainya diambil live dari `getLiveProductPricing()` (`src/lib/exodusApi.ts`, field `r_value`), fallback ke `Product.nilaiRPersen × Product.hna` (matematis setara, karena `nilaiRPersen` sendiri = `r_value ÷ hna` saat di-sync) kalau live API tidak tersedia.
- `hna` — dari `Product.hna` (harga jual per SJ — **S**atuan **J**ual, bukan ST/Satuan Terkecil), di-join by `kodeProduk`. `null` kalau `kodeProduk` di line item ini tidak match baris `Product` manapun (data produk belum/tidak ada di master).
- `qtyPerBulan`/`qtyTotal` — **satuan SJ, bukan ST** (dikonfirmasi 2026-08-27) — formula `qty = estimasi_bulan ÷ hna`, di mana `estimasi_bulan` = `rencanaTotalBiaya` produk itu dibagi rata ke tiap bulan dalam periode item (`periodeAwal`..`periodeAwal+lamaPeriode-1`), lalu dipotong ke bulan-bulan yang jatuh di kuartal berjalan saja. `0` untuk bulan yang di luar periode item itu sendiri, atau kalau `hna` tidak diketahui (`null`/`0`). Kalau butuh satuan ST (per tablet/pcs individual), perlu dikonversi manual di sisi caller pakai `Product.konversiPembagi` (belum diekspos di response ini) — TIDAK dibangun di v ini, dikonfirmasi cukup SJ.

## Error (list)

| Status | Kondisi |
|---|---|
| 400 | `nip` kosong |
| 401 | Tidak ada session cookie valid maupun Basic Auth valid |
| 404 | NIP tidak ditemukan |

## GET /api/poa-doctors/{id} — detail satu baris

Ambil satu baris dokter langsung by id, tanpa perlu list ulang by NIP — dipakai kalau caller sudah punya `uidCustomer` dari response list di atas (mis. dari cache/state sisi mereka) dan cuma butuh refresh baris itu saja.

```
GET /api/poa-doctors/{uidCustomer}
```

Contoh: `https://form-poa.chc.pharmalink.id/api/poa-doctors/3f7c1e2a-...`

`{uidCustomer}` = field `uidCustomer` dari response list (anchor `PoaLineItem.id`) — id ini sendiri sudah unik secara global, jadi tidak perlu `uidPoa` tambahan untuk resolve barisnya.

Autentikasi: sama persis seperti list (session cookie ATAU Basic Auth, kredensial yang sama).

**Response 200**: satu object (bukan array), shape identik dengan satu elemen di response list.

**Cakupan MIRIP tapi TIDAK IDENTIK dengan list**: kuartal kalender berjalan saja, dan dokter yang belum final-approved (bukan `APPROVED_BY_NSM`) tidak bisa diambil (404) — sama seperti list. **Bedanya**: endpoint detail ini **TIDAK** memfilter berdasarkan `usedInExodus` — baris yang sudah `usedInExodus: true` tetap bisa di-GET/PATCH di sini (sengaja, supaya `PATCH` di bawah tetap idempotent walau dipanggil setelah baris itu hilang dari list).

| Status | Kondisi |
|---|---|
| 401 | Tidak ada session cookie valid maupun Basic Auth valid |
| 404 | `id` tidak match `PoaLineItem` manapun, POA-nya bukan kuartal berjalan, atau dokternya belum final-approved (`APPROVED_BY_NSM`) |

## PATCH /api/poa-doctors/{id} — set "sudah digunakan di Exodus" atau tidak

Dipanggil Exodus untuk mengunci satu baris supaya tidak dipakai dua kali, dan (kalau perlu) membatalkannya lagi. Satu endpoint untuk dua arah, dibedakan lewat body.

```
PATCH /api/poa-doctors/{uidCustomer}
Content-Type: application/json

{ "usedInExodus": false }   // opsional — lihat tabel di bawah
```

| Body | Efek |
|---|---|
| Tanpa body / `{}` / `{ "usedInExodus": true }` | **Mark as used** — `usedInExodus`: `false` → `true`, `usedInExodusAt` di-set ke waktu sekarang. Ini perilaku default (backward-compatible dengan versi sebelum body dikenal). |
| `{ "usedInExodus": false }` | **Revert** — `usedInExodus`: `true` → `false`, `usedInExodusAt` di-set `null`. |

**Idempotent di kedua arah** — set ke nilai yang sudah ada saat ini bukan error, tetap 200 (termasuk memanggil "mark as used" pada baris yang sudah hilang dari `GET /api/poa-doctors` list karena sudah `usedInExodus: true` — lihat catatan di section detail di atas).

⚠️ **Arah revert (`usedInExodus: false`) membalik keputusan bisnis sebelumnya** ("tidak bisa direvert", dikonfirmasi eksplisit oleh Juni Pharos di chat 2026-08-24) — ditambahkan 2026-08-27 atas permintaan Aldi, **belum ada konfirmasi tertulis dari tim Exodus** bahwa mereka memang butuh ini / bahwa jaminan "sekali dipakai terkunci selamanya" sudah tidak berlaku. Lihat `docs/exodus-poa-usage/01-business-rules.md` §8. *(Awalnya dibangun sebagai `DELETE` terpisah, digabung jadi satu `PATCH` di hari yang sama atas preferensi Aldi.)*

**Response 200**: shape sama seperti `GET /api/poa-doctors/{id}`, dengan `usedInExodus` sesuai hasil aksinya.

| Status | Kondisi |
|---|---|
| 401 | Tidak ada session cookie valid maupun Basic Auth valid |
| 404 | Sama seperti GET detail — `id` tidak ditemukan/tidak match kuartal berjalan/dokter belum final-approved |
