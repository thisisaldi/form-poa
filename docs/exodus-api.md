# Form POA — API untuk Exodus

| Environment | Base URL |
|---|---|
| Staging | `https://staging-form-poa.chc.pharmalink.id` |
| Production | `https://form-poa.chc.pharmalink.id` |

## Autentikasi

Semua endpoint di dokumen ini memakai **HTTP Basic Auth** dengan satu kredensial yang sama (username `poa_exodus`; password diberikan terpisah, tidak ditulis di dokumen).

```bash
curl -u 'poa_exodus:<password>' "https://form-poa.chc.pharmalink.id/api/target-value"
```

Kredensial salah atau tidak dikirim → `401 {"error":"Unauthorized"}`.

Semua error berbentuk `{ "error": "<pesan>" }`.

---

## 1. POA Dokter

### `GET /api/poa-doctors`

Daftar dokter POA yang sudah **approved penuh**, sudah di-**Deal** oleh pemilik POA, dan **belum dipakai** di Exodus (`usedInExodus = false`). Satu baris per dokter (per outlet).

```
GET /api/poa-doctors?nip=P250007
GET /api/poa-doctors?nip=P250007&startDate=2026-09-01
GET /api/poa-doctors?keyword=hermina
```

| Param | Wajib | Keterangan |
|---|---|---|
| `nip` | tidak | NIP pemilik POA (MR). Kosong = semua MR. NIP tidak ditemukan → `404`. |
| `startDate` | tidak | `YYYY-MM-DD`. Memilih kuartal yang mengandung tanggal ini, **dan** hanya menampilkan produk yang periode awalnya tepat di bulan itu. Default: kuartal berjalan, semua produk. |
| `keyword` | tidak | Pencarian (tidak case-sensitive) di `idPoa`, nama dokter, nama outlet, kode customer, kode outlet. |

**Response 200** — array (kosong `[]` kalau tidak ada data):

```json
[
  {
    "uidPoa": "bc4be1c8-3062-4985-b3cf-e4aab7eb5f51",
    "uidCustomer": "305d235e-7569-4838-8a95-3984032582fa",
    "idPoa": "POA0135",
    "nip": "L260527",
    "path": "/poa/bc4be1c8-3062-4985-b3cf-e4aab7eb5f51/doctor/305d235e-7569-4838-8a95-3984032582fa/edit",
    "periode": { "startDate": "2026-11-01", "endDate": "2027-04-30" },
    "kuartal": "2026-Q4",
    "approveUntil": "NSM",
    "usedInExodus": false,
    "exodusApprovedBy": null,
    "dokter": {
      "kodeCust": "G3000600",
      "namaCust": "NOER WIDIASTUTI SpA, DR",
      "spesialisasi": "ANAK (PEDIATRIC)",
      "kodePI": "G3000061",
      "namaOutlet": "PANTI RAPIH, RS (ASKES)",
      "outletId": 352,
      "customerId": "C1548"
    },
    "estimasi": 34911000,
    "nilaiPssp": 5021387,
    "estimasiAktif": 0,
    "nilaiPsspAktif": 0,
    "produk": [
      {
        "kodeProduk": "011531",
        "namaProduk": "ARCOLASE 40 MG DRY INJECTION",
        "estimasi": 20295000,
        "nilaiPssp": 3119342,
        "pengaliNilaiR": 1,
        "nilaiR": 25994.5125,
        "hna": 169125,
        "qtyPerBulan": [
          { "bulan": "202611", "qty": 20 },
          { "bulan": "202612", "qty": 20 },
          { "bulan": "202701", "qty": 20 },
          { "bulan": "202702", "qty": 20 },
          { "bulan": "202703", "qty": 20 },
          { "bulan": "202704", "qty": 20 }
        ],
        "qtyTotal": 120,
        "productId": 14,
        "principalId": 7,
        "principalName": "PT. PRIMA MEDIKA LABORATORIES",
        "principalCode": "PML",
        "categoryProduct": "ALL"
      }
    ]
  }
]
```

