# Exodus POA Usage Flag — Business Rules

Sumber: diskusi WhatsApp 2026-08-24 (lihat `README.md` untuk peserta).

## 1. Konklusi chat asli (verbatim, diterjemahkan ke poin)

1. POA butuh API GET dari Exodus untuk dapat batas approval role berdasarkan logic approval Exodus. *(di luar scope dokumen ini — lihat Open questions #1)*
2. `GET /api/poa-doctors` menampilkan list POA yang sesuai batas approval role berdasarkan logic approval Exodus, dan mengekspos status penggunaan Exodus per baris (poin ini awalnya dibaca sebagai "filter", diputuskan ulang jadi "expose field" — lihat §4).
3. POA menyediakan API untuk update flag "telah digunakan di Exodus atau belum". Chat awal menyebut dua endpoint terpisah (submit vs approved), **diputuskan ulang jadi SATU endpoint** — lihat §2 dan Open questions #4.

## 2. Aturan status penggunaan (per dokter, per POA)

Satu field boolean `usedInExodus` (bukan enum tri-state seperti draf awal dokumen ini) — `false` → `true`, sekali saja, tidak pernah kembali.

~~**Append-only / tidak pernah revert**: kalau pengajuan di Exodus di-reject, `usedInExodus` **TETAP** `true`. Dikonfirmasi eksplisit oleh Juni Pharos: *"klo di reject dia tidak ke revert mas, klo sudah diajukan sekali di exodus tidak bsa dipakai lagi"*. Konsekuensi: tidak ada endpoint untuk "un-mark"/revert — ini bukan lupa, memang sengaja.~~

**DIBALIK 2026-08-27**: Aldi mengonfirmasi Exodus tetap butuh cara revert (bertentangan langsung dengan kutipan Juni Pharos di atas — **belum ada konfirmasi ulang tertulis dari tim Exodus untuk pembalikan ini**, cuma keputusan Aldi di sesi kerja ini). `PATCH /api/poa-doctors/{id}` dengan body `{"usedInExodus": false}` sekarang mengembalikan `usedInExodus` ke `false` (dan `usedInExodusAt` ke `null` — full revert, bukan soft-delete/audit trail). Kemampuan ini EXPOSED ke Exodus (bukan internal-only/ADMIN), dikonfirmasi Aldi — awalnya dibangun sebagai endpoint `DELETE` terpisah, digabung jadi satu `PATCH` (dibedakan via body) di hari yang sama atas preferensi Aldi. **Rekomendasi: konfirmasi ulang ke tim Exodus (WA thread yang sama) bahwa keputusan "tidak bisa direvert" dari 2026-08-24 sudah tidak berlaku**, supaya tidak ada kesalahpahaman di kedua sisi soal jaminan "sekali dipakai, terkunci selamanya" yang sempat dijanjikan.

**Idempotent kedua arah**: memanggil `PATCH` (mark as used) pada baris yang sudah `usedInExodus: true`, atau `PATCH` dengan `{"usedInExodus": false}` (revert) pada baris yang sudah `usedInExodus: false`, bukan error — tetap 200.

## 3. Identity per baris

Sama seperti response `GET /api/poa-doctors` (lihat `docs/api-poa-doctors.md`) — `uidCustomer` (anchor `PoaLineItem.id`) sudah cukup untuk resolve baris `PoaDoctorApproval` yang dimaksud (via `kodePI`+`namaCust` → unique key `[poaId, kodePI, namaCust]`), tidak perlu `uidPoa` tambahan karena `PoaLineItem.id` unik secara global.

## 4. Efek ke `GET /api/poa-doctors`

~~**Keputusan 2026-08-26: TIDAK memfilter** — `usedInExodus` diekspos sebagai field biasa, tidak ada baris yang di-exclude.~~ **DIBALIK 2026-08-27**: tim Exodus secara eksplisit meminta filter ini di hasil meeting lanjutan ("data yg di show perlu ... belum digunakan di exodus") — lihat §7 poin 8. `GET /api/poa-doctors` (list) sekarang MEMFILTER `usedInExodus: true` dari hasil. Field `usedInExodus` tetap ada di shape response (selalu `false` di endpoint list ini) untuk konsistensi dengan `GET /api/poa-doctors/{id}` (detail by id), yang **TIDAK** ikut memfilter — supaya `PATCH` tetap bisa idempotent (baris yang sudah dipakai tetap harus bisa di-resolve ulang oleh PATCH, walau sudah hilang dari list).

## 5. Perilaku kegagalan

| Kondisi | Response |
|---|---|
| `id` tidak match `PoaLineItem` manapun | 404 |
| POA-nya bukan kuartal kalender berjalan | 404 (sama seperti tidak ditemukan) |
| Dokter belum pernah diapprove (tidak lolos filter yang sama dengan list) | 404 |
| PATCH (mark as used) pada baris yang sudah `usedInExodus: true` | Idempotent, 200 — bukan error |
| PATCH `{"usedInExodus":false}` (revert) pada baris yang sudah `usedInExodus: false` | Idempotent, 200 — bukan error |
| Auth gagal | 401, pola sama seperti `GET /api/poa-doctors` |

## 6. Open questions — status & assumptions

| # | Pertanyaan | Asumsi kerja saat ini | Siapa yang perlu konfirmasi |
|---|---|---|---|
| 1 | Apa persisnya "batas approval role berdasarkan logic approval Exodus" (poin 1 chat)? Apakah ini kebutuhan terpisah dari `approveUntil` yang sudah ditambahkan ke `GET /api/poa-doctors`, atau sudah terjawab olehnya? | Diasumsikan SUDAH terjawab oleh `approveUntil` (level ASM/SM/NSM terakhir yang approve) sampai ada info sebaliknya — endpoint terpisah TIDAK dibangun di v1 ini. | Tim Exodus (WA thread yang sama) |
| 2 | Endpoint PATCH dipanggil tanpa validasi state sebelumnya (bisa dipanggil kapan saja setelah dokter approved, tidak perlu "submit dulu"). Apakah ini cukup, atau Exodus punya urutan spesifik yang perlu digenapi POA? | Tidak ada validasi urutan — PATCH selalu berhasil (200) selama baris-nya valid & sudah diapprove. | Tim Exodus, kalau ternyata ada urutan yang perlu dijaga |
| 3 | ~~POST atau PATCH?~~ **Settled**: PATCH — partial update pada resource yang sudah ada (`usedInExodus`), method yang lebih tepat dibanding POST untuk aksi ini. | — | — |
| 4 | **(2026-08-26, sudah dijawab secara sepihak oleh tim dev, bukan konfirmasi asli Exodus)** Kenapa chat awal minta 2 endpoint (submit vs approve)? Ditinjau ulang: kutipan bisnis asli Juni Pharos hanya menyebut SATU titik kunci ("sekali diajukan tidak bisa dipakai lagi") — tidak ada bukti konkret POA butuh tahu status "approved" Exodus secara terpisah. Kemungkinan alasan aslinya: (a) meniru pola SUBMITTED_TO_X/APPROVED_BY_X yang dipakai POA secara internal tanpa ada kebutuhan nyata di sisi POA, (b) Exodus ingin write-receipt di tiap checkpoint mereka sendiri (bukan kebutuhan data POA), atau (c) future-proofing untuk laporan yang belum ada. **v1 dibangun dengan SATU endpoint (PATCH, set sekali)** mengikuti YAGNI — kalau Exodus mengonfirmasi mereka benar-benar butuh 2 checkpoint terpisah, field `usedInExodus` perlu diubah dari boolean ke enum (`NOT_USED`/`SUBMITTED`/`APPROVED`) dan endpoint kedua ditambahkan. **Update 2026-08-27**: hasil meeting lanjutan (§7) TIDAK menyebut kebutuhan 2 checkpoint lagi — cuma "PATCH update flag sudah dipakai di Exodus atau belum" (1 endpoint). Memperkuat kesimpulan awal, dianggap CLOSED kecuali muncul lagi. | Satu endpoint cukup — dikonfirmasi tidak dibutuhkan lagi di meeting 2026-08-27 | Selesai |

## 7. Revisi 2026-08-27 — hasil meeting tim Exodus

Pesan tim Exodus (verbatim): *"berdasarkan hasil meeting team exodus ada beberapa penyesuaian di API list POA sesuai kebutuhan di Exodus"*. Endpoint yang dikonfirmasi (pesan Aldi setelahnya): **hanya 2** — `GET /api/poa-doctors` (list, dengan keyword) dan `PATCH /api/poa-doctors/{id}` (flag). `GET /api/poa-doctors/{id}` (detail) TIDAK disentuh permintaan ini, tetap seperti v1.

| # | Poin (verbatim) | Keputusan | Status |
|---|---|---|---|
| 1 | ID POA format `POA0001` | Field baru `idPoa`, dari `PoaForm.seq` (kolom baru, migration `20260827000000_add_poaform_seq`) — **global, tidak pernah reset per periode** (dikonfirmasi user). Existing POA di-backfill dalam urutan `createdAt` (bukan urutan fisik row). `uidPoa` (uuid, dipakai untuk `path`) TETAP ada, tidak diganti. | ✅ Diimplementasikan |
| 2 | `period` sebagai `start_date`/`end_date` | Field baru `periode: { startDate, endDate }` (`quarterDateRange()` di `quarterUtils.ts`), dihitung dari `PoaForm.period` ("YYYY-QN") → tanggal kalender awal/akhir kuartal. | ✅ Diimplementasikan |
| 3 | Keyword search (nama customer, nama outlet, `code_customer`, `outlet_code`, `id_poa`) | Query param `keyword` baru di `GET /api/poa-doctors`. **Dikoreksi 2 kali di hari yang sama (2026-08-27) sebelum settle**: (1) awalnya scoped DALAM `nip` (yang tadinya wajib) supaya tidak kena constraint `docs/PERFORMANCE.md` — user menyadari itu berarti Exodus tidak bisa search by nama kalau belum tahu NIP-nya. Volume data ASLI dicek (bukan diasumsikan): 270 `PoaForm`/6140 `PoaLineItem`/~33 baris NSM-approved per kuartal — jauh di bawah skala insiden `docs/PERFORMANCE.md` #47. `nip` diubah jadi opsional, diukur company-wide: **~2.6 detik** (di bawah target <3 detik). (2) Sempat ditambah guard "minimal satu dari nip/keyword wajib, 400 kalau dua-duanya kosong" — TERNYATA SALAH, user maksudnya dua-duanya boleh kosong (jawaban AskUserQuestion yang salah diimplementasikan tim dev). Guard-nya dihapus — **tanpa `nip` maupun `keyword` sama sekali, response = SEMUA POA di kuartal berjalan** (masih dibatasi kuartal + NSM-approved + belum dipakai, bukan benar-benar unfiltered). Case-insensitive substring match, OR di kelima field, kalau `keyword` diisi. | ✅ Diimplementasikan (dikoreksi 2×) |
| 4 | Nilai R per produk | **Dikoreksi 2 kali dalam hari yang sama (2026-08-27) sebelum settle**: (1) awalnya diambil dari `PoaLineItem.nilaiR` — ternyata kolom itu MATI, tidak pernah ditulis kode manapun (0 dari 7090 baris non-null di production). (2) Diganti ke `Product.nilaiRPersen` (persentase) — user menegaskan ulang ("kok masih persen") yang dimaksud adalah **angka Rupiah, bukan rasio**. Ditelusuri ke `src/lib/exodusApi.ts:136` (`getLiveProductPricing`, sudah ada sejak sebelum fitur ini): live Exodus core products API mengembalikan `r_value` (Rupiah mentah) per produk, tapi kode yang ada cuma mengonversinya jadi rasio (`nilaiRPersen = r_value / sell_price`) dan raw value-nya dibuang. **Final**: `nilaiR` = `r_value` live dari `getLiveProductPricing()`, fallback rekonstruksi `nilaiRPersen(db) × hna(db)` kalau API live tidak tersedia (matematis setara, karena `nilaiRPersen` memang `r_value ÷ hna` saat sync — lihat `02-data-model.md`). `pengaliNilaiR` (multiplier formula, dari v1) TETAP terpisah, jangan disamakan. | ✅ Diimplementasikan (dikoreksi 2×) |
| 5 | HNA (sell price) per produk | Field baru `hna`, dari `Product.hna` (master data, join by `kodeProduk`, "HNA per SJ") — BUKAN `PoaLineItem.hargaSatuanTerkecil` (field beda, formula placeholder yang sering null). Sama sumbernya dengan `nilaiR` di atas — satu query `Product` untuk keduanya (`getProductMasterByKodeProduk`). | ✅ Diimplementasikan |
| 6 | Qty produk per bulan | Field baru `qtyPerBulan` (array `{bulan, qty}` per bulan di kuartal berjalan) per produk. Formula dikonfirmasi user 2026-08-27: **`qty = estimasi_bulan ÷ HNA`** — `estimasi_bulan` = `rencanaTotalBiaya` item dibagi rata ke tiap bulan periodenya sendiri (`periodeAwal`..`periodeAwal+lamaPeriode-1`), dipotong ke bulan yang jatuh di kuartal berjalan. **Satuan: SJ (Satuan Jual), dikonfirmasi user** — karena `HNA` adalah harga per SJ, bukan per ST (Satuan Terkecil). Konversi ke ST (pakai `Product.konversiPembagi`) TIDAK dibangun, dikonfirmasi tidak perlu. | ✅ Diimplementasikan |
| 7 | Total qty per produk (per periode) | Field baru `qtyTotal` per produk = jumlah seluruh `qtyPerBulan` untuk kuartal berjalan (bukan seluruh periode item sendiri kalau lebih panjang dari 1 kuartal — "periode" di sini diartikan sama dengan scope endpoint, yaitu kuartal berjalan). Satuan sama seperti `qtyPerBulan` (SJ). | ✅ Diimplementasikan |
| 8 | "Data yg di show perlu yg sudah final approved saja dan belum digunakan di exodus" | DUA perubahan filter, dikonfirmasi terpisah oleh user: (a) **"final approved"** = HANYA `APPROVED_BY_NSM` — filter `approveUntil` di `buildDoctorRows` diperketat dari "ASM/SM/NSM manapun" (v1) jadi "harus NSM". Berlaku di `GET /api/poa-doctors` (list) DAN `GET/PATCH /api/poa-doctors/{id}` (shared lewat `buildDoctorRows`). (b) **"belum digunakan"** = filter `usedInExodus` — lihat §4 di atas (dibalik dari keputusan v1). Filter ini HANYA di route list (`route.ts`), bukan di `buildDoctorRows`, supaya PATCH tetap bisa resolve baris yang sudah dipakai (idempotent). | ✅ Diimplementasikan |

Open question yang masih belum kejawab dari meeting ini: poin 1 di §6 (endpoint GET dari Exodus untuk "batas approval role") tidak disinggung lagi di meeting ini — kemungkinan sudah tidak relevan (tergantikan oleh filter "final approved" di poin 8), tapi belum ada konfirmasi eksplisit.

## 8. Revisi 2026-08-27 (lanjutan, hari yang sama) — kemampuan revert ditambahkan

Aldi meminta kemampuan revert `usedInExodus` kembali ke `false`, exposed ke Exodus. Ini **membalik langsung** aturan §2 di atas ("tidak pernah revert", dikonfirmasi eksplisit Juni Pharos 2026-08-24). **Belum ada konfirmasi tertulis dari tim Exodus untuk pembalikan ini** — perlu ditindaklanjuti di WA thread yang sama sebelum Exodus benar-benar mengandalkan (atau justru menghindari) kemampuan revert ini, supaya tidak ada asumsi yang salah di salah satu sisi.

**Endpoint shape (2 iterasi di hari yang sama)**: awalnya dibangun sebagai `DELETE /api/poa-doctors/{id}` terpisah dari `PATCH`. Aldi lalu meminta digabung — satu `PATCH` untuk kedua arah, dibedakan lewat body opsional (`{"usedInExodus": false}` untuk revert, default `true` kalau body kosong/tidak ada — backward-compatible dengan kontrak bodyless PATCH sebelumnya). Lihat `03-ui-and-access.md` untuk tabel endpoint final.

## 9. Revisi 2026-09-01 (DRAFT — belum diimplementasikan) — tracking nomor pengajuan + status pengajuan/approved

**Sumber**: chat WhatsApp 2026-09-01, Juni Pharos mengoreksi pemahaman Aldi soal cakupan `usedInExodus`:

> [09:20] Aldi: kalau untuk sekedar update flag usedInExodus, pakai satu endpoint pak jun
> [09:21] Juni Pharos: sepaham gw bukan cuma untuk tau flag udah di used, tapi mau di track pengajuan di exodus nya itu nomor berapa dan ini masih pengajuan apa sudah approved

Ini **membuka ulang** Open Question #4 di §6 (yang sempat ditandai "Selesai" — dianggap CLOSED setelah meeting 2026-08-27 tidak menyebut kebutuhan 2 checkpoint lagi). Juni Pharos sekarang mengonfirmasi eksplisit yang sebelumnya cuma dugaan (b) di §6 poin 4 lama: Exodus memang butuh **dua hal baru**, bukan sekadar checkpoint status:

1. **Nomor pengajuan Exodus** — nomor referensi transaksi/pengajuan DI SISI EXODUS (bukan `idPoa`/`uidPoa` milik POA), supaya satu baris dokter bisa ditelusuri balik ke pengajuan mana persisnya di sistem Exodus.
2. **Status pengajuan itu di Exodus** — minimal dua state: "masih pengajuan" vs "sudah approved". Ini PERSIS skenario yang di §6 poin 4 lama disebut "kalau nanti Exodus konfirmasi butuh 2 checkpoint terpisah, field perlu diubah jadi enum" — sekarang terkonfirmasi.

**Belum settled — hanya niat/kebutuhan yang dikonfirmasi, kontrak teknisnya belum dibahas dengan Juni Pharos.** Section ini mencatat asumsi kerja awal untuk didiskusikan, BUKAN keputusan final.

### Asumsi kerja diusulkan (perlu dikonfirmasi Juni Pharos sebelum implementasi)

| Aspek | Asumsi kerja |
|---|---|
| Status enum | Dua nilai sesuai kutipan literal Juni Pharos: `PENGAJUAN` (sudah disubmit ke Exodus, belum final) dan `APPROVED` (sudah final approved di Exodus). Tidak ada nilai ketiga (`REJECTED`/dst.) karena tidak disebut di chat — kalau ternyata dibutuhkan, ini bertambah lagi. |
| Relasi ke `usedInExodus` (boolean, existing) | Diusulkan **TIDAK dihapus** (masih dipakai filter di `GET /api/poa-doctors` list, §4) — jadi derived/tetap `true` begitu `exodusStatus` terisi (`PENGAJUAN` ATAU `APPROVED`), supaya konsumen existing yang cuma baca boolean tidak break. Field baru murni tambahan detail, bukan pengganti. |
| Nomor pengajuan | Field baru `exodusNomorPengajuan` (string bebas format — Exodus yang generate nomornya, POA cuma menyimpan apa adanya, tidak divalidasi format tertentu). |
| Siapa yang mengisi | Diasumsikan Exodus sendiri yang PATCH nomor+status (server-to-server, sama seperti PATCH `usedInExodus` sekarang) — bukan POA yang menarik data dari Exodus. |
| Transisi status | `PENGAJUAN → APPROVED` via PATCH lagi ke baris yang sama, nomor pengajuan yang sama dipakai ulang (tidak berubah antar status) kecuali dinyatakan lain. |
| Kontrak PATCH baru | **BLOCKING — belum diusulkan bentuknya ke Exodus.** Draf paling sederhana: `PATCH /api/poa-doctors/{id}` body `{"exodusStatus": "PENGAJUAN" | "APPROVED", "exodusNomorPengajuan": "..."}`, MENGGANTIKAN body lama (`{"usedInExodus": true/false}`) untuk arah "mark as used" — tapi ini BREAKING CHANGE ke kontrak yang sudah live sejak 2026-08-26 dan mungkin sudah dipakai Exodus di production. Alternatif: field baru OPSIONAL di body yang sama (`usedInExodus` tetap jadi trigger utama, `exodusStatus`/`exodusNomorPengajuan` ikut kalau dikirim) — lebih aman tapi Exodus harus tau field baru ini ada. |
| Revert (`{"usedInExodus": false}`) | Belum jelas apakah revert juga harus mengosongkan `exodusStatus`/`exodusNomorPengajuan`, atau nomor pengajuan tetap disimpan sebagai histori terakhir meski status di-revert. |

### Klarifikasi 2026-09-01 (lanjutan, hari yang sama) — use case-nya milik POA, bukan Exodus

> [09:29] Aldi: intinya exodus bisa update pake endpoint, untuk update field nomor pengajuan atau update status di sisi exodus nya bukan pak? jujur saya bingung ini use case nya untuk apa
> [09:31] Juni Pharos: keperluannya bukan di exodus, use casenya keperluan di POA — itu kenapa Exodus perlu infoin ke POA. jadi tergantung di POA mau nunjukin layarnya mau seperti apa. klo gaada keperluan bisa cukup pada saat submit

Ini membalikkan kerangka pertanyaannya: bukan "apa yang Exodus butuh dari POA", tapi **"apa yang POA mau tunjukkan ke user-nya sendiri"** — Exodus cuma jadi sumber data, keputusan desainnya ada di sisi POA.

**Dikonfirmasi Aldi (2026-09-01)**: YA ada rencana ditampilkan di UI POA, lokasinya di **halaman detail POA (`/poa/[id]`)**, per baris dokter — reuse pola `DraftChecklist`'s `DoctorRow` yang sudah join ke `PoaDoctorApproval` lewat `doctorApprovalByKey` (`src/app/(app)/poa/[id]/page.tsx:102-103`), sama seperti `StatusBadge`/`Version X` chip yang sudah ada per baris dokter di situ sekarang. Ini MENGKONFIRMASI kebutuhan status tracking (bukan cuma nomor pengajuan sekali di submit) — kalau POA mau nunjukkan badge "Pengajuan"/"Approved" di layar, field status-nya memang perlu ada dan ke-update seiring waktu, bukan cukup ditulis sekali.

### Keputusan: PATCH bersifat partial — 3 field independen

Dikonfirmasi Aldi (2026-09-01): PATCH **tidak** mewajibkan `usedInExodus`+`exodusStatus`+`exodusNomorPengajuan` dikirim bersamaan. Semantik PATCH standar — Exodus boleh kirim cuma satu field yang berubah (mis. `{"exodusStatus": "APPROVED"}` saja untuk transisi status, tanpa perlu resend nomor pengajuan yang sudah dikirim sebelumnya). Konsekuensinya:
- `usedInExodus` TETAP ada sebagai field terpisah (bukan digantikan) — ini juga menjawab Open Question lama soal "replace vs alongside": **alongside**, karena kalau salah satu field ini opsional untuk dikirim, otomatis tidak ada yang "menggantikan" yang lain.
- Server-side: tiap field di body yang hadir di-update, field yang tidak dikirim TIDAK disentuh (tidak di-null-kan/reset). Sama pola dengan `usedInExodus` sekarang yang juga optional-body-defaults-true (lihat kontrak lama di `03-ui-and-access.md`), diperluas ke 2 field baru.
- `exodusNomorPengajuan` kemungkinan dikirim SEKALI di awal (saat submit/PENGAJUAN), lalu PATCH selanjutnya cuma kirim `exodusStatus` untuk transisi ke `APPROVED` — nomor lama tetap tersimpan karena tidak di-touch.

## 11. Revisi 2026-09-09 (lanjutan, sesi yang sama) — PIVOT: POA jadi CLIENT dari Exodus (bukan §9/§10 lagi)

**Sumber**: Aldi menemukan chat WhatsApp asli dengan tim Exodus (Budi Pharos, cc Zahra Nabila/Juni Pharos) yang ternyata sudah menjawab Open Question #1 di §6 (yang sebelumnya diasumsikan closed oleh `approveUntil`). Ini MEMBATALKAN pendekatan §9 (`exodusStatus`/`exodusNomorPengajuan`, draft) dan §10 (`exodusApprovedBy` PATCH, sudah v1 diimplementasikan tapi sekarang superseded) — bukan Exodus yang PATCH balik ke POA, tapi **POA yang jadi client**, memanggil GET Exodus untuk menentukan level approval yang dibutuhkan, sebelum menampilkan baris itu di `GET /api/poa-doctors`.

### Endpoint Exodus (baru, di luar kontrak yang POA sediakan — ini POA MEMANGGIL Exodus, pola sama seperti `src/lib/exodusApi.ts` yang sudah ada)

```
GET /promotion/v1/pssp/approval-level
```

| Environment | Base URL |
|---|---|
| Staging | `https://api.stg-pharos.my.id/exodus/promotion/v1/pssp/approval-level` |
| Production | `https://exodus.pharos.id/exodus/promotion/v1/pssp/approval-level` |

| Query param | Wajib | Keterangan |
|---|---|---|
| `start_period` | ya | Belum dikonfirmasi field POA mana yang jadi sumbernya — kandidat: `PoaLineItem.periodeAwal`. |
| `end_period` | ya | Kandidat: turunan dari `periodeAwal + lamaPeriode`. |
| `r_percentage` | ya | Kandidat: `PoaLineItem.persenPsspDokter`. |
| `given_value` | ya | Kandidat: `rencanaTotalBiaya` atau `nilaiPssp` hasil hitung — belum jelas mana. |
| `nip` | tidak | NIP MR pemilik POA (`PoaForm.ownerId`)? Belum dikonfirmasi. |
| `pssp_type` | ya | Kandidat: `PoaLineItem.jenisPssp`. |
| `customer_code` | ya | Kandidat: `PoaLineItem.kodeCust`. |
| `outlet_code` | ya | Kandidat: `PoaLineItem.kodePI`. |

**Response 200**:
```jsonc
{
  "data": { "role": "sm" },   // role FINAL yang harus dipenuhi — TIDAK selalu "nsm"
  "error": { "status": false, "msg": "", "code": 0 }
}
```

### Kutipan chat asli (verbatim, 2026-09-09) — kenapa ini genuinely mengubah §4/§7 poin 8

> [12:53] Aldi: sebentar mas, response get di /api/poa-doctors itu kan yang sudah approved sampai NSM. kalau gitu yang masuk di exodus dari poa itu yang sudah fully approved nsm dong ya?
> [12:54] Budi Pharos: yang ini bukan mas? GET /promotion/v1/pssp/approval-level — Yg sudah fully approved sesuai response role di API ini mas
> [13:02] Aldi: untuk approval draft sampai approved by NSM masih tetep diproses di poa mas? karena kan di exodus yang belum approved NSM masih belum ada
> [13:05/13:06] Budi Pharos: Approval di POA tidak terbatas di NSM bahkan bisa jadi sampai ASD atau SD, benar di exodus tidak ditampilkan jika belum memenuhi syarat dari final role approvalnya. Jadi di response ini tidak terbatas sampai NSM, bisa jadi ASM, SM, ASD, SD yg menjadi final approvalnya. Jadi POA harus memenuhi approval yg dari response tsb baru tampilkan di list API POA yg utk exodus.

**Artinya**: `role` bukan info tambahan (bukan "siapa yang approve"), tapi **CEILING approval yang wajib dipenuhi** per baris dokter/PSSP — bisa `asm`/`sm`/`nsm`, TIDAK selalu `nsm`. Filter `GET /api/poa-doctors` (§4, §7 poin 8: "hanya `APPROVED_BY_NSM`") jadi **salah** dalam kasus umum — seharusnya "sudah approved sampai level yang di-return `approval-level`", bukan hardcoded NSM.

**Klarifikasi lanjutan Aldi (sesi yang sama, 2026-09-09)**: dikonfirmasi definisi "fully approved" = `role` dari Exodus adalah THRESHOLD, bukan required-exact-match. Kalau `approval-level` balikin `"asm"`, dan `PoaDoctorApproval.status` baris itu SUDAH `APPROVED_BY_ASM` (atau level lebih tinggi apapun di chain-nya — SM/NSM), baris itu dianggap fully approved untuk Exodus, TIDAK perlu menunggu approval lanjut ke SM/NSM. Ini persis konsep yang sudah dihitung `approveUntil()` di `poaDoctorsRows.ts` (highest role yang sudah approve baris itu) — `asm`/`sm`/`nsm` dari Exodus punya padanan LANGSUNG ke `Role` POA yang sudah ada (`ASM`/`SM`/`NSM`), tidak perlu role baru untuk KETIGA nilai ini. **`asd`/`sd` tetap tidak punya padanan** — kalau Exodus mengembalikan salah satu dari itu untuk suatu baris, baris itu (dengan pemahaman role POA saat ini) TIDAK PERNAH bisa fully approved, karena chain POA mentok di NSM. Pertanyaan #1/#2 di bawah (soal ASD/SD) masih tetap blocking, TIDAK berubah oleh klarifikasi ini.

### 🔴 BLOCKING — gap struktural ditemukan, BUKAN sekadar detail teknis

**Role POA (`enum Role` di `prisma/schema.prisma`) hanya: `MR, ASM, SM, NSM, GM, ADMIN, SFE, VIEWER`.** Tidak ada `ASD`/`SD`. **Dikonfirmasi Aldi (2026-09-09): role ASD/SD memang belum ada di POA sama sekali** — bukan cuma penamaan beda, betul-betul tidak ada level org/approval setingkat itu di alur `poaWorkflow.ts` (`MR → ASM → SM → NSM`, hardcoded, lihat `CHAIN_STATUS`/`SUBMIT_TRANSITIONS`/`APPROVE_TRANSITIONS`).

Konsekuensi: kalau Exodus mengembalikan `role: "asd"` atau `role: "sd"` untuk suatu baris, POA **tidak punya cara approve sampai level itu** — chain approval POA mentok di NSM. Baris seperti itu tidak akan PERNAH bisa memenuhi syarat tampil ke Exodus dengan alur approval yang ada sekarang.

**Open questions BLOCKING — wajib dikonfirmasi tim Exodus sebelum implementasi APAPUN dimulai:**

| # | Pertanyaan | Kenapa blocking |
|---|---|---|
| 1 | Apa itu ASD/SD? Role di ORG PHAROS (bukan role approval POA) yang perlu dipetakan ke role POA existing (mis. ASD≈ASM, SD≈SM/NSM)? Atau benar-benar level approval baru yang POA perlu bangun (role baru + langkah chain baru)? | Menentukan apakah ini migration Role enum + `poaWorkflow.ts` (besar) atau cuma mapping string (kecil). |
| 2 | Kalau memang level approval baru: siapa user-nya di POA (ada `User` dengan jabatan ASD/SD di data existing, atau perlu role baru yang belum pernah dipetakan ke siapapun)? | Tanpa user nyata di role itu, approval baris itu TIDAK PERNAH bisa selesai — deadlock. |
| 3 | Mapping tiap query param (`start_period`/`end_period`/`r_percentage`/`given_value`/`nip`/`pssp_type`/`customer_code`/`outlet_code`) ke field POA mana persis — kandidat di tabel atas belum dikonfirmasi Exodus. | Salah mapping = salah role yang diminta = approval requirement salah untuk baris itu. |
| 4 | Kapan API ini dipanggil — sekali saat submit pertama (role disimpan, tidak berubah lagi sepanjang siklus dokter itu) atau live tiap kali dicek (GET /api/poa-doctors, atau tiap approve/reject)? Kalau live, per-baris-per-request ke Exodus berisiko kena constraint `docs/PERFORMANCE.md` (company-wide, tanpa `nip`, sampai ~33-270 baris/kuartal — call-in-loop ke API eksternal per baris berpotensi lambat). | Menentukan field baru (snapshot di `PoaDoctorApproval`) vs live-fetch, dan apakah perlu caching/batching. |
| 5 | Kalau role dari Exodus berubah SETELAH baris sudah mulai diproses (mis. submit awal butuh SM, tapi given_value di-edit lebih besar sehingga sekarang butuh NSM) — approval yang sudah jalan di-restart, atau ceiling-nya di-lock di titik submit awal? | Menentukan apakah field ini snapshot-once atau re-checked tiap transisi. |

**Rekomendasi**: JANGAN mulai coding (migration Role, perubahan `poaWorkflow.ts`, filter `poaDoctorsRows.ts`) sebelum pertanyaan #1 dan #2 dijawab tim Exodus — keduanya menentukan besar-kecilnya pekerjaan secara fundamental (mapping string vs bangun level approval + user baru). §9 dan §10 (di atas) dianggap **superseded**, bukan dihapus dari histori dokumen ini.

**Status implementasi: belum dimulai sama sekali. BLOCKING pada klarifikasi tim Exodus.**

### Update 2026-09-09 (sesi yang sama) — hasil investigasi nyata: ASD/SD BUKAN edge case langka

Sebelum membangun apapun, dites langsung ke API real (`scripts/testExodusApprovalLevel.ts`, staging/production credential dari `.env.local`) — sample 40 `PoaLineItem` company-wide terbaru, dipanggil satu-satu ke `GET /promotion/v1/pssp/approval-level`.

**Temuan penting**:
1. **Role string ASLI bukan singkatan "asd"/"sd"** (istilah informal Budi Pharos di chat) — nilai sebenarnya di response API: `"asm"`, `"sm"`, `"nsm"`, `"assistant-sales-director"`, `"sales-director"` (full slug, kebab-case).
2. **`assistant-sales-director`/`sales-director` MUNCUL SERING, bukan langka** — dari 40 baris sample: 14 baris (35%) balik salah satu dari dua role itu. Distribusi lengkap yang teramati: `nsm` (11), `assistant-sales-director` (8), `sm` (8), `sales-director` (6), `asm` (5). Dua role tersebut BUKAN rare edge case yang bisa diabaikan — kalau POA jalan dengan asumsi "approval maksimal NSM", ~35% baris PSSP di sample ini TIDAK AKAN PERNAH fully-approved dan tidak akan pernah muncul ke Exodus.
3. **Format `start_period`/`end_period` (menjawab pertanyaan #3 di tabel di atas, sebagian)**: `YYYY-MM-DD`, BUKAN `YYYYMM` — dikonfirmasi lewat percobaan langsung (500 error eksplisit: `"invalid start_period, expected YYYY-MM-DD"` saat dikirim `YYYYMM`). `end_period` dipakai hari terakhir bulan tersebut di script test (belum dikonfirmasi apakah harus tepat begitu atau boleh tanggal apapun dalam bulan itu).
4. **`pssp_type` masih UNCONFIRMED** — `PoaLineItem.jenisPssp` **selalu `null`** di seluruh data production (0 dari 9786 baris terisi, kolom mati — sama seperti `nilaiR` yang sudah diketahui mati di `02-data-model.md`). Script test pakai placeholder `"reguler"` (string tebakan, DITERIMA API tanpa error) semata supaya bisa dapat response — BUKAN mapping yang benar/final, `pssp_type` real perlu sumber lain (field POA yang belum ada, atau tim Exodus perlu clarify apakah param ini sebenarnya opsional/boleh generic).

**Kesimpulan**: pertanyaan #1 di atas ("apa itu ASD/SD?") terjawab SEBAGIAN — sekarang tau nama role persisnya (`assistant-sales-director`/`sales-director`) dan tau ini BUKAN kasus langka (naikkan urgensi, bukan turunkan). Pertanyaan #2 (siapa user-nya di POA) **masih TOTAL belum terjawab** — dan sekarang jauh lebih mendesak karena ~35% data akan stuck kalau tidak diselesaikan. Rekomendasi tidak berubah: JANGAN mulai migration Role/poaWorkflow.ts sampai ada user nyata yang akan memegang kedua role ini dikonfirmasi (single nasional vs per-region — pertanyaan yang sempat diajukan Aldi juga masih belum dijawab, di-skip sementara untuk fokus ke investigasi ini duluan).

### Update 2026-09-09 (lanjutan, sesi yang sama) — pertanyaan #1/#2 terjawab, infrastruktur diimplementasikan

Aldi mengonfirmasi: **ASD = role `GM` yang sudah ada di POA** (di tabel MSSQL `Struktur_Marketing_PI`, kolom `GM_NIP`/`GM_Nama` di baris yang sama dengan `NSM_NIP` — dipakai `scripts/matchStrukturBaruFromMssql.ts`, sudah ada, tinggal belum di-sync ke `User.nipAtasan`). **SD = satu orang spesifik, Brian Lembong** (`P200134`, sebelumnya role `GM`, dipindah ke role baru `SD`) — tidak ada kolom SD di `Struktur_Marketing_PI` (SD murni tambahan POA, di luar struktur MSSQL, satu-satunya orang di level ini).

**Klarifikasi istilah** (penting, jangan disamakan): Role Prisma `GM` TIDAK diganti nama — tetap dipakai untuk read-only oversight di fitur lain juga (Summary/Dashboard company-wide). Status/label approval chain yang baru pakai istilah `ASD` (`SUBMITTED_TO_ASD`/`APPROVED_BY_ASD`) meski user yang approve di level itu `role`-nya tetap `GM` di database — cuma penamaan status/chain yang pakai "ASD", bukan role usernya.

**Klarifikasi desain krusial**: eskalasi ke ASD/SD **KONDISIONAL per dokter** (dari `exodusRequiredRole`, snapshot sekali di submit pertama — lihat §9), BUKAN tambahan wajib ke chain semua POA. Kalau linear unconditional (semua POA otomatis lewat ASD/SD setelah NSM), itu meregresi ~65% POA yang gak butuh eskalasi. `null`/`"asm"`/`"sm"`/`"nsm"` (termasuk SEMUA data lama, field ini baru) tetap terminate di `APPROVED_BY_NSM` persis seperti sebelumnya — cuma `"assistant-sales-director"`/`"sales-director"` yang mendorong lanjut ke ASD/SD.

**🟢 Infrastruktur diimplementasikan 2026-09-09** (schema + workflow chain + authz, BELUM termasuk live call ke Exodus — masih diblokir `pssp_type`, lihat §11 investigasi di atas):
- `Role.SD` (baru, migration `20260909130000_add_asd_sd_approval_level` — **belum di-apply ke DB**), data migration `UPDATE "User" SET role='SD' WHERE nip='P200134'` sudah ditulis di migration yang sama.
- `PoaStatus`: `SUBMITTED_TO_ASD`/`APPROVED_BY_ASD`/`SUBMITTED_TO_SD`/`APPROVED_BY_SD`.
- `PoaDoctorApproval.exodusRequiredRole` (`String?`, snapshot sekali di submit pertama, BELUM di-wire ke `submitDoctor()` — field ini ada tapi selalu `null` sampai wiring live call selesai, jadi chain 100% backward compatible untuk semua data sekarang).
- `poaWorkflow.ts`: chain diperluas jadi kondisional — `approveNsmOrAsd()` (baru, exported buat self-check) menentukan lanjut atau terminate di titik NSM dan ASD berdasarkan `approvalCeiling(exodusRequiredRole)`. `resolveNextHolder`/`loadPoaWithHierarchy` diperluas jalur `reportsTo` dari 3 ke 5 level (MR→ASM→SM→NSM→GM→SD) supaya bisa nemuin approver ASD/SD.
- `authz.ts`: `canApproveDoctor` nerima role `GM`/`SD` juga.
- `StatusBadge.tsx`/`notifications.ts`/dashboard chart: label buat status baru.
- Self-check: `scripts/testApprovalCeilingChain.ts` (assert-based, verifikasi invariant backward-compat + eskalasi ASD/SD).

### Update 2026-09-09 (lanjutan) — investigasi `pssp_type`, MASIH tidak match bersih

Dites langsung `GET /promotion/v1/pssp` (list PSSP asli Exodus, endpoint terpisah dari `approval-level`) buat lihat isi field `pssp_type` yang sebenarnya, karena `PoaLineItem.jenisPssp` (kandidat awal) terkonfirmasi kolom mati.

**Ditemukan 3 distinct value** (scan 4000 record production, kemungkinan besar sudah lengkap): `Cash` (3596, 89.9%), `Event` (267, 6.7%), `Peremajaan` (137, 3.4%).

**Divalidasi silang**: satu record real dengan `request_status: "on-approval-by-sm"` di-tes ke `approval-level` pakai field-fieldnya sendiri (termasuk `pssp_type: "Event"` apa adanya) — hasilnya `role: "sm"`, KONSISTEN dengan `request_status` record itu sendiri. Jadi value asli (`Event`/`Cash`/`Peremajaan`) memang valid dikirim ke `approval-level`, BUKAN ditolak seperti placeholder `"reguler"` sebelumnya (yang diterima API tapi tidak divalidasi kebenarannya).

**Masalahnya**: POA sendiri TIDAK punya field yang capture distingsi ini secara langsung:
- `PoaLineItem.bentukPssp` (`CASH`/`BARANG`/`JASA`/`PRIMATAX`, TERISI 95% di 9786 baris — beda dari `jenisPssp` yang mati) — `CASH` cocok 1:1 ke `pssp_type: "Cash"` Exodus. TAPI `BARANG`/`JASA`/`PRIMATAX` (POA) TIDAK ADA padanannya di 3 value Exodus, dan `Event`/`Peremajaan` (Exodus) TIDAK ADA padanannya di `bentukPssp` (POA).
- `PoaLineItem.jenisPsSp` (`PS`/`SP`, juga terisi 95%+) — ini malah cocok ke field Exodus YANG BEDA, `pssp_category` (bukan `pssp_type`) — dikonfirmasi dari sample record yang sama (`pssp_category: "SP"`).

**Kesimpulan**: mapping `pssp_type` MASIH blocking — tidak ada 1:1 yang bersih dari data POA yang sudah ada. Opsi yang mungkin (belum diputuskan): (a) kirim `bentukPssp` apa adanya untuk baris `CASH` saja dan default/tebak untuk `BARANG`/`JASA`/`PRIMATAX` (resiko salah untuk ~10% baris), (b) tambah field baru di POA yang capture distingsi Event/Cash/Peremajaan secara eksplisit (perubahan data model, butuh keputusan bisnis: kapan MR mengisinya, apa artinya "Event" di konteks POA), atau (c) tanya balik ke tim Exodus apakah `pssp_type` sebenarnya boleh diabaikan/dibuat opsional untuk use case ini. **Belum ada keputusan** — dicatat sebagai open question, bukan diimplementasikan sepihak.

**Update 2026-09-09 (lanjutan)**: Aldi menilai `pssp_type` **tidak terlalu penting** dibanding param lain — deprioritized, bukan blocking lagi. `r_percentage` dikonfirmasi **fraksi 0-1** (10% = `0.1`) — persis format `PoaLineItem.persenPsspDokter` yang sudah tersimpan di DB (form UI-nya nampilin 0-100, dibagi 100 sebelum disimpan — lihat `LineItemEditor.tsx`), jadi TIDAK perlu konversi tambahan. `getExodusApprovalLevel()` di `exodusApi.ts` sudah diupdate komentarnya.

### 🔴 Temuan baru, BELUM terjawab — chain approval Exodus TIDAK selalu linear ASM→SM→NSM→ASD→SD

Query `GET /promotion/v1/pssp?pssp_type=Peremajaan` (endpoint list PSSP asli, terpisah dari `approval-level`) menunjukkan `pssp_activity_log` satu record (`ref_id_header: "AP400728"`) sbb:

```
on-approval-by-sm → on-approval-by-nsm → on-approval-by-sd → on-approval-by-fic
                                          ^^^^^^^^^^^^^^^^^^ note: "Auto Approve by SD - Nilai PSSP <= 10 Juta"
                                          actor: user_nip P200134, user_name BRIAN LEMBONG, user_role "sales-director"
```

Dua hal yang mengubah pemahaman sebelumnya:

1. **Record ini LONCAT dari NSM langsung ke SD, TIDAK lewat ASD sama sekali.** Kontradiksi dengan asumsi chain linear yang sudah diimplementasikan di `poaWorkflow.ts` (`approveNsmOrAsd` — NSM approve selalu ke ASD dulu kalau ceiling ASD/SD, baru ASD approve ke SD). Kalau Exodus memang bisa skip ASD untuk kasus tertentu, logic kondisionalnya perlu tau KAPAN skip vs tidak — belum ada datanya.
2. **Ada level BARU yang belum pernah disebut sebelumnya: `fic`** (muncul setelah SD, auto-approved dengan alasan nilai PSSP ≤ 10 juta). Belum tau kepanjangan `fic` atau apakah ini level approval manusia lain (di luar ASM/SM/NSM/ASD/SD yang sudah dipetakan) atau cuma status administratif otomatis yang tidak perlu direpresentasikan di POA sama sekali.

**Konfirmasi positif dari temuan ini**: `user_role: "sales-director"` + `user_nip: P200134` + `user_name: BRIAN LEMBONG` di log yang sama — cocok PERSIS dengan keputusan Aldi ("SD = Brian Lembong, P200134") yang sudah diimplementasikan.

**Diklarifikasi Aldi (2026-09-09, sesi yang sama)**:
1. Chain **seharusnya** sesuai urutan (ASM→SM→NSM→ASD→SD, tidak skip) — record `AP400728` yang loncat NSM→SD dianggap ANOMALI di data Exodus, bukan perilaku yang benar untuk ditiru. `poaWorkflow.ts`'s `approveNsmOrAsd()` (linear, selalu lewat ASD dulu) **TIDAK PERLU diubah** — implementasi yang sudah ada sudah benar.
2. Level `fic` **sedang dibicarakan Aldi dengan tim Exodus secara terpisah** — ditunda, bukan blocking untuk pekerjaan yang sudah ada. Tidak ada representasi di POA untuk level ini sampai ada kejelasan lebih lanjut.

**🟢 Update 2026-09-11 — live call ke `submitDoctor()` sudah di-wire.** `fetchExodusRequiredRole()` (baru, `poaWorkflow.ts`) dipanggil HANYA pada first-submit dokter yang sebenarnya (`!existing`, bukan resubmit REVISI) — menghitung agregat (`estimasiTotal`/`nilaiPsspTotal` dari semua `PoaLineItem` dokter itu, `r_percentage = nilaiPsspTotal / estimasiTotal`), memetakan `bentukPssp` POA ke `pssp_type` Exodus (`toExodusPsspType()` — CASH→"Cash" dikonfirmasi cocok, BARANG/JASA/PRIMATAX dikirim apa adanya meski belum diverifikasi Exodus terima, `null`→"Cash" sebagai default mayoritas — dikonfirmasi Aldi "pssp_type nya pakai yang sesuai dari kita aja", bukan blocking lagi), memanggil `getExodusApprovalLevel()`, dan menyimpan raw role slug hasilnya ke `PoaDoctorApproval.exodusRequiredRole` sekali saja saat baris dibuat. **Gagal total (Exodus down, network error, dsb.) TIDAK PERNAH memblokir submit** — fallback ke `null` (ceiling NSM, perilaku identik sebelum fitur ini ada), lihat `fetchExodusRequiredRole`'s try/catch.

**🟢 Update 2026-09-11 — migration di-apply + hierarki GM/SD di-sync.**

**Migration**: proses apply sempat ketemu migration lain yang STUCK FAILED di DB (`20260909130000_add_asd_sd_approval_level`, bukan dari percobaan sesi ini — kemungkinan proses lain yang share DB/working directory yang sama) — Postgres menolak karena migration aslinya menggabungkan `ALTER TYPE ... ADD VALUE 'SD'` dengan pemakaiannya (`UPDATE ... SET role='SD'`) di transaksi yang sama (Postgres TIDAK MENGIZINKAN enum value baru dipakai dalam transaksi yang sama saat dibuat). Diperbaiki dengan memisah jadi 2 migration (`20260909130000_add_asd_sd_approval_level` = tambah enum value + kolom saja; `20260911110000_move_brian_lembong_to_sd` = data migration terpisah), migration lama di-resolve sebagai rolled-back (`prisma migrate resolve --rolled-back`), lalu `prisma migrate deploy` berhasil bersih — termasuk migration `20260911100000_add_target_non_hospital_value` dari kerjaan lain yang ikut ke-apply di batch yang sama. **Diverifikasi**: `Role` enum di DB sekarang punya `SD`, Brian Lembong (`P200134`) role-nya `SD`, kolom `exodusRequiredRole` ada.

**Sync hierarki** (`scripts/syncGmSdHierarchy.ts`, baru, idempotent) — sumber MSSQL `Struktur_Marketing_PI` kolom `NSM_NIP`/`GM_NIP`/`GM_Nama` (sama tabel yang dipakai `scripts/matchStrukturBaruFromMssql.ts`):
1. Upsert 2 `User` GM yang ada di MSSQL tapi belum ada row-nya di POA (`HERRY SASONGKO` P030132, `KAMILO FIDELIANT IQBAL` P070810). Satu GM lain di MSSQL (`MUHAMAD NUGRAHA` P240005) sudah ada di POA tapi sebagai `ADMIN` — dibiarkan (ADMIN sudah bypass semua approval check, tidak perlu jadi GM juga).
2. Semua `User` role `GM` aktif (5 orang) di-set `nipAtasan` = `P200134` (SD, Brian Lembong) — satu-satunya SD, dikonfirmasi.
3. 16 `User` role `NSM` yang NIP-nya PERSIS match `NSM_NIP` di MSSQL di-set `nipAtasan` sesuai `GM_NIP` baris itu. User `NSM` lain dengan NIP dummy/demo (pola `NSMxxxxxx`, jumlahnya jauh lebih banyak, bukan data asli) sengaja TIDAK disentuh.

**Temuan menarik**: untuk sejumlah NSM, `GM_NIP` di MSSQL-nya adalah Brian Lembong sendiri (dulu tercatat sebagai GM di source data sebelum konsep SD ada) — jadi `nipAtasan` NSM itu sekarang LANGSUNG ke P200134 (SD), tidak lewat GM perantara. **Ini tidak error** — `resolveNextHolder` didesain toleran ke level vakan (cari orang pertama di level target ATAU LEBIH TINGGI di chain), jadi untuk NSM-NSM ini, approval ASD dan SD akan sama-sama diarahkan ke Brian Lembong (levelnya SD, lebih tinggi dari ASD, jadi otomatis memenuhi syarat approve di level ASD juga).

**⚠️ BELUM dikerjakan (menyusul terpisah)**:
1. Belum ada UI eksplisit buat "GM/SD approve dokter ini" selain `canApproveDoctor` yang sudah menerima role-nya — perlu dicek apakah halaman `/poa/[id]` sudah cukup generic buat nampilin tombol approve ke GM/SD, atau butuh penyesuaian tampilan (belum diverifikasi visual).
2. Belum ada END-TO-END test nyata (submit dokter beneran lewat `submitDoctor()`, sampai approve di level ASD/SD sungguhan) — infrastruktur (migration + hierarki) sudah siap, tapi alur penuh belum pernah dicoba sekali pun end-to-end.

### Open questions BLOCKING — masih perlu didiskusikan (Aldi minta dibahas lebih lanjut, BUKAN diputuskan sekarang)

1. ~~Bentuk kontrak PATCH — menggantikan atau berdampingan?~~ **Settled 2026-09-01**: berdampingan, partial PATCH (lihat di atas).
2. **Masih terbuka, Aldi eksplisit minta didiskusikan lebih dulu**: apakah `PENGAJUAN` wajib dikirim dulu sebelum `APPROVED` (validasi urutan di server), atau Exodus boleh langsung kirim `APPROVED` di PATCH pertama tanpa lewat `PENGAJUAN`? Terkait erat dengan pertanyaan Aldi yang lebih besar ("use case-nya untuk apa") — perlu diperjelas dulu skenario nyata di UI `/poa/[id]` sebelum aturan validasinya ditentukan.
3. Format/validasi `exodusNomorPengajuan` — bebas string, atau ada pola tertentu (`EXO-xxxx`, numeric, dst.) yang perlu divalidasi POA?
4. Ada state "REJECTED"/gagal di Exodus yang perlu POA tau juga (di luar PENGAJUAN/APPROVED), mengingat aturan revert di §8 sudah pernah dibahas soal reject?
5. Perilaku revert (`usedInExodus:false`) terhadap 2 field baru ini — dikosongkan juga atau dipertahankan sebagai histori?

**Status implementasi: belum dimulai** — spec ini ditulis duluan (SDD, `docs/sdd/01-when-and-workflow.md`). Kontrak PATCH (poin 1) sudah settled 2026-09-01; poin 2 masih perlu dibahas Aldi lebih lanjut sebelum lanjut ke migration/implementasi UI di `/poa/[id]`.

## 10. Revisi 2026-09-09 (DRAFT — belum diimplementasikan, blocking) — "sistem approval diatur Exodus"

**Sumber**: sesi kerja dengan Aldi, 2026-09-09. Awalnya dibahas sebagai kelanjutan §9 ("approved by" ditampilkan di frontend POA), tapi setelah ditelusuri Aldi menegaskan maksudnya lebih jauh dari §9: *"INTINYA SISTEM APPROVAL DIATUR EXODUS BUKAN DIKITA AJA"* — bukan cuma menampilkan status pengajuan Exodus sebagai info tambahan (§9), tapi approval **itu sendiri** (siapa yang approve dokter di POA) dikontrol dari sisi Exodus.

**Kontradiksi yang perlu diselesaikan dulu sebelum kontrak ditulis**: `GET /api/poa-doctors` (dan detail) HANYA mengembalikan baris yang sudah `APPROVED_BY_NSM` di alur internal POA (`docs/api-poa-doctors.md`, filter final-approved, dikonfirmasi eksplisit tim Exodus sendiri 2026-08-27 — lihat §7 poin 8). Kalau Exodus baru bisa PATCH/lihat baris SETELAH baris itu `APPROVED_BY_NSM`, maka "approval diatur Exodus" tidak bisa berarti Exodus men-trigger transisi `PoaDoctorApproval.status` menuju `APPROVED_BY_NSM` itu sendiri (baris itu harus sudah berstatus itu duluan supaya kelihatan oleh Exodus) — chicken-and-egg dengan kontrak yang sudah live di production.

**Belum settled — butuh konfirmasi eksplisit dari tim Exodus (bukan diasumsikan/diputuskan sepihak), karena ini mengubah alur bisnis inti** (approval chain ASM→SM→NSM yang sudah berjalan di production, dipakai role lain di luar konteks Exodus juga):

| # | Pertanyaan | Kenapa blocking |
|---|---|---|
| 1 | Apakah "approval diatur Exodus" berarti Exodus jadi approval GATE TAMBAHAN setelah ASM→SM→NSM (dokter baru benar-benar "selesai" kalau Exodus juga approve, di luar `PoaDoctorApproval.status` POA yang tetap jalan seperti sekarang) — konsisten dengan §9 (`exodusStatus` sebagai lapisan terpisah)? | Kalau ya, ini kelanjutan §9 (tinggal lanjutkan open questions di situ), TIDAK perlu ubah `PoaDoctorApproval.status`/filter `APPROVED_BY_NSM` yang sudah ada. |
| 2 | Atau apakah dokter yang BELUM lolos ASM/SM/NSM juga perlu bisa muncul ke Exodus supaya Exodus yang men-triggernya jadi approved (skip/ganti alur manusia)? | Kalau ya, filter `APPROVED_BY_NSM` di `GET /api/poa-doctors` perlu dilonggarkan — **berlawanan langsung** dengan permintaan eksplisit tim Exodus 2026-08-27 ("data yg di show perlu yg sudah final approved saja", §7 poin 8) — perlu konfirmasi ulang ke Exodus apakah itu sudah tidak berlaku. |
| 3 | Siapa yang tervalidasi sebagai "approver" kalau berasal dari Exodus — user POA manapun (perlu NIP yang match `User`), atau nama bebas dari sisi Exodus (tidak ter-link ke `User` POA manapun)? | Menentukan apakah butuh field baru bertipe relasi (FK ke `User`) atau string bebas — dan implikasi ke audit trail (`PoaAuditLog.actorId` selama ini selalu NIP `User` yang valid). |
| 4 | Kalau Exodus "approve", apakah itu tetap lewat `PoaDoctorApproval.status` (ASM/SM/NSM) yang sama, atau field/enum approval yang benar-benar terpisah dari status internal (murni untuk ditampilkan, tidak mengubah `status`)? | Menentukan besar-kecilnya migration dan apakah kode approve/reject existing (`poaWorkflow.ts`) ikut disentuh. |

**Diselesaikan 2026-09-09 (sesi yang sama)**: Aldi menyederhanakan maksudnya — bukan pertanyaan #2 (override alur ASM/SM/NSM), murni pertanyaan #1: field display tambahan (`exodusApprovedBy`, string bebas), TIDAK mengubah `PoaDoctorApproval.status`/`approveUntil`/filter `APPROVED_BY_NSM` yang sudah ada sama sekali. Kontradiksi chicken-and-egg di atas TIDAK relevan lagi karena field ini tidak mengontrol visibilitas baris ke Exodus (baris tetap harus `APPROVED_BY_NSM` dulu, sama seperti sekarang).

**🟢 v1 diimplementasikan 2026-09-09**: field baru `exodusApprovedBy` (`String?`, `PoaDoctorApproval`, migration `20260909120000_add_exodus_approved_by` — **file migration dibuat, BELUM di-apply ke DB**, lihat catatan di `02-data-model.md`) — di-set via `PATCH /api/poa-doctors/{id}` (`{ "exodusApprovedBy": "Nama" }`, independen dari `usedInExodus`, partial update), diekspos di `GET /api/poa-doctors`/`GET /api/poa-doctors/{id}` sebagai field biasa. Ditampilkan di UI `/poa/[id]` (`DraftChecklist`'s `DoctorRow`, baris kecil "Approved by Exodus: {nama}" di bawah `StatusBadge`, cuma muncul kalau terisi). Lihat `docs/api-poa-doctors.md` untuk kontrak lengkap.

**⚠️ SUPERSEDED 2026-09-09 (sesi yang sama, lihat §11)** — setelah ditelusuri lebih lanjut, Aldi menemukan chat asli dengan tim Exodus (Budi Pharos) yang mengubah keseluruhan pendekkatan: PATCH `exodusApprovedBy` TIDAK JADI DIPAKAI, diganti flow GET (POA sebagai client, bukan PATCH dari Exodus) — lihat §11. Field/route/migration/UI di atas **dibiarkan ada di kode** (permintaan eksplisit Aldi, bukan dihapus) tapi TIDAK terhubung ke flow final — kemungkinan besar akan di-deprecate/dihapus setelah §11 settled.
