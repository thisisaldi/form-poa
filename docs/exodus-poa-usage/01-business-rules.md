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

### Open questions BLOCKING — wajib dikonfirmasi Juni Pharos sebelum kode ditulis

1. Bentuk kontrak PATCH yang pasti — field baru menggantikan `usedInExodus` di body, atau berdampingan?
2. Apakah PENGAJUAN dan APPROVED dua kali panggilan PATCH terpisah (2 event), atau Exodus kirim status akhir aja begitu tau approved (bisa lompat langsung ke `APPROVED` tanpa lewat `PENGAJUAN` dulu)?
3. Format/validasi `exodusNomorPengajuan` — bebas string, atau ada pola tertentu (`EXO-xxxx`, numeric, dst.) yang perlu divalidasi POA?
4. Ada state "REJECTED"/gagal di Exodus yang perlu POA tau juga (di luar PENGAJUAN/APPROVED), mengingat aturan revert di §8 sudah pernah dibahas soal reject?
5. Perilaku revert (`usedInExodus:false`) terhadap 2 field baru ini — dikosongkan juga atau dipertahankan sebagai histori?

**Status implementasi: belum dimulai** — spec ini ditulis duluan (SDD, `docs/sdd/01-when-and-workflow.md`) karena requirement dari eksternal (chat Exodus) yang ambigu di kontrak teknisnya dan mengubah data model yang sudah live. Menunggu jawaban Juni Pharos untuk poin 1-2 (paling blocking) sebelum lanjut ke `02-data-model.md`/implementasi.