| Field | Keterangan |
|---|---|
| `uidPoa` / `uidCustomer` | ID POA / ID baris dokter. `uidCustomer` dipakai untuk endpoint detail & PATCH di bawah. |
| `nip` | NIP pemilik POA (MR yang membuat pengajuan). |
| `path` | Path halaman detail dokter di Form POA (gabungkan dengan base URL). |
| `periode` | Rentang bulan kontrak dokter ini (sama untuk semua produknya). |
| `kuartal` | Kuartal POA, mis. `2026-Q4`. |
| `approveUntil` | Level approval tertinggi: `ASM` / `SM` / `NSM` / `ASD` / `SD`. |
| `exodusApprovedBy` | Nilai terakhir yang dikirim Exodus lewat PATCH (`null` kalau belum pernah). |
| `dokter.outletId` | ID outlet Exodus. |
| `dokter.customerId` | Kode customer Exodus (mis. `C1548`). `null` kalau dokter diinput manual (tanpa `kodeCust`) atau belum ter-mapping. |
| `estimasi` / `nilaiPssp` | Rupiah, total rencana untuk seluruh periode (dokter = jumlah semua produk). |
| `estimasiAktif` / `nilaiPsspAktif` | Rupiah dari kontrak PSSP yang **sedang berjalan** untuk dokter ini di kuartal berjalan; `0` kalau tidak ada. |
| `produk[].hna` / `nilaiR` | Harga saat baris POA dibuat (tidak ikut berubah kalau harga master berubah). `qtyTotal × nilaiR × pengaliNilaiR = nilaiPssp`. |
| `produk[].qtyPerBulan` | Satu entri per bulan dalam periode produk (bisa melewati batas kuartal). |
| `produk[].productId` … `categoryProduct` | Dari master produk Exodus; `null` kalau belum tersedia. |

### `GET /api/poa-doctors/{uidCustomer}`

Detail satu dokter, bentuk sama dengan satu elemen list di atas. Hanya untuk kuartal berjalan.

`404 {"error":"Baris tidak ditemukan."}` kalau ID tidak ada, belum approved/Deal, atau dari kuartal lain.

### `PATCH /api/poa-doctors/{uidCustomer}`

Menandai dokter sudah/belum dipakai di Exodus. Setelah `usedInExodus = true`, dokter tidak muncul lagi di list.

```
PATCH https://form-poa.chc.pharmalink.id/api/poa-doctors/305d235e-7569-4838-8a95-3984032582fa
Content-Type: application/json

{ "usedInExodus": true, "exodusApprovedBy": "Budi" }
```

| Body | Keterangan |
|---|---|
| `usedInExodus` | `true` = sudah dipakai, `false` = kembalikan ke belum dipakai. Body kosong = `true`. |
| `exodusApprovedBy` | Opsional, string atau `null`. Tidak dikirim = tidak diubah. |

Aman di-retry (mengirim nilai yang sama tidak error). PATCH tetap bisa untuk dokter dari kuartal sebelumnya.

**Response 200**: objek dokter (seperti di list) dengan nilai `usedInExodus` / `exodusApprovedBy` yang baru. **Error**: `404` ID tidak ditemukan / belum approved/Deal.

---

## 2. Target Value

### `GET /api/target-value`

Target sales Rupiah bulanan **per GT**. Satu baris per GT per bulan.

> ⚠️ Perubahan sejak versi dokumen sebelumnya: parameter `?nip=` **sudah dihapus**, dan response **tidak lagi berisi** `nip`/`nama`/`jabatan`/`nipMR`/`namaMR`. Gunakan `namaGT` atau `kodeGT`.

```
GET /api/target-value?namaGT=ALSUT
GET /api/target-value?kodeGT=1986&periode=202609
GET /api/target-value?divisi=non-hospital&kategori=RETAIL
```

| Param | Wajib | Keterangan |
|---|---|---|
| `divisi` | tidak | `hospital` (default) atau `non-hospital`. |
| `namaGT` | tidak | Filter satu GT. Hospital: toleran beda format penulisan (spasi, tanda baca, prefix "DUMMY"). |
| `kodeGT` | tidak | Filter kode GT (exact). |
| `periode` | tidak | `YYYYMM`, satu bulan. |
| `kategori` | tidak | Non-hospital saja: `RETAIL` atau `GROSIR_PBF`. Kosong = keduanya. |
| `limit` / `offset` | tidak | Pagination. `limit` default 2000, max 5000. Total baris ada di header `X-Total-Count`. |

**Response 200 — hospital** (`?namaGT=ALSUT`):

```json
[
  { "namaGT": "ALSUT", "kodeGT": "1986", "divisi": "hospital", "target": 281190040, "periode": "202608" },
  { "namaGT": "ALSUT", "kodeGT": "1986", "divisi": "hospital", "target": 290190040, "periode": "202609" },
  { "namaGT": "ALSUT", "kodeGT": "1986", "divisi": "hospital", "target": 0, "periode": "202610" },
  { "namaGT": "ALSUT", "kodeGT": "1986", "divisi": "hospital", "target": 0, "periode": "202611" },
  { "namaGT": "ALSUT", "kodeGT": "1986", "divisi": "hospital", "target": 0, "periode": "202612" }
]
```

