# Exodus POA Usage Flag — Spec Index

*(Ditulis 2026-08-24, mengikuti spec-driven development: spesifikasi ditulis dan disetujui sebelum kode ditulis. Sumber requirement: diskusi WhatsApp 2026-08-24 antara tim Exodus (+62 823-2531-6044, Juni Pharos, Zahra Nabila) dan Aldi — 3 poin konklusi, poin 3 dikonfirmasi butuh 2 endpoint terpisah (submit vs approved di Exodus) setelah tanya-jawab lanjutan dengan Juni Pharos. **Revisi 2026-08-27**: hasil meeting lanjutan tim Exodus menambah 8 poin penyesuaian ke `GET /api/poa-doctors` — lihat `01-business-rules.md` §7.)*

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — konklusi chat asli, aturan transisi status penggunaan, dan open questions yang masih butuh konfirmasi sebelum implementasi mulai.
2. [`02-data-model.md`](./02-data-model.md) — field baru di `PoaDoctorApproval`, alasan tidak butuh tabel baru.
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — endpoint yang diusulkan, auth (reuse Basic Auth `/api/poa-doctors`), tidak ada halaman UI baru.

## Status

🟢 **v1 diimplementasikan 2026-08-26, v2 diimplementasikan 2026-08-27** — baik baca maupun tulis. `GET /api/poa-doctors` (dan `GET /api/poa-doctors/{id}` untuk detail satu baris) mengembalikan `idPoa` (nomor urut global "POA0001"), `periode.startDate`/`endDate`, `approveUntil` (sekarang SELALU `"NSM"` — lihat di bawah), `usedInExodus`, dan per produk: `pengaliNilaiR`, `nilaiR` (Rupiah, live dari Exodus — lihat catatan koreksi di bawah), `hna`, `qtyPerBulan`/`qtyTotal` (satuan SJ). `nip` OPSIONAL, `keyword` bisa company-wide (lihat catatan di bawah). `PATCH /api/poa-doctors/{id}` menandai `usedInExodus: true`/`false` (lihat catatan revert). Lihat `docs/api-poa-doctors.md` untuk kontrak lengkap.

⚠️ **`nip` dibalik jadi opsional 2026-08-27 (hari yang sama)** — awalnya wajib, `keyword` cuma menyaring dalam satu NIP. Dibalik setelah user menyadari itu artinya Exodus tidak bisa cari by nama kalau belum tahu NIP-nya. Dicek ke data ASLI (bukan asumsi lagi, per `docs/PERFORMANCE.md` poin 6): 270 POA/6140 line item/~33 baris NSM-approved per kuartal — jauh di bawah skala insiden performa yang jadi alasan `docs/PERFORMANCE.md` dibuat. Diukur company-wide: ~2.6 detik, di bawah target tapi dekat batas. Lihat `01-business-rules.md` §7 poin 3.

⚠️ **v2 (2026-08-27) mengubah 2 behavior existing berdasarkan permintaan eksplisit tim Exodus** (bukan asumsi tim dev lagi): (1) `GET /api/poa-doctors` (list) sekarang MEMFILTER `usedInExodus: true` — kebalikan dari keputusan v1 yang sengaja tidak memfilter. (2) Filter `approveUntil` diperketat jadi HANYA `APPROVED_BY_NSM` ("final approved"), bukan ASM/SM/NSM level manapun seperti v1. Lihat `01-business-rules.md` §7 untuk detail per poin.

⚠️ **`nilaiR` dikoreksi 2 kali di hari yang sama (2026-08-27) sebelum settle** — v2 sempat mengambil dari `PoaLineItem.nilaiR` (kolom mati, selalu null di production), lalu diganti `Product.nilaiRPersen` (rasio/persentase), sebelum akhirnya user menegaskan yang dimaksud adalah **angka Rupiah**. Final: `nilaiR` = live `r_value` dari Exodus core products API (`getLiveProductPricing()` di `exodusApi.ts`, sudah ada duluan untuk product picker app sendiri), fallback rekonstruksi dari data DB kalau live API tidak tersedia. Lihat kronologi lengkap di `01-business-rules.md` §7 poin 4 dan `02-data-model.md`.

⚠️ **Revert dibalik 2026-08-27 (hari yang sama, permintaan terpisah)** — `PATCH /api/poa-doctors/{id}` dengan body `{"usedInExodus": false}` sekarang bisa membalik `usedInExodus` kembali ke `false` (awalnya dibangun sebagai `DELETE` terpisah, digabung jadi satu `PATCH` di hari yang sama atas preferensi Aldi). Ini secara langsung MEMBALIK aturan bisnis "tidak pernah revert" yang di §2 (`01-business-rules.md`) tadinya dikonfirmasi eksplisit oleh Juni Pharos di chat 2026-08-24. **Belum ada konfirmasi ulang tertulis dari tim Exodus untuk pembalikan ini** — lihat `01-business-rules.md` §8, perlu ditindaklanjuti di WA thread yang sama.

⚠️ **Keputusan final (bukan draft lagi): SATU endpoint, bukan dua.** Draft awal dokumen ini (mengikuti literal "submit vs approve" dari chat) diubah setelah dipertimbangkan ulang: kutipan bisnis asli ("klo sudah diajukan sekali di exodus tidak bsa dipakai lagi") hanya menuntut SATU titik kunci, dan tidak ada bukti konkret requirement kedua ("approved") benar-benar dibutuhkan sisi POA — lihat penjelasan di `01-business-rules.md` §Open questions #4. Field `usedInExodus` sengaja boolean, bukan enum tri-state. **Kalau nanti Exodus mengonfirmasi mereka memang butuh 2 checkpoint terpisah, field ini perlu diubah jadi enum** — bukan pekerjaan besar (satu migration tambahan), tapi belum dilakukan sekarang karena belum ada bukti dibutuhkan (YAGNI).

⚠️ Poin 1 konklusi chat ("POA butuh API GET dr Exodus utk dapat batas approval role berdasarkan logic approval Exodus") **di luar scope dokumen ini** — itu arah kebalikan (POA sebagai *client* yang memanggil API milik Exodus, pola yang sama dengan `src/lib/exodusApi.ts` yang sudah ada untuk data kunjungan), bukan endpoint yang POA sediakan. Belum jelas apa persisnya "batas approval role" yang dimaksud dan apakah masih relevan setelah `approveUntil` di `GET /api/poa-doctors` menjawab kebutuhan serupa dari sisi Exodus. Lihat `01-business-rules.md` §Open questions.

## Ringkasan

Tim Exodus perlu tahu POA dokter mana yang sudah "dipakai" di sisi mereka, supaya tidak dobel-pakai. `GET /api/poa-doctors`/`GET /api/poa-doctors/{id}` mengekspos flag `usedInExodus` (boolean) per dokter; `PATCH /api/poa-doctors/{id}` menuliskannya — satu endpoint, set sekali, append-only (bukan submit+approve terpisah seperti draf awal dokumen ini).