**Response 200 — non-hospital** (punya field `kategori`):

```json
[
  { "namaGT": "ACEH 01", "kodeGT": "435", "divisi": "non-hospital", "kategori": "RETAIL", "target": 7227640, "periode": "202608" },
  { "namaGT": "ACEH 02", "kodeGT": "274", "divisi": "non-hospital", "kategori": "RETAIL", "target": 168479727, "periode": "202608" }
]
```

Catatan: `kodeGT` hospital bisa `null` untuk sebagian kecil GT. Non-hospital hanya tersedia periode `202608` dan `202609`.

**Error**: `400` `divisi`/`limit`/`offset` tidak valid.

---

## 3. KPI Personil

Endpoint KPI read-only. Parameter tambahan khusus Exodus:

| Param | Keterangan |
|---|---|
| `asNip` | NIP user Exodus yang sedang membuka halaman. Data dibatasi sesuai akses user itu di Form POA (mis. ASM hanya melihat detail bawahannya). Tanpa `asNip` = akses penuh (semua personil). NIP tidak ditemukan → `404`. |

Error tambahan: `400` periode tidak valid, `403` user `asNip` tidak punya akses ke data itu.

Point pilar = skor pilar (0–100) × bobot: Sales 50%, Activity 25%, Customer 15%, Absensi 10%. Total = jumlah point pilar (0–100). Nilai `null` = data belum ada (bukan skor buruk).

### `GET /api/kpi-leaderboard`

Ranking KPI semua personil (point saja). Bisa dilihat semua role.

```
GET /api/kpi-leaderboard?scheme=hospital&period=2026-09
GET /api/kpi-leaderboard?nip=L250101          ← rank satu orang
```

| Param | Wajib | Keterangan |
|---|---|---|
| `scheme` | tidak | `hospital` (default) atau `non-hospital`. |
| `period` | tidak | `YYYY-MM`. Default: bulan terakhir yang sudah selesai. |
| `nip` | tidak | Satu/beberapa NIP dipisah koma. `rank` tetap rank di seluruh personil. |
| `page` / `limit` | tidak | Default 1 / 50, `limit` max 500. |

**Response 200**:

```json
{
  "scheme": "hospital",
  "period": "2026-09",
  "page": 1,
  "limit": 50,
  "total": 309,
  "ranked": 309,
  "unscored": 34,
  "count": 2,
  "rows": [
    {
      "rank": 1,
      "nip": "L260276",
      "name": "LISNA",
      "role": "ASM",
      "area": "PADANG SAMBIAN + DALUNG + NUSA DUA",
      "prevRank": 11,
      "pillars": { "sales": 50, "activity": 25, "customer": 12.75, "absensi": 10 },
      "total": 97.75
    },
    {
      "rank": 2,
      "nip": "L250101",
      "name": "ANNISA SHAFA ANDARI",
      "role": "SPV",
      "area": "DEPOK TIMUR",
      "prevRank": 113,
      "pillars": { "sales": 50, "activity": 21.25, "customer": 15, "absensi": 10 },
      "total": 96.25
    }
  ]
}
```

| Field | Keterangan |
|---|---|
| `total` | Jumlah baris setelah filter `nip` (sebelum pagination). |
| `ranked` | Jumlah personil yang masuk ranking. |
| `unscored` | Jumlah personil yang skornya belum lengkap (tidak di-rank). |
| `prevRank` | Rank bulan sebelumnya (untuk panah naik/turun); `null` = tidak di-rank bulan lalu. Hospital saja. |
| `pillars` | Point per pilar. Non-hospital: `null` (hanya `total`). |

### `GET /api/kpi-personil` — daftar bawahan

Daftar personil yang bisa dievaluasi user `asNip` (ASM/SM/NSM: seluruh bawahannya; tanpa `asNip`: semua). Role lain (mis. MR) → `403`.

```
GET /api/kpi-personil?scheme=hospital&period=2026-09&asNip=L260276
```

| Param | Wajib | Keterangan |
|---|---|---|
| `scheme` | tidak | `hospital` (default) atau `non-hospital`. |
| `period` | tidak | `YYYY-MM`. Default: bulan terakhir yang sudah selesai. |
| `page` / `limit` | tidak | Default 1 / 50, `limit` max 500. |

**Response 200**:

```json
{
  "scheme": "hospital",
  "period": "2026-09",
  "page": 1,
  "limit": 50,
  "total": 343,
  "count": 1,
  "rows": [
    {
      "nip": "L260276",
      "name": "LISNA",
      "role": "ASM",
      "jabatan": null,
      "area": "PADANG SAMBIAN + DALUNG + NUSA DUA",
      "point": 97.75,
      "rec": { "months": 12, "label": "Sangat Baik" },
      "akhirKontrak": null,
      "complete": true,
      "month": {
        "period": "2026-09",
        "total": 97.75,
        "h": {
          "salesTarget": 312981205, "salesActual": 347592954, "salesPct": 111.06, "salesScore": 100,
          "callStandar": 5, "callReal": 5, "callPct": 100, "callScore": 100,
          "callSource": "EXODUS_SYNC", "callInputAt": "2026-10-05T06:54:30.940Z", "callInputBy": null,
          "customer": 12, "customerScore": 85,
          "absensi": 0, "absensiScore": 100, "absensiSource": "SIPP_SYNC"
        },
        "n": null
      },
      "notes": [],
      "decision": null,
      "status": "Belum dievaluasi",
      "fullyApproved": false,
      "act": { "kind": "evaluasi", "step": "SM" }
    }
  ]
}
```

| Field | Keterangan |
|---|---|
| `point` / `rec` | Total point bulan itu dan rekomendasi kontrak (`months` = lama perpanjangan, `0` = tidak diperpanjang). |
| `month.h` | Hospital: nilai mentah + skor (0–100) per pilar. `*Pct` = persen pencapaian. `*Source` = asal data (`EXODUS_SYNC`, `SIPP_SYNC`, `MANUAL`). |
| `month.n` | Non-hospital: `{ target, sales, ach, visit, hariAktif, achKunjungan, sc, telat, notes[] }` (`ach`/`achKunjungan` dalam rasio, mis. `1.05` = 105%). |
| `notes` | Alasan skor belum lengkap, mis. `"Absensi belum terisi"`. |
| `decision` | Keputusan evaluasi kontrak kalau sudah diisi; `null` kalau belum. |
| `status` / `fullyApproved` | Status rantai approval evaluasi. |
| `act` | Tindakan yang bisa dilakukan user `asNip` untuk orang ini; `null` = tidak ada. |

### `GET /api/kpi-personil?nip={nip}` — detail satu personil

Kartu detail KPI 6 bulan terakhir (berakhir di bulan terakhir yang sudah selesai). `404` kalau NIP tidak ada atau di luar akses user `asNip`.

```
GET /api/kpi-personil?scheme=hospital&nip=P250007&asNip=L260276
GET /api/kpi-personil?scheme=hospital&nip=P250007&breakdown=1
```

| Param | Wajib | Keterangan |
|---|---|---|
| `nip` | ya | NIP personil. |
| `scheme` | tidak | `hospital` (default) atau `non-hospital`. |
| `breakdown` | tidak | `1` = sertakan rincian per outlet/MR, PSSP, dan absensi harian (hospital saja, lebih lambat). |

**Response 200**:

```json
{
  "scheme": "hospital",
  "nip": "P250007",
  "name": "TRIDIAN KRISTANTO  LIMBONG",
  "role": "MR",
  "jabatan": "SPV",
  "area": null,
  "akhirKontrak": null,
  "tglMasuk": "2025-01-02",
  "atasanName": "LISNA",
  "window": { "start": "2026-04", "end": "2026-09" },
  "months": [
    {
      "period": "2026-09",
      "total": 80.5,
      "h": {
        "salesTarget": 172716663, "salesActual": 179822468, "salesPct": 104.11, "salesScore": 85,
        "callStandar": 10, "callReal": 8.44, "callPct": 84.4, "callScore": 70,
        "callSource": "EXODUS_SYNC", "callInputAt": "2026-10-05T06:54:30.940Z", "callInputBy": null,
        "customer": 9, "customerScore": 70,
        "absensi": 0, "absensiScore": 100, "absensiSource": "SIPP_SYNC"
      },
      "n": null
    }
  ],
  "avg": { "total": 80.5, "sales": 46.25, "activity": 13.75, "customer": 8.25, "absensi": 10, "complete": 2 },
  "rec": { "months": 9, "label": "Baik" },
  "decision": null,
  "chain": [
    { "step": "ASM", "name": "LISNA", "approvedBy": null },
    { "step": "SM", "name": "I PUTU SUBRATA", "approvedBy": null },
    { "step": "NSM", "name": "PARASIAN", "approvedBy": null }
  ],
  "status": "Belum dievaluasi",
  "fullyApproved": false,
  "act": { "kind": "evaluasi", "step": "SM" },
  "evaluator": "SM",
  "evaluatorName": "LISNA",
  "breakdown": {
    "periods": ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
    "salesKind": "outlet",
    "salesUnits": [
      { "label": "DIAN FARMA, APT (DPS)", "sub": "I1002507", "v": [null, null, null, 3512188, 6882054, 9167203] }
    ],
    "pssp": [
      {
        "kdCust": "F1023696",
        "nmCust": "AGUS SURYAWAN SpS, DR",
        "nmSpc": "SYARAF (NEUROLOGI)",
        "kdOutlet": "I1003642",
        "nmOutlet": "INSTALASI FARMASI RSU SURYA HUSADA NUSA",
        "prdAwal": "202607",
        "prdAkhir": "202612",
        "active": [false, false, false, true, true, true],
        "status": "Aktif · sisa 3 bln"
      }
    ],
    "custUnits": null,
    "absensi": [null, null, null, null, null, null]
  }
}
```

(Array `months` selalu 6 elemen, satu per bulan di `window`; contoh di atas hanya menampilkan bulan terakhir.)

| Field | Keterangan |
|---|---|
| `months[]` | Satu per bulan; isi `h`/`n` sama seperti `month` di daftar bawahan. `total: null` = bulan itu skornya belum lengkap. |
| `avg` | Rata-rata point per pilar selama window; `complete` = jumlah bulan yang skornya lengkap. Non-hospital: hanya `total`. |
| `rec` | Rekomendasi kontrak dari `avg.total`. |
| `chain` | Rantai approval evaluasi: level, nama pemegang saat ini, dan siapa yang sudah approve. |
| `evaluator` | Level yang mengisi evaluasi (`SM`, atau `NSM` kalau SM kosong). |
| `breakdown` | `null` kecuali `breakdown=1`. Array `v` / `active` sejajar dengan `periods`. |
| `breakdown.salesKind` | `outlet` (MR/SPV: sales per outlet + `pssp` per kontrak dokter) atau `mr` (ASM/SM: sales per MR + `custUnits` = customer aktif per MR). |
| `breakdown.absensi[]` | Per bulan: `{ period, days: [{ iso, hari, min, telat, jam }] }`; `null` = data absensi tidak tersedia. |

### `GET /api/kpi-perpanjangan`

Scorecard KPI Perpanjangan (hospital) per personil — angka mentah dan skor tiap pilar. Dengan `asNip`: user itu + bawahannya (role MR/ASM/SM/NSM); role lain `403`.

```
GET /api/kpi-perpanjangan?period=2026-09
GET /api/kpi-perpanjangan?period=2026-09&nip=P250007,L260276
```

| Param | Wajib | Keterangan |
|---|---|---|
| `period` | **ya** | `YYYY-MM`. |
| `nip` | tidak | Satu/beberapa NIP dipisah koma (tetap dibatasi akses). |
| `divisi` | tidak | `hospital` (default) atau `non-hospital` (hanya tanpa `asNip`). |
| `page` / `limit` | tidak | Default 1 / 50, `limit` max 200. |

**Response 200**:

```json
{
  "divisi": "hospital",
  "period": "2026-09",
  "page": 1,
  "limit": 50,
  "total": 351,
  "count": 1,
  "rows": [
    {
      "nip": "L260217",
      "name": "ACAYIDI",
      "role": "ASM",
      "jabatan": null,
      "area": null,
      "salesTargetRp": 0,
      "salesActualRp": 0,
      "salesAchievementPct": null,
      "salesScore": null,
      "callActivityRealisasi": 3.78,
      "callActivityStandar": 5,
      "activityAchievementPct": 75.6,
      "activityScore": 55,
      "callActivitySource": "EXODUS_SYNC",
      "callActivityInputAt": "2026-10-05T06:54:30.940Z",
      "callActivityInputByNip": null,
      "customerAktifCount": 0,
      "customerScore": 40,
      "absensiValue": 0,
      "absensiScore": 100,
      "absensiSource": "SIPP_SYNC",
      "totalScore": null,
      "recommendation": null
    }
  ]
}
```

| Field | Keterangan |
|---|---|
| `sales*` | Target & aktual sales (Rp), persen pencapaian, skor. |
| `callActivity*` / `activity*` | Rata-rata kunjungan per hari vs standar, persen, skor. |
| `customer*` | Jumlah customer aktif (kontrak PSSP aktif) dan skor. |
| `absensi*` | Rata-rata jam keterlambatan dan skor. |
| `totalScore` | Skor total 0–100; `null` kalau ada pilar yang belum ada datanya. |
| `recommendation` | Rekomendasi kontrak (`{ months, label }`); `null` kalau `totalScore` null. |

Urutan baris: skor terendah / belum lengkap dulu.
